import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import type { Clock } from '../src/branch-schedule/clock.js';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DeliveriesCommandsService } from '../src/deliveries/deliveries-commands.service.js';
import { DeliveriesQueriesService } from '../src/deliveries/deliveries-queries.service.js';
import { DeliveriesRepository } from '../src/deliveries/deliveries.repository.js';
import { deliveriesBusy } from '../src/deliveries/delivery-errors.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import type { StaffContext } from '../src/identity/identity.types.js';
import { AdminOrdersCommandsService } from '../src/orders/admin/admin-orders-commands.service.js';
import { AdminOrdersRepository } from '../src/orders/admin/admin-orders.repository.js';
import { OrderTransitionsService } from '../src/orders/admin/order-transitions.service.js';
import { toOrderTracking } from '../src/orders/order-tracking.mapper.js';
import { ordersBusy } from '../src/orders/orders-errors.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';
import { DeliveriesFulfillmentAdapter } from '../src/orders/ports/deliveries-fulfillment.adapter.js';
import { PaymentsReadAdapter } from '../src/orders/payments/payments-read.adapter.js';
import { PaymentsRepository } from '../src/orders/payments/payments.repository.js';
import { RiderActiveDeliveriesAdapter } from '../src/riders/ports/rider-active-deliveries.adapter.js';
import { RiderEligibilityService } from '../src/riders/rider-eligibility.service.js';
import { RidersCommandsService } from '../src/riders/riders-commands.service.js';
import { ridersBusy } from '../src/riders/riders-errors.js';
import { RidersQueriesService } from '../src/riders/riders-queries.service.js';
import { RidersRepository } from '../src/riders/riders.repository.js';
import {
  cleanupTestData,
  deletePaymentsOf,
  deleteDeliveriesOf,
  deleteRidersOf,
  ensureAuthStub,
  TEST_URL,
  withClient,
} from './support/db.js';
import { globalStaff, ROLE_PERMISSIONS, scopedStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * F28 (entregas propias) contra PostgreSQL REAL. Se OMITE (con aviso) sin `DATABASE_URL_TEST` o si `app.deliveries` no existe
 * (`to_regclass('app.deliveries')`): la migración 0022 NO está aplicada a la base compartida y quien la aplique decide cuándo
 * correr esto. NO se ejecuta contra el Supabase compartido sin autorización: usar una BD desechable o el proyecto de pruebas CON
 * 0022 (CI: PostgreSQL plano).
 *
 * ESTADO: ESCRITA PERO NO EJECUTADA (el api-engineer no aplicó 0022 ni tiene acceso autorizado a la BD). Hasta que corra 100 %
 * verde, F28 no pasa de `API_IMPLEMENTED`. Cubre las filas I de spec 029 §16: R03-R22, R24, R28, R34, R35 y R36 (R02 y R38 están en
 * `migration-0022.int-spec.ts` y `delivery-policy.spec.ts`). Todo lo que se siembra es de la propia prueba (sucursales `zz-`/`dl-`);
 * la limpieza usa `app.allow_order_cleanup` (triggers de 0018/0021/0022) y `app.allow_audit_cleanup` SOLO sobre esos datos.
 *
 * LÍMITES DEL POOLER: `DB_POOL_MAX` es 8; la concurrencia real usa como máximo 6 solicitudes simultáneas.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['app.deliveries','app.delivery_status_history','app.riders','app.orders','app.branches','app.branch_delivery_settings','app.staff_users','app.audit_events']) t
          WHERE to_regclass(t) IS NOT NULL`,
      );
      return (res.rows[0]?.n ?? 0) === 8;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[deliveries.int-spec] OMITIDA: app.deliveries no existe en DATABASE_URL_TEST (migración 0022 sin aplicar). El SQL de F28 NO se probó contra PostgreSQL real.',
  );
}

const ALL = ROLE_PERMISSIONS['admin'] as string[];
const MANAGER = ROLE_PERMISSIONS['manager'] as string[];

describe.skipIf(!url || !ready)('Entregas propias contra PostgreSQL real (F28)', () => {
  const run = randomUUID().slice(0, 8);
  const CLIENT = `CLIENTE-SECRETO-${run}`;
  const REASON = `RAZON-INTERNA-${run}`;
  let prisma: PrismaService;
  let commands: DeliveriesCommandsService;
  let queries: DeliveriesQueriesService;
  let ridersCommands: RidersCommandsService;
  let ridersQueries: RidersQueriesService;
  let ordersCommands: AdminOrdersCommandsService;
  let busyPort: RiderActiveDeliveriesAdapter;
  let authorization: AuthorizationService;
  let branchA = '';
  let branchB = '';
  const branchIds = new Set<string>();
  let staffRowId = '';
  let admin: StaffContext;
  let managerA: StaffContext;
  let readerA: StaffContext;
  const statements = { n: 0 };
  let counting = false;
  let originalQuery: typeof pg.Client.prototype.query;
  let phoneSeq = 0;
  let orderSeq = 0;

  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('falta app.deliveries (0022)');
  };
  const err = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const codeOf = (e: unknown) =>
    (e as { getResponse?: () => { code?: string } } | null)?.getResponse?.().code;
  const statusOf = (e: unknown) => (e as { getStatus?: () => number } | null)?.getStatus?.();
  const violationsOf = (e: unknown) =>
    (
      (e as { getResponse?: () => { violations?: { code: string }[] } } | null)?.getResponse?.()
        .violations ?? []
    ).map((v) => v.code);
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
  const phone = (): string => {
    phoneSeq += 1;
    const base = parseInt(run, 16) % 90_000;
    return `+502${String(10_000_000 + base * 100 + phoneSeq).slice(-8)}`;
  };

  /** Inserta un pedido (+ dirección si DELIVERY + línea + historial de creación) por SQL, en UNA transacción. */
  const seedOrder = async (
    o: {
      branch?: string;
      status?: string;
      fulfillment?: 'PICKUP' | 'DELIVERY';
      provider?: 'OWN' | 'PEDIDOSYA' | null;
    } = {},
  ): Promise<string> => {
    const fulfillment = o.fulfillment ?? 'DELIVERY';
    const provider = fulfillment === 'DELIVERY' ? (o.provider ?? 'OWN') : null;
    const id = randomUUID();
    orderSeq += 1;
    await withClient(url as string, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(
          `INSERT INTO app.orders (id, branch_id, customer_name, customer_phone, customer_email, fulfillment_type,
                                   delivery_provider, notes, status, subtotal, total, payment_method_preference, placed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'NOTA', $8, 100, 100, NULL, now())`,
          [
            id,
            o.branch ?? branchA,
            CLIENT,
            `+5025${String(7000000 + orderSeq).padStart(7, '0')}`.slice(0, 12),
            `pii-${run}@example.com`,
            fulfillment,
            provider,
            o.status ?? 'ready',
          ],
        );
        if (fulfillment === 'DELIVERY') {
          await c.query(
            `INSERT INTO app.order_addresses (order_id, municipality_name, zone, address_line)
             VALUES ($1, 'Guatemala', 'Zona 10', $2)`,
            [id, `DIRECCION-SECRETA-${run}`],
          );
        }
        await c.query(
          `INSERT INTO app.order_items (order_id, line_no, product_name, quantity, unit_price)
           VALUES ($1, 1, 'Roll', 2, 50)`,
          [id],
        );
        await c.query(
          `INSERT INTO app.order_status_history (order_id, old_status, new_status, changed_at)
           VALUES ($1, NULL, 'pending', now())`,
          [id],
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    return id;
  };

  const seedRider = async (
    o: { branch?: string; active?: boolean; availability?: 'AVAILABLE' | 'UNAVAILABLE' } = {},
  ): Promise<string> => {
    const id = randomUUID();
    const active = o.active ?? true;
    await q(
      `INSERT INTO app.riders (id, branch_id, full_name, name_key, phone, vehicle_type, active, availability)
       VALUES ($1, $2, $3, $4, $5, 'MOTORCYCLE', $6, $7)`,
      [
        id,
        o.branch ?? branchA,
        `zz-Rider ${run} ${phoneSeq}`,
        `zz-rider ${run} ${phoneSeq}`,
        phone(),
        active,
        active ? (o.availability ?? 'AVAILABLE') : 'UNAVAILABLE',
      ],
    );
    return id;
  };

  const deliveryRow = async (id: string) =>
    (
      await q<{
        id: string;
        order_id: string;
        branch_id: string;
        rider_id: string | null;
        status: string;
        version: number;
        assigned_at: Date | null;
        picked_up_at: Date | null;
        delivered_at: Date | null;
        returned_at: Date | null;
        cancelled_at: Date | null;
      }>('SELECT * FROM app.deliveries WHERE id = $1', [id])
    )[0];
  const deliveryOfOrder = async (orderId: string) =>
    (
      await q<{ id: string; status: string }>(
        'SELECT id, status FROM app.deliveries WHERE order_id = $1',
        [orderId],
      )
    )[0];
  const historyOf = (id: string) =>
    q<{
      old_status: string | null;
      status: string;
      event: string;
      rider_id: string | null;
      reason: string | null;
      changed_by: string | null;
    }>(
      'SELECT old_status, status, event, rider_id, reason, changed_by FROM app.delivery_status_history WHERE delivery_id = $1 ORDER BY changed_at, id',
      [id],
    );
  const auditOf = (entityType: string, id: string) =>
    q<{
      action: string;
      actor_id: string | null;
      branch_id: string | null;
      reason: string | null;
      old_values: unknown;
      new_values: unknown;
    }>(
      'SELECT action, actor_id, branch_id, reason, old_values, new_values FROM app.audit_events WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at, id',
      [entityType, id],
    );
  const orderState = async (id: string) =>
    (await q<{ status: string }>('SELECT status FROM app.orders WHERE id = $1', [id]))[0]?.status;
  const orderHistoryOf = (id: string) =>
    q<{ old_status: string | null; new_status: string; changed_by: string | null }>(
      'SELECT old_status, new_status, changed_by FROM app.order_status_history WHERE order_id = $1 ORDER BY changed_at, id',
      [id],
    );

  /** Crea una entrega por el servicio real. */
  const created = async (orderOver: Parameters<typeof seedOrder>[0] = {}, staff = admin) => {
    const orderId = await seedOrder(orderOver);
    const res = await commands.create(staff, orderId);
    return { orderId, id: res.delivery.id, version: res.delivery.version };
  };
  const assign = (id: string, riderId: string, expectedVersion: number, staff = admin) =>
    commands.assign(staff, id, { riderId, expectedVersion });
  const assigned = async (riderId?: string, orderOver: Parameters<typeof seedOrder>[0] = {}) => {
    const c = await created(orderOver);
    const rider = riderId ?? (await seedRider());
    const res = await assign(c.id, rider, c.version);
    return { ...c, riderId: rider, version: res.delivery.version };
  };

  const build = (auditService: Pick<AuditService, 'record'>) => {
    const audit = auditService as AuditService;
    const repo = new DeliveriesRepository(prisma, audit);
    const orders = new AdminOrdersRepository(prisma, audit);
    const ridersRepo = new RidersRepository(prisma, audit);
    const port = new RiderActiveDeliveriesAdapter(prisma);
    const gate = new DbGate(10, 40, 10_000, deliveriesBusy);
    const clock: Clock = { now: () => new Date() };
    return {
      orders,
      port,
      commands: new DeliveriesCommandsService(
        repo,
        authorization,
        new OrderTransitionsService(),
        orders,
        new RiderEligibilityService(ridersRepo, port),
        gate,
      ),
      queries: new DeliveriesQueriesService(repo, authorization, clock, gate),
      ridersCommands: new RidersCommandsService(
        ridersRepo,
        authorization,
        port,
        new DbGate(10, 40, 10_000, ridersBusy),
      ),
      ridersQueries: new RidersQueriesService(
        ridersRepo,
        authorization,
        port,
        new DbGate(10, 40, 10_000, ridersBusy),
      ),
      ordersCommands: new AdminOrdersCommandsService(
        orders,
        new OrderTransitionsService(),
        authorization,
        new DbGate(10, 40, 10_000, ordersBusy),
        new DeliveriesFulfillmentAdapter(prisma),
        new PaymentsReadAdapter(new PaymentsRepository(prisma, audit)),
      ),
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
    const built = build(new AuditService());
    commands = built.commands;
    queries = built.queries;
    ridersCommands = built.ridersCommands;
    ridersQueries = built.ridersQueries;
    ordersCommands = built.ordersCommands;
    busyPort = built.port;
    for (const code of ['a', 'b']) {
      const b = await prisma.branch.create({
        data: { code: `dl${code}-${run}`, name: `Suc ${code} ${run}`, address: 'Zona 1' },
      });
      branchIds.add(b.id);
      if (code === 'a') branchA = b.id;
      else branchB = b.id;
      // reparto propio habilitado (F09): sin esto `RiderEligibilityService` responde OWN_DELIVERY_DISABLED
      await q(
        'INSERT INTO app.branch_delivery_settings (branch_id, own_delivery_zones_enabled) VALUES ($1, true)',
        [b.id],
      );
    }
    const staffRow = await prisma.staffUser.create({
      data: { fullName: `Admin ${run}`, email: `f28-${run}@sushimon.test` },
    });
    staffRowId = staffRow.id;
    admin = globalStaff(ALL, { staffId: staffRowId, fullName: `Admin ${run}` });
    managerA = scopedStaff(MANAGER, [branchA], { staffId: randomUUID() });
    readerA = scopedStaff(ROLE_PERMISSIONS['staff'] as string[], [branchA], {
      staffId: randomUUID(),
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    if (ready && url) {
      // Solo los datos de las sucursales que creó ESTA prueba: entregas (+ historial), pedidos, motoristas.
      await withClient(url, async (c) => {
        await deleteDeliveriesOf(c, [...branchIds]);
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
          await c.query('DELETE FROM app.order_access_tokens WHERE order_id = ANY($1::uuid[])', [
            ids,
          ]);
          for (const t of ['order_status_history', 'order_addresses', 'order_items']) {
            await c.query(`DELETE FROM app.${t} WHERE order_id = ANY($1::uuid[])`, [ids]);
          }
          await deletePaymentsOf(c, ids);
          await c.query('DELETE FROM app.orders WHERE id = ANY($1::uuid[])', [ids]);
          await c.query(
            "DELETE FROM app.audit_events WHERE entity_type IN ('order', 'delivery', 'rider') AND branch_id = ANY($1::uuid[])",
            [[...branchIds]],
          );
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
        await deleteRidersOf(c, [...branchIds]);
      });
    }
    await prisma.$disconnect();
    if (ready && url) {
      await cleanupTestData(url, { authUserIds: [], branchIds });
    }
  });

  // ---------- crear y reabrir ----------

  it('R03 R35 crear: pending v1, historial `created`, auditoría delivery.created SIN PII; <= 5 sentencias (típico 3)', async (ctx) => {
    skipUnlessReady(ctx);
    const orderId = await seedOrder({ status: 'accepted' });
    const m = await measure(() => commands.create(admin, orderId));
    expect(m.n).toBeLessThanOrEqual(5);
    const id = m.result.delivery.id;
    expect(m.result.transition).toMatchObject({ event: 'created', replayed: false });
    expect(await deliveryRow(id)).toMatchObject({
      order_id: orderId,
      branch_id: branchA,
      status: 'pending',
      version: 1,
      rider_id: null,
    });
    expect((await historyOf(id)).map((h) => h.event)).toEqual(['created']);
    expect((await historyOf(id))[0]).toMatchObject({
      old_status: null,
      status: 'pending',
      changed_by: staffRowId,
    });
    const audits = await auditOf('delivery', id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'delivery.created',
      actor_id: staffRowId,
      branch_id: branchA,
      new_values: { status: 'pending', riderId: null, orderId },
    });
    const dump = JSON.stringify(audits);
    for (const pii of [CLIENT, `DIRECCION-SECRETA-${run}`, `pii-${run}`])
      expect(dump).not.toContain(pii);
    expect(await orderState(orderId)).toBe('accepted'); // el pedido no cambia
  });

  it('R04 crear dos veces => replayed sin segunda fila; reabrir cancelled => reopened; returned => 409', async (ctx) => {
    skipUnlessReady(ctx);
    const c = await created();
    const again = await commands.create(admin, c.orderId);
    expect(again.transition.replayed).toBe(true);
    expect(again.delivery.id).toBe(c.id);
    expect(await q('SELECT 1 FROM app.deliveries WHERE order_id = $1', [c.orderId])).toHaveLength(
      1,
    );
    expect(await historyOf(c.id)).toHaveLength(1);
    await commands.execute(admin, 'cancel', c.id, { expectedVersion: c.version, reason: REASON });
    const reopened = await commands.create(admin, c.orderId);
    expect(reopened.transition).toMatchObject({
      from: 'cancelled',
      to: 'pending',
      event: 'reopened',
    });
    expect(await deliveryRow(c.id)).toMatchObject({
      status: 'pending',
      version: 3,
      cancelled_at: null,
    });
    expect((await historyOf(c.id)).map((h) => h.event)).toEqual([
      'created',
      'cancelled',
      'reopened',
    ]);
    // returned: flujo completo y luego crear => 409
    const a = await assigned();
    const p = await commands.execute(admin, 'mark_picked_up', a.id, { expectedVersion: a.version });
    const d = await commands.execute(admin, 'mark_delivered', a.id, {
      expectedVersion: p.delivery.version,
    });
    await commands.execute(admin, 'return_to_branch', a.id, {
      expectedVersion: d.delivery.version,
    });
    const e = await err(commands.create(admin, a.orderId));
    expect([statusOf(e), codeOf(e)]).toEqual([409, 'DELIVERY_STATE_CONFLICT']);
  });

  it('R04 dos creaciones EN PARALELO del mismo pedido => una crea y la otra es replayed (UNIQUE(order_id))', async (ctx) => {
    skipUnlessReady(ctx);
    const orderId = await seedOrder();
    const [x, y] = await Promise.all([
      commands.create(admin, orderId),
      commands.create(admin, orderId),
    ]);
    expect([x.transition.replayed, y.transition.replayed].sort()).toEqual([false, true]);
    expect(x.delivery.id).toBe(y.delivery.id);
    expect(await q('SELECT 1 FROM app.deliveries WHERE order_id = $1', [orderId])).toHaveLength(1);
    expect(await auditOf('delivery', x.delivery.id)).toHaveLength(1);
  });

  it('R05 pedidos no elegibles (PICKUP, PEDIDOSYA, pending, terminal) => 422 y NUNCA una fila', async (ctx) => {
    skipUnlessReady(ctx);
    const cases: [Parameters<typeof seedOrder>[0], string][] = [
      [{ fulfillment: 'PICKUP' }, 'ORDER_NOT_DELIVERY'],
      [{ provider: 'PEDIDOSYA' }, 'ORDER_PROVIDER_NOT_OWN'],
      [{ status: 'pending' }, 'ORDER_STATUS_NOT_DISPATCHABLE'],
      [{ status: 'cancelled' }, 'ORDER_STATUS_NOT_DISPATCHABLE'],
      [{ status: 'on_the_way' }, 'ORDER_STATUS_NOT_DISPATCHABLE'],
    ];
    for (const [over, code] of cases) {
      const orderId = await seedOrder(over);
      const e = await err(commands.create(admin, orderId));
      expect([statusOf(e), codeOf(e), violationsOf(e)]).toEqual([
        422,
        'DELIVERY_ORDER_NOT_ELIGIBLE',
        [code],
      ]);
      expect(await deliveryOfOrder(orderId)).toBeUndefined();
    }
  });

  // ---------- asignar ----------

  it('R06 R28 R35 asignar: pending → assigned, historial, auditoría, ocupación real en F27; <= 9 sentencias', async (ctx) => {
    skipUnlessReady(ctx);
    const c = await created();
    const rider = await seedRider();
    const m = await measure(() => assign(c.id, rider, c.version));
    expect(m.n).toBeLessThanOrEqual(9);
    expect(m.result.transition).toMatchObject({
      from: 'pending',
      to: 'assigned',
      event: 'rider_assigned',
    });
    expect(await deliveryRow(c.id)).toMatchObject({
      status: 'assigned',
      rider_id: rider,
      version: 2,
    });
    expect((await deliveryRow(c.id))?.assigned_at).not.toBeNull();
    expect((await historyOf(c.id)).map((h) => h.event)).toEqual(['created', 'rider_assigned']);
    expect((await historyOf(c.id))[1]).toMatchObject({ rider_id: rider, changed_by: staffRowId });
    const audits = await auditOf('delivery', c.id);
    expect(audits.at(-1)).toMatchObject({
      action: 'delivery.rider_assigned',
      new_values: { status: 'assigned', riderId: rider, orderId: c.orderId },
    });
    expect(JSON.stringify(audits)).not.toContain(CLIENT);
    // F27 ya conoce la ocupación (adaptador REAL: known = true)
    const detail = await ridersQueries.get(admin, rider);
    expect(detail).toMatchObject({ busy: true, busyKnown: true, operationalState: 'BUSY' });
    expect(await orderState(c.orderId)).toBe('ready');
  });

  it('R07 razones de elegibilidad contra BD real: INACTIVE, UNAVAILABLE, WRONG_BRANCH, BUSY (sin sucursal en la respuesta)', async (ctx) => {
    skipUnlessReady(ctx);
    const c = await created();
    const inactive = await seedRider({ active: false });
    const unavailable = await seedRider({ availability: 'UNAVAILABLE' });
    const far = await seedRider({ branch: branchB });
    const busy = (await assigned()).riderId;
    const cases: [string, string][] = [
      [inactive, 'INACTIVE'],
      [unavailable, 'UNAVAILABLE'],
      [far, 'WRONG_BRANCH'],
      [busy, 'BUSY'],
    ];
    for (const [rider, code] of cases) {
      const e = await err(assign(c.id, rider, c.version));
      expect([statusOf(e), codeOf(e), violationsOf(e)]).toEqual([
        422,
        'RIDER_NOT_ELIGIBLE',
        [code],
      ]);
      expect(JSON.stringify((e as { getResponse: () => unknown }).getResponse())).not.toContain(
        branchB,
      );
    }
    expect((await deliveryRow(c.id))?.status).toBe('pending');
  });

  it('R07 reparto propio deshabilitado en la sucursal => OWN_DELIVERY_DISABLED', async (ctx) => {
    skipUnlessReady(ctx);
    await q(
      'UPDATE app.branch_delivery_settings SET own_delivery_zones_enabled = false WHERE branch_id = $1',
      [branchB],
    );
    try {
      const c = await created({ branch: branchB });
      const rider = await seedRider({ branch: branchB });
      const e = await err(assign(c.id, rider, c.version, admin));
      expect([codeOf(e), violationsOf(e)]).toEqual([
        'RIDER_NOT_ELIGIBLE',
        ['OWN_DELIVERY_DISABLED'],
      ]);
    } finally {
      await q(
        'UPDATE app.branch_delivery_settings SET own_delivery_zones_enabled = true WHERE branch_id = $1',
        [branchB],
      );
    }
  });

  it('R08 doble asignación EN PARALELO: dos entregas, mismo motorista => una 200 y una 422 BUSY; el índice único lo respalda por SQL directo', async (ctx) => {
    skipUnlessReady(ctx);
    const rider = await seedRider();
    const c1 = await created();
    const c2 = await created();
    const results = await Promise.all([
      err(assign(c1.id, rider, c1.version)),
      err(assign(c2.id, rider, c2.version)),
    ]);
    const failures = results.filter((e) => e !== null);
    expect(failures).toHaveLength(1);
    expect([statusOf(failures[0]), codeOf(failures[0]), violationsOf(failures[0])]).toEqual([
      422,
      'RIDER_NOT_ELIGIBLE',
      ['BUSY'],
    ]);
    expect(
      await q("SELECT 1 FROM app.deliveries WHERE rider_id = $1 AND status = 'assigned'", [rider]),
    ).toHaveLength(1);
    // saltando la elegibilidad (SQL directo): el índice único parcial `deliveries_one_active_per_rider_idx` rechaza con 23505
    const loser = results[0] === null ? c2 : c1;
    const sql = await err(
      q(
        `UPDATE app.deliveries SET status = 'assigned', rider_id = $2, assigned_at = now(), version = version + 1, updated_at = now() WHERE id = $1`,
        [loser.id, rider],
      ),
    );
    expect((sql as { code?: string } | null)?.code).toBe('23505');
  });

  it('R09 asignar vs desactivar al motorista (F27) en paralelo: se SERIALIZAN, nunca queda asignada a un motorista inactivo', async (ctx) => {
    skipUnlessReady(ctx);
    for (let i = 0; i < 4; i += 1) {
      const rider = await seedRider();
      const c = await created();
      const [a, b] = await Promise.all([
        err(assign(c.id, rider, c.version)),
        err(ridersCommands.setStatus(admin, rider, { active: false })),
      ]);
      const row = await deliveryRow(c.id);
      const rd = (
        await q<{ active: boolean }>('SELECT active FROM app.riders WHERE id = $1', [rider])
      )[0];
      // o gana la asignación (y desactivar falla con 409 RIDER_HAS_ACTIVE_DELIVERY) o gana desactivar (y asignar falla 422 INACTIVE)
      if (a === null) expect([codeOf(b), rd?.active]).toEqual(['RIDER_HAS_ACTIVE_DELIVERY', true]);
      else
        expect([codeOf(a), violationsOf(a), b, row?.status]).toEqual([
          'RIDER_NOT_ELIGIBLE',
          ['INACTIVE'],
          null,
          'pending',
        ]);
      expect(!(row?.status === 'assigned' && rd?.active === false)).toBe(true);
    }
  });

  it('R10 reasignar: nuevo ocupado, anterior libre, historial rider_reassigned; con picked_up => 409', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await assigned();
    const second = await seedRider();
    const res = await assign(a.id, second, a.version);
    expect(res.transition).toMatchObject({
      from: 'assigned',
      to: 'assigned',
      event: 'rider_reassigned',
    });
    const busy = await busyPort.findBusy({ riderIds: [a.riderId, second] });
    expect([busy.busyIds.has(a.riderId), busy.busyIds.has(second)]).toEqual([false, true]);
    expect((await historyOf(a.id)).at(-1)).toMatchObject({
      event: 'rider_reassigned',
      rider_id: second,
    });
    expect((await auditOf('delivery', a.id)).at(-1)).toMatchObject({
      action: 'delivery.rider_reassigned',
      old_values: { riderId: a.riderId },
      new_values: { riderId: second },
    });
    const p = await commands.execute(admin, 'mark_picked_up', a.id, {
      expectedVersion: res.delivery.version,
    });
    const e = await err(assign(a.id, a.riderId, p.delivery.version));
    expect([statusOf(e), codeOf(e)]).toEqual([409, 'DELIVERY_STATE_CONFLICT']);
  });

  it('R11 asignar al MISMO motorista => replayed sin escribir', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await assigned();
    const before = (await historyOf(a.id)).length;
    const auditsBefore = (await auditOf('delivery', a.id)).length;
    const again = await assign(a.id, a.riderId, a.version);
    expect(again.transition.replayed).toBe(true);
    expect(await historyOf(a.id)).toHaveLength(before);
    expect(await auditOf('delivery', a.id)).toHaveLength(auditsBefore);
  });

  it('R12 desasignar: assigned → pending, motorista libre, historial con el motivo', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await assigned();
    const res = await commands.execute(admin, 'unassign', a.id, {
      expectedVersion: a.version,
      reason: REASON,
    });
    expect(res.delivery).toMatchObject({ status: 'pending', rider: null });
    expect(await deliveryRow(a.id)).toMatchObject({
      status: 'pending',
      rider_id: null,
      assigned_at: null,
    });
    expect((await historyOf(a.id)).at(-1)).toMatchObject({
      event: 'rider_unassigned',
      rider_id: a.riderId,
      reason: REASON,
    });
    expect((await busyPort.findBusy({ riderIds: [a.riderId] })).busyIds.size).toBe(0);
  });

  // ---------- recoger, entregar, retorno ----------

  it('R13 R35 recoger: entrega y pedido en UNA transacción, historial y auditoría de ambos; <= 7 sentencias', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await assigned();
    const m = await measure(() =>
      commands.execute(admin, 'mark_picked_up', a.id, { expectedVersion: a.version }),
    );
    expect(m.n).toBeLessThanOrEqual(7);
    expect(await deliveryRow(a.id)).toMatchObject({ status: 'picked_up', version: a.version + 1 });
    expect(await orderState(a.orderId)).toBe('on_the_way');
    expect((await orderHistoryOf(a.orderId)).at(-1)).toMatchObject({
      old_status: 'ready',
      new_status: 'on_the_way',
      changed_by: staffRowId,
    });
    expect((await auditOf('order', a.orderId)).at(-1)?.action).toBe('order.dispatched');
    expect((await auditOf('delivery', a.id)).at(-1)?.action).toBe('delivery.picked_up');
    expect((await historyOf(a.id)).at(-1)?.event).toBe('picked_up');
  });

  it('R13 pedido en preparing => 409 ORDER_STATE_CONFLICT SIN cambios en ninguna tabla', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await assigned(undefined, { status: 'preparing' });
    const historyBefore = (await historyOf(a.id)).length;
    const e = await err(
      commands.execute(admin, 'mark_picked_up', a.id, { expectedVersion: a.version }),
    );
    expect([statusOf(e), codeOf(e)]).toEqual([409, 'ORDER_STATE_CONFLICT']);
    expect((await deliveryRow(a.id))?.status).toBe('assigned');
    expect(await orderState(a.orderId)).toBe('preparing');
    expect(await historyOf(a.id)).toHaveLength(historyBefore);
    expect(
      (await auditOf('order', a.orderId)).filter((x) => x.action === 'order.dispatched'),
    ).toHaveLength(0);
  });

  it('R14 R15 R16 entregar deja ocupado; sin retorno queda `delivered` y filtrable; el retorno (evento SEPARADO) lo libera', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await assigned();
    const p = await commands.execute(admin, 'mark_picked_up', a.id, { expectedVersion: a.version });
    const d = await commands.execute(admin, 'mark_delivered', a.id, {
      expectedVersion: p.delivery.version,
    });
    expect(await orderState(a.orderId)).toBe('delivered');
    expect((await orderHistoryOf(a.orderId)).at(-1)).toMatchObject({
      old_status: 'on_the_way',
      new_status: 'delivered',
    });
    expect((await auditOf('order', a.orderId)).at(-1)?.action).toBe('order.delivered');
    // R16: sigue ocupado y aparece en «esperando retorno»
    expect((await busyPort.findBusy({ riderIds: [a.riderId] })).busyIds.has(a.riderId)).toBe(true);
    const waiting = await queries.list(admin, { status: ['delivered'], branchId: branchA });
    expect(waiting.items.map((i) => i.id)).toContain(a.id);
    const second = await created();
    const blocked = await err(assign(second.id, a.riderId, second.version));
    expect(violationsOf(blocked)).toEqual(['BUSY']);
    // R15: retorno
    const orderEvents = (await orderHistoryOf(a.orderId)).length;
    const r = await commands.execute(admin, 'return_to_branch', a.id, {
      expectedVersion: d.delivery.version,
    });
    expect(r.delivery).toMatchObject({ status: 'returned', riderOccupied: false });
    expect((await deliveryRow(a.id))?.returned_at).not.toBeNull();
    expect((await historyOf(a.id)).map((h) => h.event)).toEqual([
      'created',
      'rider_assigned',
      'picked_up',
      'delivered',
      'returned',
    ]);
    expect((await auditOf('delivery', a.id)).at(-1)?.action).toBe('delivery.returned');
    expect(await orderHistoryOf(a.orderId)).toHaveLength(orderEvents); // no toca el pedido
    expect((await busyPort.findBusy({ riderIds: [a.riderId] })).busyIds.size).toBe(0);
    expect((await assign(second.id, a.riderId, second.version)).delivery.status).toBe('assigned');
  });

  it('R17 idempotencia de cada comando: repetir => replayed SIN historial ni auditoría nueva (entrega ni pedido)', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await assigned();
    let version = a.version;
    for (const command of ['mark_picked_up', 'mark_delivered', 'return_to_branch'] as const) {
      const first = await commands.execute(admin, command, a.id, { expectedVersion: version });
      const h = (await historyOf(a.id)).length;
      const au = (await auditOf('delivery', a.id)).length;
      const oh = (await orderHistoryOf(a.orderId)).length;
      const oa = (await auditOf('order', a.orderId)).length;
      const m = await measure(() =>
        commands.execute(admin, command, a.id, { expectedVersion: version }),
      );
      expect(m.result.transition).toMatchObject({ replayed: true, appliedByMe: true });
      expect(m.n).toBeLessThanOrEqual(7);
      expect([
        (await historyOf(a.id)).length,
        (await auditOf('delivery', a.id)).length,
        (await orderHistoryOf(a.orderId)).length,
        (await auditOf('order', a.orderId)).length,
      ]).toEqual([h, au, oh, oa]);
      version = first.delivery.version;
    }
    const c = await assigned();
    await commands.execute(admin, 'cancel', c.id, { expectedVersion: c.version, reason: REASON });
    const n = (await historyOf(c.id)).length;
    expect(
      (
        await commands.execute(admin, 'cancel', c.id, {
          expectedVersion: c.version,
          reason: REASON,
        })
      ).transition.replayed,
    ).toBe(true);
    expect(await historyOf(c.id)).toHaveLength(n);
  });

  it('R18 dos comandos EN PARALELO con la misma versión: uno gana; dos mark-picked-up => una escribe y la otra es replayed', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await assigned();
    const [x, y] = await Promise.all([
      commands.execute(admin, 'mark_picked_up', a.id, { expectedVersion: a.version }),
      commands.execute(managerA, 'mark_picked_up', a.id, { expectedVersion: a.version }),
    ]);
    expect([x.transition.replayed, y.transition.replayed].sort()).toEqual([false, true]);
    expect(
      await q(
        "SELECT 1 FROM app.delivery_status_history WHERE delivery_id = $1 AND event = 'picked_up'",
        [a.id],
      ),
    ).toHaveLength(1);
    expect(
      await q(
        "SELECT 1 FROM app.order_status_history WHERE order_id = $1 AND new_status = 'on_the_way'",
        [a.orderId],
      ),
    ).toHaveLength(1);
    // intenciones distintas con la misma versión: cancelar vs recoger => gana la primera en confirmar, la otra 409
    const b = await assigned();
    const results = await Promise.all([
      err(commands.execute(admin, 'cancel', b.id, { expectedVersion: b.version, reason: REASON })),
      err(commands.execute(admin, 'mark_picked_up', b.id, { expectedVersion: b.version })),
    ]);
    expect(results.filter((e) => e === null)).toHaveLength(1);
    const loser = results.find((e) => e !== null);
    expect(statusOf(loser)).toBe(409);
    const final = await deliveryRow(b.id);
    const orderStatus = await orderState(b.orderId);
    expect([final?.status, orderStatus]).toSatisfy(
      ([d, o]: string[]) =>
        (d === 'cancelled' && o === 'ready') || (d === 'picked_up' && o === 'on_the_way'),
    );
  });

  it('R19 todo o nada: si falla la auditoría no cambia ni la entrega ni el pedido', async (ctx) => {
    skipUnlessReady(ctx);
    const failing = build({ record: () => Promise.reject(new Error('audit down')) });
    const a = await assigned();
    const e = await err(
      failing.commands.execute(admin, 'mark_picked_up', a.id, { expectedVersion: a.version }),
    );
    expect(e).not.toBeNull();
    expect(await deliveryRow(a.id)).toMatchObject({ status: 'assigned', version: a.version });
    expect(await orderState(a.orderId)).toBe('ready');
    expect((await historyOf(a.id)).map((h) => h.event)).toEqual(['created', 'rider_assigned']);
    expect((await orderHistoryOf(a.orderId)).map((h) => h.new_status)).toEqual(['pending']);
    const c = await created();
    expect(await err(failing.commands.create(admin, c.orderId))).toBeNull(); // ya existe: repetición sin auditoría
    const orderId = await seedOrder();
    expect(await err(failing.commands.create(admin, orderId))).not.toBeNull();
    expect(await deliveryOfOrder(orderId)).toBeUndefined();
  });

  // ---------- cancelar ----------

  it('R20 cancelar entrega: motivo obligatorio, libera al motorista, no toca el pedido; desde picked_up => 409', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await assigned();
    const noReason = await err(
      commands.execute(admin, 'cancel', a.id, { expectedVersion: a.version }),
    );
    expect([statusOf(noReason), codeOf(noReason)]).toEqual([400, 'DELIVERY_REASON_REQUIRED']);
    const res = await commands.execute(admin, 'cancel', a.id, {
      expectedVersion: a.version,
      reason: ` ${REASON} `,
    });
    expect(res.delivery).toMatchObject({ status: 'cancelled', rider: null });
    expect(await deliveryRow(a.id)).toMatchObject({
      status: 'cancelled',
      rider_id: null,
      assigned_at: null,
    });
    expect((await historyOf(a.id)).at(-1)).toMatchObject({
      event: 'cancelled',
      reason: REASON,
      rider_id: a.riderId,
    });
    expect((await auditOf('delivery', a.id)).at(-1)).toMatchObject({
      action: 'delivery.cancelled',
      reason: REASON,
    });
    expect(await orderState(a.orderId)).toBe('ready');
    expect((await busyPort.findBusy({ riderIds: [a.riderId] })).busyIds.size).toBe(0);
    const b = await assigned();
    const p = await commands.execute(admin, 'mark_picked_up', b.id, { expectedVersion: b.version });
    const late = await err(
      commands.execute(admin, 'cancel', b.id, {
        expectedVersion: p.delivery.version,
        reason: REASON,
      }),
    );
    expect([statusOf(late), codeOf(late)]).toEqual([409, 'DELIVERY_STATE_CONFLICT']);
  });

  it('R21 cancelar el PEDIDO con entrega abierta => 409 ORDER_HAS_ACTIVE_DELIVERY (trigger 23001) sin cambios; tras cancelar la entrega => se cancela', async (ctx) => {
    skipUnlessReady(ctx);
    for (const make of [
      async () => await created({ status: 'accepted' }),
      async () => await assigned(undefined, { status: 'ready' }),
    ]) {
      const c = await make();
      const from = await orderState(c.orderId);
      const e = await err(
        ordersCommands.execute(admin, 'cancel', c.orderId, {
          expectedStatus: from as string,
          reason: REASON,
        }),
      );
      expect([statusOf(e), codeOf(e)]).toEqual([409, 'ORDER_HAS_ACTIVE_DELIVERY']);
      expect(
        (e as { getResponse: () => { extra?: { current?: { status: string } } } }).getResponse()
          .extra?.current?.status,
      ).toBe(from);
      expect(await orderState(c.orderId)).toBe(from);
      expect((await orderHistoryOf(c.orderId)).map((h) => h.new_status)).toEqual(['pending']);
      expect(await auditOf('order', c.orderId)).toHaveLength(0);
      const cancelled = await commands.execute(admin, 'cancel', c.id, {
        expectedVersion: c.version,
        reason: REASON,
      });
      expect(cancelled.delivery.status).toBe('cancelled');
      const ok = await ordersCommands.execute(admin, 'cancel', c.orderId, {
        expectedStatus: from as string,
        reason: REASON,
      });
      expect(ok.order.status).toBe('cancelled');
      expect(ok.pendingActions).toEqual([]);
    }
  });

  it('R21 rechazar un pedido con entrega `returned`/sin entrega no se bloquea (el trigger solo mira entregas abiertas)', async (ctx) => {
    skipUnlessReady(ctx);
    const orderId = await seedOrder({ status: 'pending' });
    const ok = await ordersCommands.execute(admin, 'reject', orderId, {
      expectedStatus: 'pending',
      reason: REASON,
    });
    expect(ok.order.status).toBe('rejected');
  });

  it('R22 crear la entrega vs cancelar el pedido EN PARALELO: nunca queda una entrega abierta sobre un pedido cancelado', async (ctx) => {
    skipUnlessReady(ctx);
    for (let i = 0; i < 6; i += 1) {
      const orderId = await seedOrder({ status: 'accepted' });
      await Promise.all([
        err(commands.create(admin, orderId)),
        err(
          ordersCommands.execute(admin, 'cancel', orderId, {
            expectedStatus: 'accepted',
            reason: REASON,
          }),
        ),
      ]);
      const status = await orderState(orderId);
      const d = await deliveryOfOrder(orderId);
      expect(
        !(
          status === 'cancelled' &&
          d !== undefined &&
          ['pending', 'assigned', 'picked_up'].includes(d.status)
        ),
      ).toBe(true);
    }
  });

  it('R22 asignar vs cancelar el pedido EN PARALELO: el pedido con entrega abierta jamás se cancela', async (ctx) => {
    skipUnlessReady(ctx);
    for (let i = 0; i < 4; i += 1) {
      const c = await created({ status: 'ready' });
      const rider = await seedRider();
      await Promise.all([
        err(assign(c.id, rider, c.version)),
        err(
          ordersCommands.execute(admin, 'cancel', c.orderId, {
            expectedStatus: 'ready',
            reason: REASON,
          }),
        ),
      ]);
      expect(await orderState(c.orderId)).toBe('ready');
      expect(['pending', 'assigned']).toContain((await deliveryRow(c.id))?.status);
    }
  });

  it('orden de bloqueos motorista → entrega → pedido: una mezcla concurrente de comandos termina SIN deadlocks (40P01)', async (ctx) => {
    skipUnlessReady(ctx);
    const riders = await Promise.all([seedRider(), seedRider(), seedRider()]);
    const deliveries = [] as { id: string; orderId: string; version: number }[];
    for (let i = 0; i < 6; i += 1) deliveries.push(await created({ status: 'ready' }));
    const jobs: Promise<unknown>[] = [];
    deliveries.forEach((d, i) => {
      const rider = riders[i % riders.length] as string;
      jobs.push(err(assign(d.id, rider, d.version)));
      jobs.push(
        err(
          commands.execute(admin, 'cancel', d.id, { expectedVersion: d.version, reason: REASON }),
        ),
      );
      jobs.push(
        err(
          ordersCommands.execute(admin, 'cancel', d.orderId, {
            expectedStatus: 'ready',
            reason: REASON,
          }),
        ),
      );
      jobs.push(err(ridersCommands.setAvailability(admin, rider, { availability: 'UNAVAILABLE' })));
    });
    const outcomes = await Promise.all(jobs);
    for (const e of outcomes) {
      if (e === null) continue;
      // todo fallo debe ser una respuesta HTTP de negocio (nunca un error crudo de BD como 40P01 o 23xxx)
      expect(statusOf(e)).toBeDefined();
      expect(codeOf(e)).not.toBe('DELIVERIES_BUSY');
    }
    // invariante final: ninguna entrega abierta sobre un pedido cancelado
    const bad = await q(
      `SELECT 1 FROM app.deliveries d JOIN app.orders o ON o.id = d.order_id
        WHERE d.branch_id = $1 AND d.status IN ('pending','assigned','picked_up') AND o.status IN ('cancelled','rejected')`,
      [branchA],
    );
    expect(bad).toHaveLength(0);
  });

  // ---------- alcance, lectura y puertos ----------

  it('R24 alcance: manager de A no ve, lista, cuenta ni actúa sobre entregas de B; 404 idéntico; branchId ajeno => BRANCH_NOT_FOUND', async (ctx) => {
    skipUnlessReady(ctx);
    const mine = await created({ branch: branchA });
    const theirs = await created({ branch: branchB });
    const list = (await queries.list(managerA, {})).items.map((i) => i.id);
    expect(list).toContain(mine.id);
    expect(list).not.toContain(theirs.id);
    const foreign = await err(queries.detail(managerA, theirs.id));
    const missing = await err(queries.detail(managerA, randomUUID()));
    expect([statusOf(foreign), codeOf(foreign)]).toEqual([404, 'DELIVERY_NOT_FOUND']);
    expect(JSON.stringify((foreign as { getResponse: () => unknown }).getResponse())).toBe(
      JSON.stringify((missing as { getResponse: () => unknown }).getResponse()),
    );
    for (const command of [
      'unassign',
      'mark_picked_up',
      'mark_delivered',
      'return_to_branch',
      'cancel',
    ] as const) {
      const e = await err(
        commands.execute(managerA, command, theirs.id, { expectedVersion: 1, reason: REASON }),
      );
      expect([command, statusOf(e), codeOf(e)]).toEqual([command, 404, 'DELIVERY_NOT_FOUND']);
    }
    const rider = await seedRider({ branch: branchA });
    const e = await err(assign(theirs.id, rider, theirs.version, managerA));
    expect(codeOf(e)).toBe('DELIVERY_NOT_FOUND');
    const wrongBranch = await err(queries.list(managerA, { branchId: branchB }));
    expect(codeOf(wrongBranch)).toBe('BRANCH_NOT_FOUND');
    // un manager de A no asigna un motorista de B a una entrega de A
    const far = await seedRider({ branch: branchB });
    const cross = await err(assign(mine.id, far, mine.version, managerA));
    expect([statusOf(cross), codeOf(cross)]).toEqual([404, 'RIDER_NOT_FOUND']);
    // sin permiso del comando en su sucursal => 403 y nada cambia
    const forbidden = await err(
      commands.execute(readerA, 'cancel', mine.id, {
        expectedVersion: mine.version,
        reason: REASON,
      }),
    );
    expect([statusOf(forbidden), codeOf(forbidden)]).toEqual([403, 'DELIVERY_ACTION_FORBIDDEN']);
    expect((await deliveryRow(mine.id))?.status).toBe('pending');
  });

  it('R28 findBusy real: assigned|picked_up|delivered ocupan; pending|returned|cancelled no; por riderIds y por branchIds; F27 bloquea acciones peligrosas', async (ctx) => {
    skipUnlessReady(ctx);
    const ridersByState: Record<string, string> = {};
    for (const state of ['assigned', 'picked_up', 'delivered', 'returned', 'cancelled'] as const) {
      const a = await assigned();
      let version = a.version;
      if (state === 'cancelled') {
        await commands.execute(admin, 'cancel', a.id, { expectedVersion: version, reason: REASON });
      } else if (state !== 'assigned') {
        const p = await commands.execute(admin, 'mark_picked_up', a.id, {
          expectedVersion: version,
        });
        version = p.delivery.version;
        if (state !== 'picked_up') {
          const d = await commands.execute(admin, 'mark_delivered', a.id, {
            expectedVersion: version,
          });
          version = d.delivery.version;
          if (state === 'returned')
            await commands.execute(admin, 'return_to_branch', a.id, { expectedVersion: version });
        }
      }
      ridersByState[state] = a.riderId;
    }
    const pendingOnly = await seedRider();
    await created(); // pending sin motorista
    const all = Object.values(ridersByState).concat(pendingOnly);
    const byRider = await busyPort.findBusy({ riderIds: all });
    expect(byRider.known).toBe(true);
    expect(all.filter((id) => byRider.busyIds.has(id)).sort()).toEqual(
      [
        ridersByState['assigned'],
        ridersByState['picked_up'],
        ridersByState['delivered'],
      ].sort() as string[],
    );
    const byBranch = await busyPort.findBusy({ branchIds: [branchA] });
    for (const id of [
      ridersByState['assigned'],
      ridersByState['picked_up'],
      ridersByState['delivered'],
    ] as string[]) {
      expect(byBranch.busyIds.has(id)).toBe(true);
    }
    for (const id of [
      ridersByState['returned'],
      ridersByState['cancelled'],
      pendingOnly,
    ] as string[]) {
      expect(byBranch.busyIds.has(id)).toBe(false);
    }
    expect((await busyPort.findBusy({ branchIds: [branchB] })).busyIds.size).toBe(0);
    const busyId = ridersByState['assigned'] as string;
    const deactivate = await err(ridersCommands.setStatus(admin, busyId, { active: false }));
    expect([statusOf(deactivate), codeOf(deactivate)]).toEqual([409, 'RIDER_HAS_ACTIVE_DELIVERY']);
    const unavailable = await err(
      ridersCommands.setAvailability(admin, busyId, { availability: 'UNAVAILABLE' }),
    );
    expect(codeOf(unavailable)).toBe('RIDER_HAS_ACTIVE_DELIVERY');
    const moved = await err(
      ridersCommands.update(admin, busyId, { expectedVersion: 1, branchId: branchB }),
    );
    expect(codeOf(moved)).toBe('RIDER_HAS_ACTIVE_DELIVERY');
    // el listado de F27 filtra por BUSY con el adaptador real
    const busyList = await ridersQueries.list(admin, { availability: 'BUSY', branchId: branchA });
    expect(busyList.items.map((i) => i.id)).toContain(busyId);
  });

  it('R34 seguimiento F21: delivery.status público por estado de la entrega, sin datos del motorista; sin entrega o PEDIDOSYA => null', async (ctx) => {
    skipUnlessReady(ctx);
    const orders = new OrdersRepository(prisma, new AuditService());
    const seedToken = async (orderId: string) => {
      const h = createHash('sha256').update(randomUUID()).digest();
      await q(
        `INSERT INTO app.order_access_tokens (order_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
        [orderId, h],
      );
      const rec = await orders.findTrackingForGuestToken(orderId, h, new Date());
      return rec ? toOrderTracking(rec, new Date()) : null;
    };
    const c = await created();
    expect((await seedToken(c.orderId))?.delivery).toEqual({ provider: 'OWN', status: 'PENDING' });
    const rider = await seedRider();
    const a = await assign(c.id, rider, c.version);
    const asg = await seedToken(c.orderId);
    expect(asg?.delivery).toEqual({ provider: 'OWN', status: 'ASSIGNED' });
    const p = await commands.execute(admin, 'mark_picked_up', c.id, {
      expectedVersion: a.delivery.version,
    });
    expect((await seedToken(c.orderId))?.delivery?.status).toBe('PICKED_UP');
    const d = await commands.execute(admin, 'mark_delivered', c.id, {
      expectedVersion: p.delivery.version,
    });
    expect((await seedToken(c.orderId))?.delivery?.status).toBe('DELIVERED');
    await commands.execute(admin, 'return_to_branch', c.id, {
      expectedVersion: d.delivery.version,
    });
    const done = await seedToken(c.orderId);
    expect(done?.delivery?.status).toBe('DELIVERED');
    expect(JSON.stringify(done)).not.toMatch(
      new RegExp(`${rider}|zz-Rider|MOTORCYCLE|\\+502\\d{8}`),
    );
    const cancelled = await created();
    await commands.execute(admin, 'cancel', cancelled.id, {
      expectedVersion: cancelled.version,
      reason: REASON,
    });
    expect((await seedToken(cancelled.orderId))?.delivery?.status).toBeNull();
    const none = await seedOrder();
    expect((await seedToken(none))?.delivery).toEqual({ provider: 'OWN', status: null });
    const py = await seedOrder({ provider: 'PEDIDOSYA' });
    expect((await seedToken(py))?.delivery).toEqual({ provider: 'PEDIDOSYA', status: null });
  });

  it('R32 el adaptador real de F22 informa la entrega abierta del pedido', async (ctx) => {
    skipUnlessReady(ctx);
    const adapter = new DeliveriesFulfillmentAdapter(prisma);
    const c = await created();
    const base = {
      orderId: c.orderId,
      branchId: branchA,
      fulfillmentType: 'DELIVERY' as const,
      deliveryProvider: 'OWN' as const,
      status: 'ready' as const,
    };
    expect(await adapter.inspect(base)).toEqual({ activeDelivery: true, pendingActions: [] });
    await commands.execute(admin, 'cancel', c.id, { expectedVersion: c.version, reason: REASON });
    expect(await adapter.inspect(base)).toEqual({ activeDelivery: false, pendingActions: [] });
    expect(await adapter.inspect({ ...base, orderId: await seedOrder() })).toEqual({
      activeDelivery: false,
      pendingActions: [],
    });
  });

  it('R36 R35 listado y detalle: filtros, orden, cursor, alcance y presupuesto de sentencias (1 y 2)', async (ctx) => {
    skipUnlessReady(ctx);
    // sucursal propia para no depender del resto de la prueba
    const b = await prisma.branch.create({
      data: { code: `dlc-${run}`, name: `Suc c ${run}`, address: 'Zona 3' },
    });
    branchIds.add(b.id);
    await q(
      'INSERT INTO app.branch_delivery_settings (branch_id, own_delivery_zones_enabled) VALUES ($1, true)',
      [b.id],
    );
    const rider = await seedRider({ branch: b.id });
    const made = [] as { id: string; orderId: string; version: number }[];
    for (let i = 0; i < 5; i += 1) made.push(await created({ branch: b.id }));
    const a = await assign(made[0]?.id as string, rider, made[0]?.version as number);
    await commands.execute(admin, 'cancel', made[1]?.id as string, {
      expectedVersion: made[1]?.version as number,
      reason: REASON,
    });
    const listM = await measure(() => queries.list(admin, { branchId: b.id }));
    expect(listM.n).toBe(1);
    const open = listM.result.items.map((i) => i.id);
    expect(open).not.toContain(made[1]?.id); // cancelada: fuera de la lista por defecto
    expect(open).toHaveLength(4);
    // orden created_at DESC, id DESC y cursor sin repetir ni saltar
    const p1 = await queries.list(admin, { branchId: b.id, limit: 2 });
    const p2 = await queries.list(admin, {
      branchId: b.id,
      limit: 2,
      cursor: p1.nextCursor as string,
    });
    const p3 = await queries.list(admin, {
      branchId: b.id,
      limit: 2,
      cursor: p2.nextCursor as string,
    });
    expect([...p1.items, ...p2.items, ...p3.items].map((i) => i.id)).toEqual(open);
    expect(p3.nextCursor).toBeNull();
    const bad = await err(
      queries.list(admin, { branchId: b.id, limit: 2, cursor: `${p1.nextCursor as string}x` }),
    );
    expect(codeOf(bad)).toBe('DELIVERY_CURSOR_INVALID');
    // filtros
    expect(
      (await queries.list(admin, { branchId: b.id, riderId: rider })).items.map((i) => i.id),
    ).toEqual([a.delivery.id]);
    expect(
      (await queries.list(admin, { branchId: b.id, status: ['cancelled'] })).items.map((i) => i.id),
    ).toEqual([made[1]?.id]);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (
        await queries.list(admin, {
          branchId: b.id,
          status: ['cancelled'],
          from: future,
          to: new Date(Date.now() + 7_200_000).toISOString(),
        })
      ).items,
    ).toEqual([]);
    expect(
      (await queries.list(admin, { branchId: b.id, status: ['pending'], from: future })).items
        .length,
    ).toBeGreaterThan(0); // abiertas ignoran el rango
    // PII
    const raw = JSON.stringify(listM.result);
    for (const pii of [CLIENT, `DIRECCION-SECRETA-${run}`, 'pii-']) expect(raw).not.toContain(pii);
    // detalle: 2 sentencias, contacto solo abierta + orders.read
    const detailM = await measure(() => queries.detail(admin, a.delivery.id));
    expect(detailM.n).toBeLessThanOrEqual(2);
    expect(detailM.result).toMatchObject({
      contactVisible: true,
      customer: { name: CLIENT },
      address: { addressLine: `DIRECCION-SECRETA-${run}` },
      historyTruncated: false,
    });
    expect(detailM.result.history.map((h) => h.event)).toEqual(['created', 'rider_assigned']);
    const noOrders = scopedStaff(['deliveries.read'], [b.id], { staffId: randomUUID() });
    const hidden = await queries.detail(noOrders, a.delivery.id);
    expect(hidden).toMatchObject({ contactVisible: false, customer: null, address: null });
    expect(JSON.stringify(hidden)).not.toContain(CLIENT);
    const cancelledDetail = await queries.detail(admin, made[1]?.id as string);
    expect(cancelledDetail).toMatchObject({ contactVisible: false, customer: null, address: null });
    // alcance: un manager de A no ve la sucursal nueva
    expect(codeOf(await err(queries.list(managerA, { branchId: b.id })))).toBe('BRANCH_NOT_FOUND');
  });
});
