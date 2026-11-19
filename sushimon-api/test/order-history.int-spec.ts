import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import type { Principal } from '../src/auth/auth.types.js';
import { BranchOffersService } from '../src/branch-products/branch-offers.service.js';
import { BranchProductsRepository } from '../src/branch-products/branch-products.repository.js';
import { BranchAvailabilityService } from '../src/branch-schedule/branch-availability.service.js';
import { BranchScheduleRepository } from '../src/branch-schedule/branch-schedule.repository.js';
import { SystemClock } from '../src/branch-schedule/clock.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ModifierSelectionService } from '../src/modifiers/modifier-selection.service.js';
import { ModifiersQueryService } from '../src/modifiers/modifiers-query.service.js';
import { ModifiersRepository } from '../src/modifiers/modifiers.repository.js';
import { encodeCursor } from '../src/orders/order-cursor.js';
import { OrderDocumentsService } from '../src/orders/order-documents.service.js';
import { toOrderDetail } from '../src/orders/order-mapper.js';
import { OrderSourceRepository } from '../src/orders/order-source.repository.js';
import { ordersBusy } from '../src/orders/orders-errors.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';
import { MyOrdersRepository } from '../src/orders/history/my-orders.repository.js';
import { MyOrdersService } from '../src/orders/history/my-orders.service.js';
import { ProductsQueryService } from '../src/products/products-query.service.js';
import { ProductsRepository } from '../src/products/products.repository.js';
import { cleanupTestData, ensureAuthStub, TEST_URL, withClient } from './support/db.js';

const url = TEST_URL;
const TZ = 'America/Guatemala';

