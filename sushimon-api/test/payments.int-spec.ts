import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import type { Clock } from '../src/branch-schedule/clock.js';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import type { StaffContext } from '../src/identity/identity.types.js';
import { AdminOrdersCommandsService } from '../src/orders/admin/admin-orders-commands.service.js';
import { AdminOrdersQueryService } from '../src/orders/admin/admin-orders-query.service.js';
import { AdminOrdersRepository } from '../src/orders/admin/admin-orders.repository.js';
import { OrderTransitionsService } from '../src/orders/admin/order-transitions.service.js';
import { keyHashOf } from '../src/orders/order-idempotency.js';
import { OrderSourceRepository } from '../src/orders/order-source.repository.js';
import { ordersBusy } from '../src/orders/orders-errors.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';
import type { NewOrder } from '../src/orders/orders.types.js';
import { NoDeliveryFulfillment } from '../src/orders/ports/order-fulfillment.port.js';
import { CashPaymentsService } from '../src/orders/payments/cash-payments.service.js';
import { PaymentsReadAdapter } from '../src/orders/payments/payments-read.adapter.js';
import { PaymentsRepository } from '../src/orders/payments/payments.repository.js';
import {
  cleanupTestData,
  deletePaymentsOf,
  ensureAuthStub,
  pickupPlacedAt,
  TEST_URL,
  withClient,
} from './support/db.js';
import { globalStaff, ROLE_PERMISSIONS, scopedStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * F24 (pagos en efectivo) contra PostgreSQL REAL. Se omite (con aviso) sin DATABASE_URL_TEST o si faltan las tablas de 0018/0019.
 * NO se ejecuta contra el Supabase compartido sin autorización: usar una BD desechable o el proyecto de pruebas CON la migración
 * 0019 aplicada (la migración aún NO está aplicada a ninguna base).
 *
 * ESTADO: ESCRITA PERO NO EJECUTADA (el api-engineer no tiene acceso autorizado a la BD ni aplicó 0019). Hasta que corra 100 %
 * verde, F24 no pasa de `API_IMPLEMENTED` (spec 025 §13/§18). Cubre las filas I del spec §13: 1, 2, 9-11, 15-20, 22, 25, 26,
 * 29-32, 34, 37-39, 53, 61 y 62 (las de migración están en `migration-0019.int-spec.ts`). Todo lo que se siembra es de la
 * propia prueba (sucursales, productos, pedidos `zz-`); la limpieza usa `app.allow_order_cleanup` (0018/0019) y
 * `app.allow_audit_cleanup` (0004) SOLO sobre esos datos.
 *
 * LÍMITES DEL POOLER: `DB_POOL_MAX` es 8 (el pooler de sesión de Supabase admite ~15); la concurrencia real usa 8 solicitudes.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['app.orders','app.order_items','app.order_status_history','app.staff_users','app.audit_events','app.payments','app.payment_events','app.payment_methods']) t
          WHERE to_regclass(t) IS NOT NULL`,
      );
      return (res.rows[0]?.n ?? 0) === 8;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[payments.int-spec] OMITIDA: faltan tablas de 0018/0019 en DATABASE_URL_TEST. El SQL de F24 NO se probó contra PostgreSQL real.',
  );
}

const ALL = ROLE_PERMISSIONS['admin'] as string[];
const sha = (t: string) => createHash('sha256').update(t).digest();

describe.skipIf(!url || !ready)('Pagos en efectivo contra PostgreSQL real (F24)', () => {
  const run = randomUUID().slice(0, 8);
  const KEY_A = `zz-key-a-${run}-abcdefghijklmnop`;
  const KEY_B = `zz-key-b-${run}-qrstuvwxyz012345`;
  let prisma: PrismaService;
  let payments: CashPaymentsService;
  let commands: AdminOrdersCommandsService;
  let queries: AdminOrdersQueryService;
  let ordersRepo: OrdersRepository;
  let authorization: AuthorizationService;
  let branchA = '';
  let branchB = '';
  let categoryId = '';
  let productId = '';
  const branchIds = new Set<string>();
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  let staffRowId = '';
  let admin: StaffContext;
  let cashierA: StaffContext;
  let readerA: StaffContext;
  const statements = { n: 0 };
  let counting = false;
  let originalQuery: typeof pg.Client.prototype.query;
  let phoneSeq = 0;

  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('faltan tablas de 0018/0019');
  };
  const err = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const codeOf = (e: unknown) =>
    (e as { getResponse?: () => { code?: string } }).getResponse?.().code;
  const statusOf = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
    withClient(url as string, (c) => c.query<T>(sql, params)).then((r) => r.rows);
  const measure = async <T>(fn: () => Promise<T>): Promise<{ result: T; n: number }> => {
    statements.n = 0;
    counting = true;
    try {
      const result = await fn();
      return { result, n: statements.n };
    } finally {
      counting = false;
    }
  };
  const body = (tendered: string) => ({ tendered, receivedConfirmed: true }) as never;

  interface Seed {
    branch?: string;
    status?: string;
    fulfillment?: 'PICKUP' | 'DELIVERY';
    provider?: 'OWN' | 'PEDIDOSYA';
    total?: string;
    /** `false` = sin fila de pago (pedido histórico). */
    withPayment?: boolean;
  }

  /** Pedido + (opcional) pago pendiente + evento `created` por SQL, en UNA transacción (como lo hace `createOrder`). */
  const seedOrder = async (o: Seed = {}) => {
    const fulfillment = o.fulfillment ?? 'PICKUP';
    const provider = fulfillment === 'DELIVERY' ? (o.provider ?? 'OWN') : null;
    const total = o.total ?? '185.00';
    const id = randomUUID();
    phoneSeq += 1;
    // PICKUP = pedido histórico (la 0024 rechaza PICKUP nuevos): placed_at anterior al corte si la 0024 está aplicada.
    const placed = await pickupPlacedAt(url as string, fulfillment);
    await withClient(url as string, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(
          `INSERT INTO app.orders (id, branch_id, customer_name, customer_phone, fulfillment_type, delivery_provider, status,
                                   subtotal, total, payment_method_preference, placed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, 'cash', COALESCE($9::timestamptz, now()))`,
          [
            id,
            o.branch ?? branchA,
            `zz-Cliente ${run}`,
            `+5025${String(7000000 + phoneSeq).padStart(7, '0')}`.slice(0, 12),
            fulfillment,
            provider,
            o.status ?? 'pending',
            total,
            placed,
          ],
        );
        if (fulfillment === 'DELIVERY') {
          await c.query(
            `INSERT INTO app.order_addresses (order_id, municipality_name, zone, address_line)
             VALUES ($1, 'Guatemala', 'Zona 10', 'zz-DIRECCION')`,
            [id],
          );
        }
        await c.query(
          `INSERT INTO app.order_items (order_id, line_no, product_name, quantity, unit_price)
           VALUES ($1, 1, 'Roll', 1, $2)`,
          [id, total],
        );
        await c.query(
          `INSERT INTO app.order_status_history (order_id, old_status, new_status) VALUES ($1, NULL, 'pending')`,
          [id],
        );
        if (o.withPayment !== false) {
          await c.query(
            `WITH p AS (
               INSERT INTO app.payments (order_id, method_id, branch_id, amount)
               SELECT o.id, m.id, o.branch_id, o.total FROM app.orders o JOIN app.payment_methods m ON m.code = 'cash'
                WHERE o.id = $1 RETURNING id, order_id, amount)
             INSERT INTO app.payment_events (payment_id, order_id, event_type, amount) SELECT id, order_id, 'created', amount FROM p`,
            [id],
          );
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    return id;
  };

  const paymentOf = async (orderId: string) =>
    (
      await q<{
        id: string;
        status: string;
        amount: string;
        tendered_amount: string | null;
        change_amount: string | null;
        branch_id: string;
        received_by_staff_id: string | null;
        collection_context: string | null;
        received_at: Date | null;
        confirm_key_hash: Buffer | null;
        confirm_request_hash: Buffer | null;
        idempotency_key: string | null;
      }>(
        `SELECT id, status, amount::text, tendered_amount::text, change_amount::text, branch_id, received_by_staff_id,
                collection_context, received_at, confirm_key_hash, confirm_request_hash, idempotency_key
           FROM app.payments WHERE order_id = $1`,
        [orderId],
      )
    )[0];
  const eventsOf = (orderId: string) =>
    q<{ event_type: string; actor_staff_id: string | null; tendered_amount: string | null }>(
      'SELECT event_type, actor_staff_id, tendered_amount::text FROM app.payment_events WHERE order_id = $1 ORDER BY occurred_at, id',
      [orderId],
    );
  const auditOf = (paymentId: string) =>
    q<{
      action: string;
      actor_id: string | null;
      branch_id: string;
      old_values: unknown;
      new_values: unknown;
    }>(
      "SELECT action, actor_id, branch_id, old_values, new_values FROM app.audit_events WHERE entity_type = 'payment' AND entity_id = $1",
      [paymentId],
    );
  const orderState = async (id: string) =>
    (
      await q<{ status: string; updated_at: Date; total: string }>(
        'SELECT status, updated_at, total::text FROM app.orders WHERE id = $1',
        [id],
      )
    )[0];

  const build = (auditService: AuditService, gate: DbGate) => {
    const paymentsRepo = new PaymentsRepository(prisma, auditService);
    const clock: Clock = { now: () => new Date() };
    const adminRepo = new AdminOrdersRepository(prisma, auditService);
    return {
      payments: new CashPaymentsService(paymentsRepo, authorization, clock, gate),
      commands: new AdminOrdersCommandsService(
        adminRepo,
        new OrderTransitionsService(),
        authorization,
        gate,
        new NoDeliveryFulfillment(),
        new PaymentsReadAdapter(paymentsRepo),
      ),
      queries: new AdminOrdersQueryService(adminRepo, authorization, clock, gate),
    };
  };

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 }); // latencia remota (pooler)
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalQuery = pg.Client.prototype.query;
    vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const first = args[0];
      const text =
        typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? '');
      // solo sentencias del dominio (no BEGIN/COMMIT/SET del driver)
      if (counting && /^\s*(SELECT|WITH|UPDATE|INSERT)/i.test(text)) statements.n += 1;
      return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
    });
    await withClient(url as string, ensureAuthStub);
    prisma = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '8', NODE_ENV: 'test' }),
      ),
    );
    authorization = new AuthorizationService({} as IdentityService);
    const built = build(new AuditService(), new DbGate(10, 40, 10_000, ordersBusy));
    payments = built.payments;
    commands = built.commands;
    queries = built.queries;
    ordersRepo = new OrdersRepository(prisma, new AuditService());
    for (const code of ['a', 'b']) {
      const b = await prisma.branch.create({
        data: { code: `pa${code}-${run}`, name: `Suc ${code} ${run}`, address: 'Zona 1' },
      });
      branchIds.add(b.id);
      if (code === 'a') branchA = b.id;
      else branchB = b.id;
    }
    const cat = await prisma.category.create({ data: { slug: `pay-${run}`, name: `Cat ${run}` } });
    categoryId = cat.id;
    categoryIds.add(cat.id);
    const p = await prisma.product.create({
      data: { categoryId, slug: `pay-${run}`, name: `Prod ${run}`, basePrice: '185.00' },
    });
    productId = p.id;
    productIds.add(p.id);
    const staffRow = await prisma.staffUser.create({
      data: { fullName: `Cajero ${run}`, email: `f24-${run}@sushimon.test` },
    });
    staffRowId = staffRow.id;
    admin = globalStaff(ALL, { staffId: staffRowId, fullName: `Cajero ${run}` });
    cashierA = scopedStaff(['orders.read', 'payments.read', 'payments.confirm'], [branchA], {
      staffId: randomUUID(),
      fullName: `Cajera A ${run}`,
    });
    readerA = scopedStaff(['orders.read', 'payments.read'], [branchA], { staffId: randomUUID() });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    if (ready && url) {
      await withClient(url, async (c) => {
        const ids = (
          await c.query<{ id: string }>(
            'SELECT id FROM app.orders WHERE branch_id = ANY($1::uuid[])',
            [[...branchIds]],
          )
        ).rows.map((r) => r.id);
        await c.query('BEGIN');
        try {
          await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
          await c.query("SET LOCAL app.allow_audit_cleanup = 'on'");
          await c.query(
            'DELETE FROM app.order_item_modifiers WHERE order_item_id IN (SELECT id FROM app.order_items WHERE order_id = ANY($1::uuid[]))',
            [ids],
          );
          for (const t of [
            'order_access_tokens',
            'order_idempotency_keys',
            'order_status_history',
            'order_addresses',
            'order_items',
          ]) {
            await c.query(`DELETE FROM app.${t} WHERE order_id = ANY($1::uuid[])`, [ids]);
          }
          await deletePaymentsOf(c, ids);
          await c.query('DELETE FROM app.orders WHERE id = ANY($1::uuid[])', [ids]);
          await c.query(
            "DELETE FROM app.audit_events WHERE entity_type IN ('order','payment') AND branch_id = ANY($1::uuid[])",
            [[...branchIds]],
          );
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      });
    }
    await prisma.$disconnect();
    if (ready && url) {
      await cleanupTestData(url, {
        authUserIds: [],
        branchIds,
        productIds,
        categoryIds,
      });
    }
  });

  // ---------- creación (F20) ----------

  const newOrder = (over: Partial<NewOrder> = {}): NewOrder => ({
    orderId: randomUUID(),
    customerId: null,
    branchId: branchA,
    customerName: 'zz-Ana',
    customerPhone: '+50255550000',
    customerEmail: null,
    fulfillmentType: 'PICKUP',
    deliveryProvider: null,
    notes: null,
    subtotal: '185.00',
    extrasTotal: '0.00',
    discountTotal: '0.00',
    deliveryFee: '0.00',
    total: '185.00',
    paymentMethodPreference: 'cash',
    address: null,
    lines: [
      {
        lineNo: 1,
        productId,
        productName: 'Prod',
        quantity: 1,
        unitPrice: '185.00',
        extrasPerUnit: '0.00',
        lineDiscount: '0.00',
        modifiers: [],
      },
    ],
    promotions: [],
    guestToken: { hash: randomBytes(32), expiresAt: new Date(Date.now() + 3_600_000) },
    itemCount: 1,
    ...over,
  });
  const claimOf = (key: string) => ({
    scope: 'guest',
    keyHash: keyHashOf(key),
    requestHash: sha(`req-${key}`),
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  it('#1 #53 createOrder crea el pago CASH pending con amount = orders.total, branch_id del pedido y evento `created` en la MISMA transacción; 10 sentencias', async (ctx) => {
    skipUnlessReady(ctx);
    const order = newOrder();
    const m = await measure(() =>
      ordersRepo.createOrder(claimOf(`zz-create-${run}-1-abcdefghijklmnop`), order),
    );
    expect(m.result).toMatchObject({ kind: 'created' });
    expect(m.n).toBeLessThanOrEqual(10);
    const pay = await paymentOf(order.orderId);
    expect(pay).toMatchObject({
      status: 'pending',
      amount: '185.00',
      branch_id: branchA,
      tendered_amount: null,
      idempotency_key: null,
    });
    expect((await eventsOf(order.orderId)).map((e) => e.event_type)).toEqual(['created']);
  });

  it('#1 un fallo posterior revierte TODO: sin pedido, sin pago huérfano ni evento', async (ctx) => {
    skipUnlessReady(ctx);
    const bad = newOrder({
      lines: [{ ...newOrder().lines[0], productId: randomUUID() } as NewOrder['lines'][number]],
    });
    await expect(
      ordersRepo.createOrder(claimOf(`zz-create-${run}-2-abcdefghijklmnop`), bad),
    ).rejects.toThrow();
    expect(await q('SELECT 1 FROM app.payments WHERE order_id = $1', [bad.orderId])).toHaveLength(
      0,
    );
    expect(
      await q('SELECT 1 FROM app.payment_events WHERE order_id = $1', [bad.orderId]),
    ).toHaveLength(0);
  });

  it('#2 el reintento idempotente de createOrder NO duplica pago ni evento; UNIQUE(order_id) rechaza un segundo pago', async (ctx) => {
    skipUnlessReady(ctx);
    const order = newOrder();
    const claim = claimOf(`zz-create-${run}-3-abcdefghijklmnop`);
    await ordersRepo.createOrder(claim, order);
    const again = await ordersRepo.createOrder(claim, newOrder({ orderId: randomUUID() }));
    expect(again).toMatchObject({ kind: 'replay', orderId: order.orderId });
    expect(await q('SELECT 1 FROM app.payments WHERE order_id = $1', [order.orderId])).toHaveLength(
      1,
    );
    expect(await eventsOf(order.orderId)).toHaveLength(1);
    await expect(
      q(
        `INSERT INTO app.payments (order_id, method_id, branch_id, amount)
         SELECT o.id, m.id, o.branch_id, o.total FROM app.orders o JOIN app.payment_methods m ON m.code = 'cash' WHERE o.id = $1`,
        [order.orderId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  // ---------- registro ----------

  it('#9 #10 #15 pago exacto y con cambio: ingreso = amount, cambio del servidor; orders.total y estado intactos (#37)', async (ctx) => {
    skipUnlessReady(ctx);
    const exact = await seedOrder({ total: '185.00' });
    const change = await seedOrder({ total: '185.00', status: 'preparing' });
    const before = await orderState(change);
    const r1 = await payments.register(cashierA, exact, KEY_A, body('185.00'));
    const r2 = await payments.register(cashierA, change, KEY_A, body('200.00'));
    expect(r1.replayed).toBe(false);
    expect(r1.body.payment.reception).toMatchObject({ amountApplied: '185.00', change: '0.00' });
    expect(r2.body.payment.reception).toMatchObject({
      amountApplied: '185.00',
      tendered: '200.00',
      change: '15.00',
    });
    const pay = await paymentOf(change);
    expect(pay).toMatchObject({
      status: 'paid',
      amount: '185.00',
      tendered_amount: '200.00',
      change_amount: '15.00',
      branch_id: branchA,
      received_by_staff_id: cashierA.staffId,
      collection_context: 'BRANCH',
    });
    const after = await orderState(change);
    expect(after).toMatchObject({ status: 'preparing', total: '185.00' });
    expect(after?.updated_at).toEqual(before?.updated_at); // #37: no afecta expectedStatus de F22
    // #28: la fecha es la del servidor (received_at ~ ahora) y coincide con el evento
    expect(Math.abs((pay?.received_at as Date).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('#11 insuficiente: 422 sin escribir nada (pago pending, sin evento nuevo ni auditoría)', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    const e = await err(payments.register(cashierA, id, KEY_A, body('184.99')));
    expect([statusOf(e), codeOf(e)]).toEqual([422, 'CASH_AMOUNT_INSUFFICIENT']);
    expect((await paymentOf(id))?.status).toBe('pending');
    expect((await eventsOf(id)).map((x) => x.event_type)).toEqual(['created']);
    expect(await auditOf((await paymentOf(id))?.id as string)).toHaveLength(0);
  });

  it('#31 #29 auditoría payment.cash_received con actor, sucursal del pedido y valores sin PII; ninguna en lecturas ni en replay', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder({ branch: branchA });
    await payments.register(admin, id, KEY_A, body('200.00'));
    const payId = (await paymentOf(id))?.id as string;
    await payments.register(admin, id, KEY_A, body('200.00')); // replay
    await payments.get(admin, id);
    await payments.history(admin, id);
    const audits = await auditOf(payId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'payment.cash_received',
      actor_id: staffRowId,
      branch_id: branchA,
      old_values: { status: 'pending' },
      new_values: {
        orderId: id,
        status: 'paid',
        amount: '185.00',
        tendered: '200.00',
        change: '15.00',
      },
    });
    expect(JSON.stringify(audits)).not.toContain(KEY_A);
    expect(JSON.stringify(audits)).not.toContain(`zz-Cliente ${run}`);
  });

  it('#20 solo se guardan sha256 (32 bytes) de clave y cuerpo, nunca la clave; sobrevive a una instancia nueva (replay)', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    const first = await payments.register(admin, id, KEY_A, body('200.00'));
    const pay = await paymentOf(id);
    expect(pay?.confirm_key_hash).toHaveLength(32);
    expect(pay?.confirm_request_hash).toHaveLength(32);
    expect(Buffer.from(pay?.confirm_key_hash as Buffer).equals(sha(KEY_A))).toBe(true);
    expect(JSON.stringify(pay)).not.toContain(KEY_A);
    expect(pay?.idempotency_key).toBeNull(); // columna RESERVADA
    // «reinicio»: un servicio y un pool NUEVOS siguen devolviendo el replay con la recepción original
    const prisma2 = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '4', NODE_ENV: 'test' }),
      ),
    );
    try {
      const fresh = new CashPaymentsService(
        new PaymentsRepository(prisma2, new AuditService()),
        authorization,
        { now: () => new Date() },
        new DbGate(4, 8, 10_000, ordersBusy),
      );
      const again = await fresh.register(admin, id, KEY_A, body('200.00'));
      expect(again.replayed).toBe(true);
      expect(again.body.payment.reception).toEqual(first.body.payment.reception);
    } finally {
      await prisma2.$disconnect();
    }
  });

  it('#16 #22 doble pago con otra clave => 409 con `current`; misma clave y otro cuerpo => IDEMPOTENCY_KEY_REUSED; la misma clave en otro pedido es independiente', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await seedOrder();
    const b = await seedOrder();
    await payments.register(admin, a, KEY_A, body('200.00'));
    const dup = await err(payments.register(admin, a, KEY_B, body('200.00')));
    expect([statusOf(dup), codeOf(dup)]).toEqual([409, 'PAYMENT_ALREADY_REGISTERED']);
    const reused = await err(payments.register(admin, a, KEY_A, body('300.00')));
    expect([statusOf(reused), codeOf(reused)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    expect((await payments.register(admin, b, KEY_A, body('200.00'))).replayed).toBe(false);
    expect(await auditOf((await paymentOf(a))?.id as string)).toHaveLength(1);
  });

  it('#17 doble clic: dos registros simultáneos con la MISMA clave => un 201 y un replay; UN evento y UNA auditoría', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    const [x, y] = await Promise.all([
      payments.register(admin, id, KEY_A, body('200.00')),
      payments.register(admin, id, KEY_A, body('200.00')),
    ]);
    expect([x.replayed, y.replayed].sort()).toEqual([false, true]);
    expect((await eventsOf(id)).filter((e) => e.event_type === 'cash_received')).toHaveLength(1);
    expect(await auditOf((await paymentOf(id))?.id as string)).toHaveLength(1);
  });

  it('#19 concurrencia real: 8 registros paralelos con claves distintas => exactamente 1 gana (201), 7 son 409; el pago queda consistente', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        err(payments.register(cashierA, id, `zz-par-${run}-${i}-abcdefghijklmnop`, body('200.00'))),
      ),
    );
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r !== null).map(codeOf)).toEqual(
      Array(7).fill('PAYMENT_ALREADY_REGISTERED'),
    );
    expect(await paymentOf(id)).toMatchObject({ status: 'paid', change_amount: '15.00' });
    expect((await eventsOf(id)).filter((e) => e.event_type === 'cash_received')).toHaveLength(1);
  });

  it('#25 #26 alcance en SQL: A no ve ni cobra B; inexistente y ajeno => MISMO 404 con el MISMO número de sentencias; sin confirm => 403', async (ctx) => {
    skipUnlessReady(ctx);
    const foreign = await seedOrder({ branch: branchB });
    const missing = randomUUID();
    for (const call of [
      (id: string) => payments.get(cashierA, id),
      (id: string) => payments.history(cashierA, id),
      (id: string) => payments.register(cashierA, id, KEY_A, body('200.00')),
    ]) {
      const a = await measure(() => err(call(foreign)));
      const b = await measure(() => err(call(missing)));
      expect([statusOf(a.result), codeOf(a.result)]).toEqual([404, 'ORDER_NOT_FOUND']);
      expect([statusOf(b.result), codeOf(b.result)]).toEqual([404, 'ORDER_NOT_FOUND']);
      expect(a.n).toBe(b.n);
    }
    expect((await paymentOf(foreign))?.status).toBe('pending');
    const mine = await seedOrder({ branch: branchA });
    const forbidden = await err(payments.register(readerA, mine, KEY_A, body('200.00')));
    expect([statusOf(forbidden), codeOf(forbidden)]).toEqual([403, 'PAYMENT_ACTION_FORBIDDEN']);
    expect((await payments.register(admin, foreign, KEY_A, body('200.00'))).replayed).toBe(false); // global
  });

  it('#32 rollback: si falla la auditoría revierte el pago y el evento (sin éxito falso)', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    const failing = new AuditService();
    failing.record = () => Promise.reject(new Error('fallo de auditoría'));
    const svc = build(failing, new DbGate(10, 40, 10_000, ordersBusy)).payments;
    expect(await err(svc.register(admin, id, KEY_A, body('200.00')))).toBeInstanceOf(Error);
    expect((await paymentOf(id))?.status).toBe('pending');
    expect((await eventsOf(id)).map((e) => e.event_type)).toEqual(['created']);
    // sin el fallo, la misma clave cobra (la transacción fallida no dejó la clave consumida)
    expect((await payments.register(admin, id, KEY_A, body('200.00'))).replayed).toBe(false);
  });

  it('#34 #36 DELIVERY OWN: OWN_DELIVERY derivado del pedido; PedidosYa => 422 sin escribir', async (ctx) => {
    skipUnlessReady(ctx);
    const own = await seedOrder({ fulfillment: 'DELIVERY', provider: 'OWN' });
    const py = await seedOrder({ fulfillment: 'DELIVERY', provider: 'PEDIDOSYA' });
    const r = await payments.register(admin, own, KEY_A, body('200.00'));
    expect(r.body.payment).toMatchObject({ collectionContext: 'OWN_DELIVERY' });
    expect((await paymentOf(own))?.collection_context).toBe('OWN_DELIVERY');
    const e = await err(payments.register(admin, py, KEY_A, body('200.00')));
    expect([statusOf(e), codeOf(e)]).toEqual([422, 'PAYMENT_NOT_COLLECTABLE']);
    expect((await paymentOf(py))?.status).toBe('pending');
  });

  it('#37 #38 #39 cancelado/rechazado: sin cobro 409 ORDER_NOT_PAYABLE; con cobro sigue PAID, possibleRefundReview y pendingActions real; ningún comando de F22 cambia el pago', async (ctx) => {
    skipUnlessReady(ctx);
    const closed = await seedOrder({ status: 'cancelled' });
    const e = await err(payments.register(admin, closed, KEY_A, body('200.00')));
    expect([statusOf(e), codeOf(e)]).toEqual([409, 'ORDER_NOT_PAYABLE']);
    expect((await paymentOf(closed))?.status).toBe('pending');
    expect((await payments.get(admin, closed)).possibleRefundReview).toBe(false);

    const paid = await seedOrder();
    await payments.register(admin, paid, KEY_A, body('200.00'));
    const res = await commands.execute(admin, 'cancel', paid, {
      expectedStatus: 'pending',
      reason: 'zz-motivo-interno',
    });
    expect(res.pendingActions).toEqual(['payment_review']);
    expect(res.order.paymentStatus).toBe('PAID');
    expect(await paymentOf(paid)).toMatchObject({ status: 'paid' });
    expect(await payments.get(admin, paid)).toMatchObject({
      status: 'PAID',
      possibleRefundReview: true,
    });
    // un cancel SIN cobro no informa payment_review
    const unpaid = await seedOrder();
    const res2 = await commands.execute(admin, 'cancel', unpaid, {
      expectedStatus: 'pending',
      reason: 'zz-motivo-interno',
    });
    expect(res2.pendingActions).toEqual([]);
    expect((await paymentOf(unpaid))?.status).toBe('pending');
  });

  it('#61 #62 pedido histórico sin fila de pago => lectura CASH/PENDING y POST 422 LEGACY_PAYMENT_METHOD; sus transiciones F22 siguen; total 0 => AMOUNT_ZERO', async (ctx) => {
    skipUnlessReady(ctx);
    const legacy = await seedOrder({ withPayment: false });
    expect(await payments.get(admin, legacy)).toMatchObject({
      method: 'CASH',
      status: 'PENDING',
      registration: { allowed: false, blockedReason: 'LEGACY_PAYMENT_METHOD' },
    });
    const e = await err(payments.register(admin, legacy, KEY_A, body('200.00')));
    expect([statusOf(e), codeOf(e)]).toEqual([422, 'PAYMENT_NOT_COLLECTABLE']);
    const moved = await commands.execute(admin, 'accept', legacy, { expectedStatus: 'pending' });
    expect(moved.order.status).toBe('accepted');
    const zero = await seedOrder({ total: '0.00' });
    expect((await payments.get(admin, zero)).registration.blockedReason).toBe('AMOUNT_ZERO');
  });

  it('#30 historial: CREATED y CASH_RECEIVED en orden con el nombre del actor; sin ids de empleado ni hashes', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    await payments.register(admin, id, KEY_A, body('200.00'));
    const h = await payments.history(admin, id);
    expect(h.items.map((e) => e.type)).toEqual(['CREATED', 'CASH_RECEIVED']);
    expect(h.items[1]).toMatchObject({
      actorName: `Cajero ${run}`,
      tendered: '200.00',
      change: '15.00',
    });
    expect(JSON.stringify(h)).not.toContain(staffRowId);
    // #8: la recepción lleva el nombre del cobrador (LEFT JOIN staff_users)
    expect((await payments.get(admin, id)).reception?.collectorName).toBe(`Cajero ${run}`);
  });

  it('#4 #43 #44 #45 lecturas públicas con el pago real: detalle (Prisma), recibo (SQL) y tracking; PENDING y luego PAID', async (ctx) => {
    skipUnlessReady(ctx);
    const created = newOrder();
    const claim = claimOf(`zz-create-${run}-4-abcdefghijklmnop`);
    await ordersRepo.createOrder(claim, created);
    const detail = await ordersRepo.findById(created.orderId);
    expect(detail?.payment).toMatchObject({ status: 'pending' });
    await payments.register(admin, created.orderId, KEY_A, body('200.00'));
    const paid = await ordersRepo.findById(created.orderId);
    expect(paid?.payment).toMatchObject({ status: 'paid' });
    expect(paid?.payment?.tendered?.toFixed(2)).toBe('200.00');
    // recibo (OrderSourceRepository, LEFT JOIN): importe pagado = total, entregado y cambio
    const source = await new OrderSourceRepository(prisma).findForGuestToken(
      created.orderId,
      created.guestToken?.hash as Buffer,
      new Date(),
    );
    expect(source?.payment).toMatchObject({
      status: 'paid',
      amount: '185.00',
      tendered: '200.00',
      change: '15.00',
    });
  });

  // ---------- carrera cobro vs cancelar/rechazar (FOR SHARE sobre el pedido) ----------

  it('CARRERA real cobro vs cancelación (10 rondas): exactamente un orden consistente, sin 500 ni interbloqueo; el pago nunca queda a medias', async (ctx) => {
    skipUnlessReady(ctx);
    let paidThenCancelled = 0;
    let cancelledFirst = 0;
    for (let i = 0; i < 10; i += 1) {
      const id = await seedOrder();
      const [reg, cancel] = await Promise.all([
        err(
          payments.register(cashierA, id, `zz-race-${run}-${i}-abcdefghijklmnop`, body('200.00')),
        ),
        err(
          commands.execute(admin, 'cancel', id, {
            expectedStatus: 'pending',
            reason: 'zz-carrera',
          }),
        ),
      ]);
      // la cancelación SIEMPRE se aplica (el cobro no la bloquea más allá de la espera del candado)
      expect(cancel).toBeNull();
      expect((await orderState(id))?.status).toBe('cancelled');
      const pay = await paymentOf(id);
      if (reg === null) {
        // el cobro tomó el candado primero: queda PAID + cancelado = «posible devolución pendiente»
        paidThenCancelled += 1;
        expect(pay?.status).toBe('paid');
        expect((await payments.get(admin, id)).possibleRefundReview).toBe(true);
        expect((await eventsOf(id)).filter((e) => e.event_type === 'cash_received')).toHaveLength(
          1,
        );
      } else {
        // la cancelación confirmó primero: el cobro recibe 409 y NO deja pago, evento ni auditoría
        cancelledFirst += 1;
        expect([statusOf(reg), codeOf(reg)]).toEqual([409, 'ORDER_NOT_PAYABLE']);
        expect(pay?.status).toBe('pending');
        expect((await eventsOf(id)).filter((e) => e.event_type === 'cash_received')).toHaveLength(
          0,
        );
        expect(await auditOf(pay?.id as string)).toHaveLength(0);
      }
      // invariante: jamás `paid` sin evento ni evento sin `paid`
      expect(pay?.status === 'paid').toBe(
        (await eventsOf(id)).some((e) => e.event_type === 'cash_received'),
      );
    }
    expect(paidThenCancelled + cancelledFirst).toBe(10);
  }, 240_000);

  it('CARRERA determinista: con el pedido bloqueado FOR SHARE por el cobro, la cancelación ESPERA y luego aplica (PAID + cancelled)', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    await withClient(url as string, async (holder) => {
      await holder.query('BEGIN');
      try {
        await holder.query('SELECT 1 FROM app.orders WHERE id = $1 FOR SHARE', [id]);
        let done = false;
        const cancelling = commands
          .execute(admin, 'cancel', id, { expectedStatus: 'pending', reason: 'zz-espera' })
          .then(() => (done = true));
        await new Promise((r) => setTimeout(r, 300));
        expect(done).toBe(false); // el UPDATE de la transición espera al candado compartido (FOR NO KEY UPDATE choca con FOR SHARE)
        await holder.query('COMMIT');
        await cancelling;
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
      }
    });
    expect((await orderState(id))?.status).toBe('cancelled');
  });

  // ---------- seguridad de la tabla (triggers) ----------

  it('#41 UPDATE directo de un pago `paid` y de `payment_events`, y un INSERT de pago ya `paid`, se rechazan (42501 / 23514)', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    await payments.register(admin, id, KEY_A, body('200.00'));
    const pay = await paymentOf(id);
    await expect(
      q('UPDATE app.payments SET tendered_amount = 999, change_amount = 814 WHERE id = $1', [
        pay?.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      q('UPDATE app.payments SET updated_at = now() WHERE id = $1', [pay?.id]),
    ).rejects.toMatchObject({
      code: '42501',
    });
    await expect(q('DELETE FROM app.payments WHERE id = $1', [pay?.id])).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      q('UPDATE app.payment_events SET amount = 1 WHERE order_id = $1', [id]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      q('DELETE FROM app.payment_events WHERE order_id = $1', [id]),
    ).rejects.toMatchObject({
      code: '42501',
    });
    // INSERT de un pago que ya nace `paid` (otro pedido sin pago): el trigger exige `pending`
    const other = await seedOrder({ withPayment: false });
    await expect(
      q(
        `INSERT INTO app.payments (order_id, method_id, branch_id, amount, status, tendered_amount, change_amount, collector_type,
                                   received_by_staff_id, collection_context, received_at, confirm_key_hash, confirm_request_hash)
         SELECT o.id, m.id, o.branch_id, o.total, 'paid', 200, 15, 'STAFF', gen_random_uuid(), 'BRANCH', now(),
                decode(repeat('01', 32), 'hex'), decode(repeat('02', 32), 'hex')
           FROM app.orders o JOIN app.payment_methods m ON m.code = 'cash' WHERE o.id = $1`,
        [other],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await q('SELECT 1 FROM app.payments WHERE order_id = $1', [other])).toHaveLength(0);
  });

  // ---------- idempotencia concurrente (20 solicitudes) ----------

  it('#17 20 POST concurrentes con la MISMA clave y cuerpo => exactamente un 201 (no replay) y 19 replays 200; un solo evento y una auditoría', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    // cupo = tamaño del pool (8): las 20 solicitudes hacen cola en el gate y no agotan las conexiones
    const svc = build(new AuditService(), new DbGate(8, 40, 20_000, ordersBusy)).payments;
    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, () => svc.register(cashierA, id, KEY_A, body('200.00'))),
    );
    // Con latencia remota las últimas de la cola pueden recibir 503 reintentable (ORDERS_BUSY): se reintentan con la MISMA clave.
    const results: Awaited<ReturnType<typeof svc.register>>[] = [];
    let busy = 0;
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
      else {
        expect([statusOf(r.reason), codeOf(r.reason)].slice(0, 1)).toEqual([503]);
        busy += 1;
        results.push(await svc.register(cashierA, id, KEY_A, body('200.00')));
      }
    }
    console.info(`[F24 #17] 503 reintentados con la misma clave: ${busy}/20`);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(19);
    expect(results.every((r) => r.body.payment.reception?.change === '15.00')).toBe(true);
    expect((await eventsOf(id)).filter((e) => e.event_type === 'cash_received')).toHaveLength(1);
    expect(await auditOf((await paymentOf(id))?.id as string)).toHaveLength(1);
  }, 240_000);

  it('#25 payments.confirm solo en A y orders.read en A y B: el POST sobre un pedido de B => 403 PAYMENT_ACTION_FORBIDDEN, sin pago ni evento ni auditoría', async (ctx) => {
    skipUnlessReady(ctx);
    const staff = scopedStaff(['orders.read'], [branchA, branchB], { staffId: randomUUID() });
    staff.grants['payments.confirm'] = { allBranches: false, branchIds: [branchA] };
    staff.grants['payments.read'] = { allBranches: false, branchIds: [branchA, branchB] };
    const inB = await seedOrder({ branch: branchB });
    const e = await err(payments.register(staff, inB, KEY_A, body('200.00')));
    expect([statusOf(e), codeOf(e)]).toEqual([403, 'PAYMENT_ACTION_FORBIDDEN']);
    const pay = await paymentOf(inB);
    expect(pay?.status).toBe('pending');
    expect((await eventsOf(inB)).filter((x) => x.event_type === 'cash_received')).toHaveLength(0);
    expect(await auditOf(pay?.id as string)).toHaveLength(0);
    const inA = await seedOrder({ branch: branchA });
    expect((await payments.register(staff, inA, KEY_A, body('200.00'))).replayed).toBe(false);
  });

  // ---------- presupuesto de sentencias (#53) ----------

  it('#53 presupuesto medido: getAdminOrderPayment <= 2, historial <= 2, registro <= 6 (replay 1), con 50 pedidos de ruido; listado/tablero/detalle F22 sin cambio', async (ctx) => {
    skipUnlessReady(ctx);
    for (let i = 0; i < 50; i += 1) await seedOrder();
    const id = await seedOrder();
    const get = await measure(() => payments.get(admin, id));
    expect(get.n).toBeLessThanOrEqual(2);
    const hist = await measure(() => payments.history(admin, id));
    expect(hist.n).toBeLessThanOrEqual(2);
    const reg = await measure(() => payments.register(admin, id, KEY_A, body('200.00')));
    expect(reg.n).toBeLessThanOrEqual(6);
    const replay = await measure(() => payments.register(admin, id, KEY_A, body('200.00')));
    expect(replay.n).toBeLessThanOrEqual(2);
    const conflict = await measure(() => err(payments.register(admin, id, KEY_B, body('200.00'))));
    expect(conflict.n).toBeLessThanOrEqual(3);
    const list = await measure(() =>
      queries.list(admin, { limit: 50, from: new Date(Date.now() - 86_400_000).toISOString() }),
    );
    expect(list.n).toBeLessThanOrEqual(2);
    expect(list.result.items.length).toBeGreaterThan(0);
    expect(list.result.items.every((i) => ['PENDING', 'PAID'].includes(i.paymentStatus))).toBe(
      true,
    );
    const board = await measure(() => queries.board(admin, {}));
    expect(board.n).toBeLessThanOrEqual(3);
    const detail = await measure(() => queries.detail(admin, id));
    expect(detail.n).toBeLessThanOrEqual(7);
    expect(detail.result.payment).toMatchObject({ status: 'PAID', outstanding: '0.00' });
    // reject/cancel: techo 7 (antes 6) por la lectura real de `payments`
    const toCancel = await seedOrder();
    const cmd = await measure(() =>
      commands.execute(admin, 'cancel', toCancel, {
        expectedStatus: 'pending',
        reason: 'zz-motivo',
      }),
    );
    expect(cmd.n).toBeLessThanOrEqual(7);
  }, 240_000);
});