/**
 * F23 (historial, recibo y «Volver a pedir») contra PostgreSQL REAL. Se omite (con aviso) sin DATABASE_URL_TEST o si faltan las
 * tablas de 0018/F11-F13. NO se ejecuta contra el Supabase compartido sin autorización: usar una BD desechable o el proyecto de
 * pruebas.
 *
 * ESTADO: ESCRITA PERO NO EJECUTADA todavía (la escribió el api-engineer sin acceso autorizado a la BD). Hasta que corra 100 %
 * verde, F23 no pasa de `API_IMPLEMENTED` (spec 024 §14). Cubre las filas I del spec §11: 2, 3, 7, 8, 13, 22, 24, 28, 31-40, 43,
 * 46, 66 y 67. Todo lo que se siembra es de la propia prueba (sucursales, categorías, productos, grupos, clientes, pedidos
 * `zz-`); la limpieza usa `app.allow_order_cleanup` (0018) y `app.allow_audit_cleanup` (0004) SOLO sobre esos datos.
 *
 * LÍMITES DEL POOLER: el pooler de sesión de Supabase admite ~15 conexiones. Aquí `DB_POOL_MAX` es 4, la siembra es SECUENCIAL
 * (una conexión a la vez; el volumen de #67 se siembra con UNA sentencia `generate_series`) y los timeouts son holgados por la
 * latencia remota. `F23_NOISE_ORDERS` (defecto 20000) ajusta el volumen de #67.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['app.orders','app.order_items','app.order_item_modifiers','app.order_addresses','app.order_access_tokens','app.order_status_history','app.customers','app.products','app.branch_products','app.modifiers']) t
          WHERE to_regclass(t) IS NOT NULL`,
      );
      return (res.rows[0]?.n ?? 0) === 10;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[order-history.int-spec] OMITIDA: faltan tablas de 0018/F11-F13 en DATABASE_URL_TEST. El SQL de F23 NO se probó contra PostgreSQL real.',
  );
}

const sha = (t: string) => createHash('sha256').update(t).digest();
const NOISE = Number(process.env['F23_NOISE_ORDERS'] ?? 20_000);

interface SeedLine {
  productId: string | null;
  name: string;
  quantity: number;
  unit: string;
  extras?: string;
  discount?: string;
  notes?: string | null;
  mods?: { id: string | null; name: string; price: string }[];
}
interface SeedOrder {
  customerId?: string | null;
  branch: string;
  status?: string;
  placedAt?: Date;
  lines?: SeedLine[];
  delivery?: boolean;
  provider?: 'OWN' | 'PEDIDOSYA';
  reason?: string;
  token?: { raw: string; expiresInMs: number; revoked?: boolean };
  fee?: string;
}

describe.skipIf(!url || !ready)('Historial, recibo y reorden contra PostgreSQL real (F23)', () => {
  const run = randomUUID().slice(0, 8);
  const SECRET_REASON = `zz-RAZON-INTERNA-${run}`;
  const SECRET_EMAIL = `zz-pii-${run}@example.com`;
  let prisma: PrismaService;
  let history: MyOrdersService;
  let docs: OrderDocumentsService;
  let ordersRepo: OrdersRepository;
  let branchA = '';
  let branchB = '';
  let branchOff = '';
  let catId = '';
  let pOk = '';
  let pHidden = '';
  let pSold = '';
  let pCheap = '';
  let groupId = '';
  let optSoya = '';
  let optPicante = '';
  let optVieja = '';
  let customer1 = '';
  let customer2 = '';
  const auth1 = randomUUID();
  const auth2 = randomUUID();
  const authNone = randomUUID();
  const branchIds = new Set<string>();
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const groupIds = new Set<string>();
  const authUserIds = new Set<string>();
  const orderIds = new Set<string>();
  const stmts = { n: 0 };
  let counting = false;
  let capture: { text: string; values: unknown[] } | null = null;
  let originalQuery: typeof pg.Client.prototype.query;
  let phoneSeq = 0;

  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('faltan tablas de 0018/F11-F13');
  };
  const who = (authUserId: string) => ({ authUserId }) as Principal;
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
    stmts.n = 0;
    counting = true;
    try {
      const result = await fn();
      return { result, n: stmts.n };
    } finally {
      counting = false;
    }
  };
  const counts = async () => {
    const tables = ['orders', 'order_items', 'order_idempotency_keys', 'audit_events'];
    const out: Record<string, number> = {};
    for (const t of tables) {
      out[t] = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.${t}`))[0]?.n ?? 0;
    }
    const seq = (
      await q<{ s: string | null }>(
        `SELECT pg_get_serial_sequence('app.orders','order_number') AS s`,
      )
    )[0]?.s;
    out['sequence'] = seq
      ? Number((await q<{ v: string }>(`SELECT last_value::text AS v FROM ${seq}`))[0]?.v ?? 0)
      : 0;
    return out;
  };

  const newBranch = async (active = true) => {
    const b = await prisma.branch.create({
      data: {
        code: `f23-${run}-${randomUUID().slice(0, 6)}`,
        name: `zz-Suc ${run}`,
        address: 'Zona 1',
        active,
      },
    });
    branchIds.add(b.id);
    return b.id;
  };
  const newProduct = async (basePrice: string, active = true) => {
    const p = await prisma.product.create({
      data: {
        categoryId: catId,
        slug: `zz-f23-${run}-${randomUUID().slice(0, 6)}`,
        name: `zz-Prod ${run} ${randomUUID().slice(0, 4)}`,
        basePrice,
        active,
      },
      select: { id: true },
    });
    productIds.add(p.id);
    return p.id;
  };
  const newCustomer = async (authUserId: string) => {
    authUserIds.add(authUserId);
    await withClient(url as string, (c) =>
      c.query('INSERT INTO auth.users (id) VALUES ($1)', [authUserId]),
    );
    const c = await prisma.customer.create({
      data: {
        authUserId,
        fullName: `zz-Cliente ${run}`,
        email: `zz-${randomUUID().slice(0, 6)}@sushimon.test`,
      },
    });
    return c.id;
  };

  /** Inserta pedido + líneas + extras (+ dirección si DELIVERY) + historial (+ token) por SQL, en UNA transacción. */
  const seedOrder = async (o: SeedOrder): Promise<string> => {
    const id = randomUUID();
    phoneSeq += 1;
    const lines = o.lines ?? [{ productId: pOk, name: 'Roll', quantity: 1, unit: '50.00' }];
    const cents = (v: string) => Math.round(Number(v) * 100);
    const subtotal = lines.reduce(
      (s, l) => s + (cents(l.unit) + cents(l.extras ?? '0.00')) * l.quantity,
      0,
    );
    const discount = lines.reduce((s, l) => s + cents(l.discount ?? '0.00'), 0);
    const extrasTotal = lines.reduce((s, l) => s + cents(l.extras ?? '0.00') * l.quantity, 0);
    const fee = o.delivery ? cents(o.fee ?? '15.00') : 0;
    const dec = (c: number) => (c / 100).toFixed(2);
    await withClient(url as string, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(
          `INSERT INTO app.orders (id, branch_id, customer_id, customer_name, customer_phone, customer_email, fulfillment_type,
                                   delivery_provider, notes, status, subtotal, extras_total, discount_total, delivery_fee, total,
                                   payment_method_preference, placed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'zz-nota',$9,$10,$11,$12,$13,$14,'cash', COALESCE($15::timestamptz, now()))`,
          [
            id,
            o.branch,
            o.customerId ?? null,
            'zz-Nombre Secreto',
            `+502${String(55000000 + phoneSeq)}`,
            SECRET_EMAIL,
            o.delivery ? 'DELIVERY' : 'PICKUP',
            o.delivery ? (o.provider ?? 'OWN') : null,
            o.status ?? 'delivered',
            dec(subtotal),
            dec(extrasTotal),
            dec(discount),
            dec(fee),
            dec(subtotal - discount + fee),
            o.placedAt ?? null,
          ],
        );
        if (o.delivery) {
          await c.query(
            `INSERT INTO app.order_addresses (order_id, municipality_name, zone, address_line, latitude, longitude)
             VALUES ($1, 'Guatemala', 'Zona 10', 'zz-DIRECCION', 14.6, -90.5)`,
            [id],
          );
        }
        for (const [i, l] of lines.entries()) {
          const item = await c.query<{ id: string }>(
            `INSERT INTO app.order_items (order_id, line_no, product_id, product_name, quantity, unit_price, extras_per_unit, line_discount, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [
              id,
              i + 1,
              l.productId,
              l.name,
              l.quantity,
              l.unit,
              l.extras ?? '0.00',
              l.discount ?? '0.00',
              l.notes ?? null,
            ],
          );
          for (const m of l.mods ?? []) {
            await c.query(
              `INSERT INTO app.order_item_modifiers (order_item_id, modifier_id, modifier_name, quantity, unit_extra_price)
               VALUES ($1,$2,$3,1,$4)`,
              [item.rows[0]?.id, m.id, m.name, m.price],
            );
          }
        }
        await c.query(
          `INSERT INTO app.order_status_history (order_id, old_status, new_status, changed_at, reason)
           VALUES ($1, NULL, 'pending', COALESCE($2::timestamptz, now()), NULL)`,
          [id, o.placedAt ?? null],
        );
        if (o.reason) {
          await c.query(
            `INSERT INTO app.order_status_history (order_id, old_status, new_status, reason) VALUES ($1,'pending',$2,$3)`,
            [id, o.status ?? 'rejected', o.reason],
          );
        }
        if (o.token) {
          await c.query(
            `INSERT INTO app.order_access_tokens (order_id, token_hash, created_at, expires_at, revoked_at)
             VALUES ($1,$2, now() - interval '1 day', now() + ($3::int * interval '1 millisecond'), $4)`,
            [id, sha(o.token.raw), o.token.expiresInMs, o.token.revoked ? new Date() : null],
          );
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    orderIds.add(id);
    return id;
  };

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalQuery = pg.Client.prototype.query;
    vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const first = args[0];
      const text =
        typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? '');
      const values =
        typeof first === 'string'
          ? ((args[1] as unknown[] | undefined) ?? [])
          : ((first as { values?: unknown[] } | undefined)?.values ?? []);
      if (counting && /^\s*(SELECT|WITH)/i.test(text)) {
        stmts.n += 1;
        if (capture === null && /app\.orders o/.test(text) && /customers c/.test(text)) {
          capture = { text, values };
        }
      }
      return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
    });
    await withClient(url as string, ensureAuthStub);
    // Pool pequeño (límite de 15 conexiones del pooler de sesión); sin concurrencia en la siembra.
    prisma = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '4', NODE_ENV: 'test' }),
      ),
    );
    const clock = new SystemClock();
    const gate = new DbGate(4, 16, 20_000, ordersBusy);
    const catQuery = new CategoriesQueryService(new CategoriesRepository(prisma));
    const modRepo = new ModifiersRepository(prisma);
    ordersRepo = new OrdersRepository(prisma, new AuditService());
    history = new MyOrdersService(new MyOrdersRepository(prisma), clock, gate);
    docs = new OrderDocumentsService(
      new OrderSourceRepository(prisma),
      new BranchOffersService(new BranchProductsRepository(prisma), catQuery),
      new ModifierSelectionService(modRepo),
      new ProductsQueryService(
        new ProductsRepository(prisma),
        catQuery,
        new ModifiersQueryService(modRepo),
      ),
      new BranchAvailabilityService(new BranchScheduleRepository(prisma), clock, TZ),
      clock,
      gate,
    );

    branchA = await newBranch();
    branchB = await newBranch();
    branchOff = await newBranch(false);
    const cat = await prisma.category.create({
      data: { slug: `zz-f23-${run}`, name: `zz-Cat ${run}` },
    });
    catId = cat.id;
    categoryIds.add(cat.id);
    pOk = await newProduct('50.00');
    pHidden = await newProduct('10.00', false);
    pSold = await newProduct('10.00');
    pCheap = await newProduct('5.00');
    await prisma.branchProduct.create({
      data: { branchId: branchA, productId: pSold, available: false },
    });
    const g = await prisma.modifierGroup.create({
      data: { name: `zz-Salsas ${run}`, minSelect: 1, maxSelect: 2 },
    });
    groupId = g.id;
    groupIds.add(g.id);
    const mk = async (name: string, price: string, active: boolean, sortOrder: number) =>
      (
        await prisma.modifier.create({
          data: { groupId, name, extraPrice: price, active, sortOrder },
        })
      ).id;
    optSoya = await mk(`zz-Soya ${run}`, '1.50', true, 0);
    optPicante = await mk(`zz-Picante ${run}`, '0.10', true, 1);
    optVieja = await mk(`zz-Vieja ${run}`, '9.00', false, 2);
    await prisma.productModifierGroup.create({ data: { productId: pOk, groupId, sortOrder: 0 } });
    customer1 = await newCustomer(auth1);
    customer2 = await newCustomer(auth2);
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    if (ready && url) {
      await withClient(url, async (c) => {
        // Solo los pedidos de las sucursales que creó ESTA prueba (incluye el ruido de #67).
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
            'order_status_history',
            'order_addresses',
            'order_items',
          ]) {
            await c.query(`DELETE FROM app.${t} WHERE order_id = ANY($1::uuid[])`, [ids]);
          }
          await c.query('DELETE FROM app.orders WHERE id = ANY($1::uuid[])', [ids]);
          await c.query(
            "DELETE FROM app.audit_events WHERE entity_type = 'order' AND entity_id = ANY($1::uuid[])",
            [ids],
          );
          await c.query('DELETE FROM app.customers WHERE full_name = $1 AND auth_user_id IS NULL', [
            `zz-Ruido ${run}`,
          ]);
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      });
    }
    await prisma.$disconnect();
    if (ready && url) {
      await withClient(url, async (c) => {
        await c.query(
          'DELETE FROM app.branch_products WHERE branch_id = ANY($1::uuid[]) OR product_id = ANY($2::uuid[])',
          [[...branchIds], [...productIds]],
        );
        await c.query(
          'DELETE FROM app.product_modifier_groups WHERE product_id = ANY($1::uuid[])',
          [[...productIds]],
        );
        await c.query('DELETE FROM app.modifiers WHERE group_id = ANY($1::uuid[])', [
          [...groupIds],
        ]);
        await c.query('DELETE FROM app.modifier_groups WHERE id = ANY($1::uuid[])', [
          [...groupIds],
        ]);
      });
      await cleanupTestData(url, { authUserIds, branchIds, productIds, categoryIds });
    }
  }, 120_000);

  it('filas 2, 3: solo los pedidos del cliente del JWT; ajenos y de invitado jamás; sin fila de cliente => vacío y NO se crea', async (ctx) => {
    skipUnlessReady(ctx);
    const mine = await seedOrder({ customerId: customer1, branch: branchA });
    const theirs = await seedOrder({ customerId: customer2, branch: branchA });
    const guest = await seedOrder({ customerId: null, branch: branchA });
    const ids1 = (await history.list(who(auth1), {})).items.map((i) => i.id);
    expect(ids1).toContain(mine);
    expect(ids1).not.toContain(theirs);
    expect(ids1).not.toContain(guest);
    const before = (await q<{ n: number }>('SELECT count(*)::int AS n FROM app.customers'))[0]?.n;
    expect(await history.list(who(authNone), {})).toMatchObject({ items: [], nextCursor: null });
    expect((await q<{ n: number }>('SELECT count(*)::int AS n FROM app.customers'))[0]?.n).toBe(
      before,
    );
    // Detalle, recibo y preview de un pedido de invitado con JWT => el mismo 404 que uno inexistente.
    for (const id of [guest, theirs, randomUUID()]) {
      const e = await err(docs.receipt(who(auth1), id, undefined));
      expect(statusOf(e)).toBe(404);
      expect((e as { getResponse: () => unknown }).getResponse()).toMatchObject({
        message: 'Pedido no encontrado',
      });
      expect(statusOf(await err(docs.previewReorder(who(auth1), id, undefined, undefined)))).toBe(
        404,
      );
    }
  });

  it('fila 5, 6, 10, 12, 13, 14: filtros, orden con placed_at idénticos, columnas mínimas, importes en cadena, sin motivo', async (ctx) => {
    skipUnlessReady(ctx);
    const t = new Date(Date.now() - 3 * 86_400_000);
    const same = new Date(t.getTime());
    const a = await seedOrder({
      customerId: customer2,
      branch: branchA,
      status: 'rejected',
      placedAt: same,
      reason: SECRET_REASON,
      lines: [
        { productId: pOk, name: 'Roll', quantity: 2, unit: '50.00' },
        { productId: pCheap, name: 'Té', quantity: 3, unit: '5.00' },
      ],
    });
    const b = await seedOrder({
      customerId: customer2,
      branch: branchB,
      status: 'cancelled',
      placedAt: same,
      reason: SECRET_REASON,
    });
    const c = await seedOrder({
      customerId: customer2,
      branch: branchA,
      status: 'pending',
      delivery: true,
      provider: 'PEDIDOSYA',
      placedAt: new Date(t.getTime() + 1000),
    });
    const page = await history.list(who(auth2), {});
    const ours = page.items.filter((i) => [a, b, c].includes(i.id));
    // más reciente primero; los dos con el MISMO placed_at se desempatan por id DESC
    expect(ours.map((i) => i.id)).toEqual([c, ...[a, b].sort().reverse()]);
    const rowA = ours.find((i) => i.id === a);
    expect(rowA).toMatchObject({
      itemCount: 5,
      total: '115.00',
      currency: 'GTQ',
      status: 'rejected',
      publicStatus: 'rejected',
      terminal: true,
    });
    expect(typeof rowA?.total).toBe('string');
    expect(ours.find((i) => i.id === c)).toMatchObject({
      deliveryProvider: 'PEDIDOSYA',
      terminal: false,
    });
    const raw = JSON.stringify(page);
    for (const secret of [
      SECRET_REASON,
      SECRET_EMAIL,
      'zz-Nombre Secreto',
      'zz-DIRECCION',
      'zz-nota',
      '+5025',
    ]) {
      expect(raw).not.toContain(secret);
    }
    const onlyRejected = await history.list(who(auth2), { status: ['rejected'] });
    expect(onlyRejected.items.every((i) => i.status === 'rejected')).toBe(true);
    const byBranch = await history.list(who(auth2), { branchId: branchB });
    expect(byBranch.items.map((i) => i.id)).toContain(b);
    expect(byBranch.items.every((i) => i.branchId === branchB)).toBe(true);
    const window = await history.list(who(auth2), {
      from: new Date(t.getTime() - 1000).toISOString(),
      to: new Date(t.getTime() + 500).toISOString(),
    });
    expect(window.items.map((i) => i.id).sort()).toEqual([a, b].sort());
  });

  it('filas 6, 7, 8: keyset sin duplicados ni saltos aunque lleguen pedidos entre páginas; recorrido completo; cursor ajeno no filtra', async (ctx) => {
    skipUnlessReady(ctx);
    const base = Date.now() - 30 * 86_400_000;
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      created.push(
        await seedOrder({
          customerId: customer1,
          branch: branchB,
          placedAt: new Date(base + Math.floor(i / 2) * 60_000),
        }),
      ); // pares con placed_at idéntico
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let injected = false;
    for (let guard = 0; guard < 20; guard += 1) {
      const page = await history.list(who(auth1), {
        branchId: branchB,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((i) => i.id));
      if (!injected) {
        created.push(await seedOrder({ customerId: customer1, branch: branchB })); // más reciente que todo
        injected = true;
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length); // sin duplicados
    expect(seen.length).toBe(5); // el pedido inyectado queda ANTES del cursor: no aparece ni desplaza
    expect(created.slice(0, 5).every((id) => seen.includes(id))).toBe(true);
    // Un cursor demasiado en el futuro es inválido; uno válido solo fija la posición: jamás devuelve datos ajenos.
    const foreign = encodeCursor({ placedAtKey: '2099-01-01T00:00:00.000000Z', id: randomUUID() });
    const bad = await err(history.list(who(auth1), { cursor: foreign }));
    expect(codeOf(bad)).toBe('ORDER_CURSOR_INVALID'); // más de un día en el futuro
    const cur = encodeCursor({
      placedAtKey: new Date(Date.now() - 1000).toISOString().replace('Z', '000Z'),
      id: randomUUID(),
    });
    const other = await history.list(who(auth2), { cursor: cur, limit: 50 });
    expect(other.items.every((i) => !seen.includes(i.id))).toBe(true);
    expect(codeOf(await err(history.list(who(auth1), { cursor: 'zzz' })))).toBe(
      'ORDER_CURSOR_INVALID',
    );
  });

  it('filas 18, 21, 22, 23, 24, 25: recibo desde snapshots, sin PII ni internos, inmune a cambios del catálogo, mismas cifras que getOrder', async (ctx) => {
    skipUnlessReady(ctx);
    const product = await prisma.product.create({
      data: {
        categoryId: catId,
        slug: `zz-f23-${run}-r`,
        name: `zz-Original ${run}`,
        basePrice: '20.00',
      },
      select: { id: true },
    });
    productIds.add(product.id);
    const id = await seedOrder({
      customerId: customer1,
      branch: branchA,
      status: 'rejected',
      delivery: true,
      reason: SECRET_REASON,
      lines: [
        {
          productId: product.id,
          name: `zz-Original ${run}`,
          quantity: 2,
          unit: '20.00',
          extras: '1.50',
          discount: '4.00',
          mods: [{ id: optSoya, name: 'Soya', price: '1.50' }],
        },
      ],
    });
    const before = await docs.receipt(who(auth1), id, undefined);
    await prisma.product.update({
      where: { id: product.id },
      data: { name: `zz-CAMBIADO ${run}`, basePrice: '99.00' },
    });
    await prisma.modifier.update({
      where: { id: optSoya },
      data: { name: `zz-Soya NUEVA ${run}`, extraPrice: '7.00' },
    });
    const after = await docs.receipt(who(auth1), id, undefined);
    expect({ ...after, generatedAt: '' }).toEqual({ ...before, generatedAt: '' });
    await prisma.modifier.update({
      where: { id: optSoya },
      data: { name: `zz-Soya ${run}`, extraPrice: '1.50' },
    });
    expect(before).toMatchObject({
      fiscalStatus: 'NOT_FISCAL',
      timeZone: 'America/Guatemala',
      status: 'rejected',
      payment: { status: 'NOT_STARTED', methodPreference: 'cash' },
      total: '54.00', // 2 x (20.00 + 1.50) - 4.00 + 15.00 (entrega)
    });
    expect(before.address).toMatchObject({ addressLine: 'zz-DIRECCION' });
    const raw = JSON.stringify(before);
    for (const forbidden of [
      id,
      branchA,
      customer1,
      SECRET_REASON,
      SECRET_EMAIL,
      '14.6',
      '-90.5',
      '+5025',
      'smo_',
      'changedBy',
      'latitude',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    // #23: mismas cifras que getOrder del mismo pedido
    const detail = toOrderDetail(
      (await ordersRepo.findForCustomer(id, customer1)) as NonNullable<
        Awaited<ReturnType<OrdersRepository['findForCustomer']>>
      >,
    );
    expect(before.lines).toEqual(detail.lines);
    for (const k of ['subtotal', 'extrasTotal', 'discountTotal', 'deliveryFee', 'total'] as const) {
      expect(before[k]).toBe(detail[k]);
    }
    // #24: disponible en todos los estados
    for (const status of ['pending', 'accepted', 'ready', 'picked_up', 'delivered', 'cancelled']) {
      const sid = await seedOrder({ customerId: customer1, branch: branchA, status });
      expect(await docs.receipt(who(auth1), sid, undefined)).toMatchObject({
        status,
        payment: { status: 'NOT_STARTED' },
      });
    }
    // #25: PICKUP sin dirección ni proveedor
    const pickup = await seedOrder({ customerId: customer1, branch: branchA });
    expect(await docs.receipt(who(auth1), pickup, undefined)).toMatchObject({
      address: null,
      fulfillment: { type: 'PICKUP', provider: null },
    });
  });

  it('filas 19, 20, 73: invitado con token vigente 200; vencido, revocado, ajeno o sin token => MISMO 404; inexistente, ajeno y de invitado con JWT => mismo número de sentencias', async (ctx) => {
    skipUnlessReady(ctx);
    const token = (c: string) => `smo_${randomUUID().replace(/-/g, '').padEnd(43, c).slice(0, 43)}`;
    const good = token('A');
    const old = token('B');
    const revoked = token('C');
    const id = await seedOrder({
      customerId: null,
      branch: branchA,
      token: { raw: good, expiresInMs: 86_400_000 },
    });
    const expired = await seedOrder({
      customerId: null,
      branch: branchA,
      token: { raw: old, expiresInMs: -1000 },
    });
    const revokedId = await seedOrder({
      customerId: null,
      branch: branchA,
      token: { raw: revoked, expiresInMs: 86_400_000, revoked: true },
    });
    const owned = await seedOrder({ customerId: customer2, branch: branchA });
    expect(await docs.receipt(undefined, id, good)).toMatchObject({ fiscalStatus: 'NOT_FISCAL' });
    expect((await docs.previewReorder(undefined, id, good, {})).lines.length).toBe(1);
    for (const denied of [
      docs.receipt(undefined, expired, old), // vencido
      docs.receipt(undefined, revokedId, revoked), // revocado
      docs.receipt(undefined, id, old), // token de OTRO pedido
      docs.receipt(undefined, id, undefined), // sin token ni JWT
      docs.previewReorder(undefined, expired, old, undefined),
    ]) {
      const e = await err(denied);
      expect(statusOf(e)).toBe(404);
      expect((e as { getResponse: () => unknown }).getResponse()).toMatchObject({
        message: 'Pedido no encontrado',
      });
    }
    // Inexistente, ajeno (otro cliente) y de invitado, todos con el JWT de auth1: el mismo 404 y el mismo número de sentencias.
    const runs = [];
    for (const target of [randomUUID(), owned, id]) {
      const m = await measure(() => err(docs.receipt(who(auth1), target, undefined)));
      expect(statusOf(m.result)).toBe(404);
      runs.push(m.n);
    }
    expect(new Set(runs).size).toBe(1);
  });

  it('filas 27-40, 28, 43: vista previa contra el catálogo real; BRANCH_NOT_FOUND tras autorizar; NO escribe nada', async (ctx) => {
    skipUnlessReady(ctx);
    const gone = `zz-Fantasma ${run}`;
    const id = await seedOrder({
      customerId: customer1,
      branch: branchA,
      lines: [
        {
          productId: pOk,
          name: 'Roll',
          quantity: 2,
          unit: '40.00',
          extras: '1.60',
          mods: [
            { id: optSoya, name: 'Soya', price: '1.50' },
            { id: optPicante, name: 'Picante', price: '0.10' },
            { id: optVieja, name: 'Vieja', price: '9.00' },
            { id: null, name: gone, price: '2.00' },
          ],
          notes: 'sin wasabi',
        },
        { productId: null, name: 'Producto borrado', quantity: 1, unit: '10.00' },
        { productId: pHidden, name: 'Oculto', quantity: 1, unit: '10.00' },
        { productId: pSold, name: 'Agotado', quantity: 1, unit: '10.00' },
        { productId: pCheap, name: 'Té', quantity: 1, unit: '5.00' },
      ],
    });
    const before = await counts();
    const p = await docs.previewReorder(who(auth1), id, undefined, undefined);
    const byNo = (n: number) => p.lines.find((l) => l.lineNo === n);
    // #33/#34: opción retirada e inactiva => NEEDS_CONFIGURATION; la opción NO se sustituye
    expect(byNo(1)?.status).toBe('NEEDS_CONFIGURATION');
    expect(byNo(1)?.issues.map((i) => i.code)).toEqual([
      'OPTION_INACTIVE',
      'OPTION_REMOVED',
      'PRICE_CHANGED',
    ]);
    expect(
      byNo(1)
        ?.candidate?.line.selections.map((s) => s.optionId)
        .sort(),
    ).toEqual([optSoya, optPicante].sort());
    expect(byNo(2)).toMatchObject({ status: 'UNAVAILABLE', current: null, candidate: null });
    expect(byNo(2)?.issues[0]?.code).toBe('PRODUCT_REMOVED');
    expect(byNo(3)?.issues[0]?.code).toBe('PRODUCT_INACTIVE');
    expect(byNo(4)?.issues[0]?.code).toBe('PRODUCT_OUT_OF_STOCK');
    expect(byNo(4)?.current?.unitPrice).toBe('10.00');
    expect(byNo(5)).toMatchObject({
      status: 'AVAILABLE',
      issues: [],
      candidate: { line: { productId: pCheap, quantity: 1 } },
    });
    expect(p.summary).toMatchObject({
      lines: 5,
      available: 1,
      needsConfiguration: 1,
      unavailable: 3,
      canAddAny: true,
      units: 1,
      estimatedSubtotal: '5.00',
    });
    // #28: sin escrituras (conteos y secuencia intactos) y sin Idempotency-Key
    expect(await counts()).toEqual(before);
    // #27: BRANCH_NOT_FOUND solo tras autorizar
    expect(
      codeOf(await err(docs.previewReorder(who(auth1), id, undefined, { branchId: randomUUID() }))),
    ).toBe('BRANCH_NOT_FOUND');
    expect(
      codeOf(await err(docs.previewReorder(who(auth2), id, undefined, { branchId: randomUUID() }))),
    ).toBeUndefined();
    // #39: sucursal inactiva => todas UNAVAILABLE con BRANCH_UNAVAILABLE; #40: otra sucursal
    // Sucursal DISTINTA inactiva => 404 BRANCH_NOT_FOUND como una inexistente (no revela el estado); inactiva ORIGINAL => bloquea.
    expect(
      codeOf(await err(docs.previewReorder(who(auth1), id, undefined, { branchId: branchOff }))),
    ).toBe('BRANCH_NOT_FOUND');
    const inOff = await seedOrder({ customerId: customer1, branch: branchOff });
    const off = await docs.previewReorder(who(auth1), inOff, undefined, undefined);
    expect(off.branch).toMatchObject({ active: false, sameBranch: true });
    expect(
      off.lines.every(
        (l) => l.status === 'UNAVAILABLE' && l.issues[0]?.code === 'BRANCH_UNAVAILABLE',
      ),
    ).toBe(true);
    const other = await docs.previewReorder(who(auth1), id, undefined, { branchId: branchB });
    expect(other.branch).toMatchObject({
      sameBranch: false,
      originalBranchId: branchA,
      requestedBranchId: branchB,
    });
    expect(other.lines.find((l) => l.lineNo === 4)?.status).not.toBe('UNAVAILABLE'); // agotado solo en la sucursal A
    // sin horario configurado `acceptingOrders` puede ser false: solo avisa, las líneas se evalúan igual
    // #37: cambio de precio de un extra y del producto en la sucursal pedida
    await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId: branchA, productId: pCheap } },
      create: { branchId: branchA, productId: pCheap, priceOverride: '6.00' },
      update: { priceOverride: '6.00' },
    });
    const changed = await docs.previewReorder(who(auth1), id, undefined, undefined);
    expect(changed.lines.find((l) => l.lineNo === 5)?.issues).toEqual([
      expect.objectContaining({
        code: 'PRICE_CHANGED',
        previousUnitPrice: '5.00',
        currentUnitPrice: '6.00',
      }),
    ]);
  });

  it('filas 26, 43, 66: presupuesto de sentencias con pedidos de 30 líneas (recibo <= 5, preview <= 8, lista <= 2) sin N+1', async (ctx) => {
    skipUnlessReady(ctx);
    const products: string[] = [];
    for (let i = 0; i < 30; i += 1) products.push(await newProduct('10.00'));
    const lines: SeedLine[] = products.map((p, i) => ({
      productId: p,
      name: `P${i}`,
      quantity: 1,
      unit: '10.00',
    }));
    const big = await seedOrder({ customerId: customer2, branch: branchA, lines });
    for (let i = 0; i < 20; i += 1)
      await seedOrder({ customerId: customer2, branch: branchA, lines: lines.slice(0, 5) });
    const receipt = await measure(() => docs.receipt(who(auth2), big, undefined));
    expect(receipt.result.lines).toHaveLength(30);
    expect(receipt.n).toBeLessThanOrEqual(5);
    const preview = await measure(() => docs.previewReorder(who(auth2), big, undefined, undefined));
    expect(preview.result.lines).toHaveLength(30);
    expect(preview.n).toBeLessThanOrEqual(8);
    const other = await measure(() =>
      docs.previewReorder(who(auth2), big, undefined, { branchId: branchB }),
    );
    expect(other.n).toBeLessThanOrEqual(8);
    const list = await measure(() => history.list(who(auth2), { limit: 50 }));
    expect(list.result.items.length).toBeGreaterThan(20);
    expect(list.n).toBeLessThanOrEqual(2);
  }, 120_000);

  it('fila 46: un cambio de catálogo durante la lectura no produce estados mixtos ni errores', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder({
      customerId: customer1,
      branch: branchA,
      lines: [{ productId: pCheap, name: 'Té', quantity: 1, unit: '5.00' }],
    });
    const writer = prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId: branchA, productId: pCheap } },
      create: { branchId: branchA, productId: pCheap, available: false },
      update: { available: false, priceOverride: '7.00' },
    });
    const [p] = await Promise.all([
      docs.previewReorder(who(auth1), id, undefined, undefined),
      writer,
    ]);
    const line = p.lines[0];
    // O la versión anterior (AVAILABLE) o la nueva (agotado): nunca una mezcla (p. ej. AVAILABLE sin candidato).
    expect(['AVAILABLE', 'UNAVAILABLE']).toContain(line?.status);
    expect(line?.status === 'AVAILABLE' ? line.candidate !== null : line?.candidate === null).toBe(
      true,
    );
  });

  it('fila 67: EXPLAIN del listado con volumen sembrado usa orders_customer_placed_idx y no ordena todo el historial', async (ctx) => {
    skipUnlessReady(ctx);
    // Ruido: pedidos de clientes sin cuenta (auth_user_id NULL) en UNA sentencia set-based, y un cliente con cientos de pedidos.
    await q(`INSERT INTO app.customers (full_name) SELECT $1 FROM generate_series(1, 200)`, [
      `zz-Ruido ${run}`,
    ]);
    await q(
      `INSERT INTO app.orders (branch_id, customer_id, customer_name, customer_phone, fulfillment_type, status, subtotal, total, placed_at)
       WITH noise AS (SELECT array_agg(id ORDER BY id) AS ids FROM app.customers WHERE full_name = $2)
       SELECT $1::uuid, noise.ids[1 + (g % 200)], 'zz-ruido', '+50255550000',
              'PICKUP', 'delivered', 10, 10, now() - (g * interval '1 minute')
         FROM generate_series(1, $3::int) g, noise`,
      [branchA, `zz-Ruido ${run}`, NOISE],
    );
    await q(
      `INSERT INTO app.orders (branch_id, customer_id, customer_name, customer_phone, fulfillment_type, status, subtotal, total, placed_at)
       SELECT $1::uuid, $2::uuid, 'zz-ruido', '+50255550001', 'PICKUP', 'delivered', 10, 10, now() - (g * interval '7 minute')
         FROM generate_series(1, 400) g`,
      [branchA, customer1],
    );
    await q('ANALYZE app.orders');
    capture = null;
    const { n } = await measure(() => history.list(who(auth1), { limit: 20 }));
    expect(n).toBeLessThanOrEqual(2);
    expect(capture).not.toBeNull();
    const cap = capture as unknown as { text: string; values: unknown[] };
    const plan = (
      await withClient(url as string, (c) =>
        c.query<{ 'QUERY PLAN': unknown }>(`EXPLAIN (FORMAT JSON) ${cap.text}`, cap.values),
      )
    ).rows[0]?.['QUERY PLAN'];
    const text = JSON.stringify(plan);
    console.info('[order-history.int-spec] EXPLAIN listado:', text);
    // Documenta si hace falta el índice opcional (spec 024 §2.1): el plan DEBE usar el índice 0018 del cliente.
    expect(text).toContain('orders_customer_placed_idx');
  }, 180_000);
});
