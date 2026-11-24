import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import type { Principal } from '../src/auth/auth.types.js';
import type { Clock } from '../src/branch-schedule/clock.js';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { IdentityService } from '../src/identity/identity.service.js';
import { issueGuestToken } from '../src/orders/order-access-token.js';
import { ordersBusy } from '../src/orders/orders-errors.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';
import { OrdersService } from '../src/orders/orders.service.js';
import {
  cleanupTestData,
  ensureAuthStub,
  TEST_URL,
  withClient,
  deletePaymentsOf,
} from './support/db.js';

const url = TEST_URL;

/**
 * F21 (seguimiento de pedidos) contra PostgreSQL REAL. Se omite (con aviso) sin DATABASE_URL_TEST o si faltan las tablas de
 * 0018. NO se ejecuta contra el Supabase compartido sin autorización: usar una BD desechable o el proyecto de pruebas.
 * F21 es SOLO LECTURA y NO hay F22: los pedidos y sus eventos de historial se INSERTAN directamente por SQL (incluidos
 * `reason` y `changed_by` con valores centinela que jamás deben salir en la respuesta). La limpieza usa las excepciones
 * controladas `app.allow_order_cleanup` (0018) y `app.allow_audit_cleanup` (0004) SOLO sobre los pedidos de las sucursales
 * que crea la propia prueba. Ejecutada 12/12 contra el Supabase de pruebas el 2026-11-18 (con autorización explícita del usuario).
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['app.branches','app.customers','app.orders','app.order_addresses','app.order_status_history','app.order_access_tokens']) t
          WHERE to_regclass(t) IS NOT NULL`,
      );
      return (res.rows[0]?.n ?? 0) === 6;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[orders-tracking.int-spec] OMITIDA: faltan tablas de la migración 0018 en DATABASE_URL_TEST. El SQL de F21 NO se probó contra PostgreSQL real.',
  );
}

const BASE = Date.parse('2026-11-18T16:00:00.000Z');
const iso = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString();

interface SeedEvent {
  id?: string;
  old: string | null;
  next: string;
  minutes: number;
}

describe.skipIf(!url || !ready)('Seguimiento de pedidos contra PostgreSQL real (F21)', () => {
  const run = randomUUID().slice(0, 8);
  const NAME = `NOMBRE-SECRETO-${run}`;
  const NOTES = `NOTA-SECRETA-${run}`;
  const REASON = `RAZON-SECRETA-${run}`;
  const ADDRESS = `DIRECCION-SECRETA-${run}`;
  let prisma: PrismaService;
  let repo: OrdersRepository;
  let identity: IdentityService;
  let orders: OrdersService;
  let branchId = '';
  const branchIds = new Set<string>();
  const authUserIds = new Set<string>();
  const changedBy = randomUUID();
  const clock = { current: new Date() };
  const queries = { n: 0 };
  let originalQuery: typeof pg.Client.prototype.query;
  let phoneSeq = 0;

  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('faltan tablas de 0018');
  };
  const err = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const statusOf = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
    withClient(url as string, (c) => c.query<T>(sql, params)).then((r) => r.rows);

  const newPrincipal = async (): Promise<Principal> => {
    const p: Principal = {
      authUserId: randomUUID(),
      email: `${randomUUID().slice(0, 8)}@sushimon.test`,
      provider: 'google',
      googleOAuth: true,
      aal: 'aal1',
      displayName: 'Cliente F21',
      avatarUrl: null,
    };
    authUserIds.add(p.authUserId);
    await withClient(url as string, (c) =>
      c.query('INSERT INTO auth.users (id) VALUES ($1)', [p.authUserId]),
    );
    await identity.ensureCustomer(p);
    return p;
  };

  /** Inserta un pedido (y sus eventos de historial y un token de invitado) por SQL, en UNA transacción. */
  const seedOrder = async (
    o: {
      fulfillment?: 'PICKUP' | 'DELIVERY';
      provider?: 'OWN' | 'PEDIDOSYA' | null;
      status?: string;
      owner?: Principal;
      events?: SeedEvent[];
      token?: 'valid' | 'expired' | 'revoked' | 'none';
    } = {},
  ) => {
    const fulfillment = o.fulfillment ?? 'PICKUP';
    const provider = fulfillment === 'DELIVERY' ? (o.provider ?? 'OWN') : null;
    const id = randomUUID();
    const issued = issueGuestToken(new Date());
    const tokenKind = o.token ?? (o.owner ? 'none' : 'valid');
    phoneSeq += 1;
    await withClient(url as string, async (c) => {
      await c.query('BEGIN');
      try {
        const customer = o.owner
          ? (
              await c.query<{ id: string }>(
                'SELECT id FROM app.customers WHERE auth_user_id = $1',
                [o.owner.authUserId],
              )
            ).rows[0]?.id
          : null;
        await c.query(
          `INSERT INTO app.orders (id, customer_id, branch_id, customer_name, customer_phone, customer_email,
                                   fulfillment_type, delivery_provider, notes, status, subtotal, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 100, 100)`,
          [
            id,
            customer ?? null,
            branchId,
            NAME,
            `+5025${String(5000000 + phoneSeq).padStart(7, '0')}`.slice(0, 12),
            `pii-${run}@example.com`,
            fulfillment,
            provider,
            NOTES,
            o.status ?? 'pending',
          ],
        );
        if (fulfillment === 'DELIVERY') {
          await c.query(
            `INSERT INTO app.order_addresses (order_id, municipality_name, zone, address_line)
             VALUES ($1, 'Guatemala', 'Zona 10', $2)`,
            [id, ADDRESS],
          );
        }
        const events = o.events ?? [{ old: null, next: 'pending', minutes: 0 }];
        for (const e of events) {
          await c.query(
            `INSERT INTO app.order_status_history (id, order_id, old_status, new_status, changed_by, reason, changed_at)
             VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7)`,
            [e.id ?? null, id, e.old, e.next, changedBy, REASON, iso(e.minutes)],
          );
        }
        if (tokenKind !== 'none') {
          const expired = tokenKind === 'expired';
          await c.query(
            `INSERT INTO app.order_access_tokens (order_id, token_hash, created_at, expires_at, revoked_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              id,
              issued.hash,
              expired ? new Date(Date.now() - 2 * 86_400_000) : new Date(),
              expired ? new Date(Date.now() - 86_400_000) : issued.expiresAt,
              tokenKind === 'revoked' ? new Date() : null,
            ],
          );
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    return { id, token: issued.token };
  };

  const flow = (...next: string[]): SeedEvent[] =>
    next.map((status, i) => ({
      old: i === 0 ? null : (next[i - 1] as string),
      next: status,
      minutes: i * 5,
    }));

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
      queries.n += 1;
      return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
    });
    await withClient(url as string, ensureAuthStub);
    prisma = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '12', NODE_ENV: 'test' }),
      ),
    );
    const audit = new AuditService();
    identity = new IdentityService(prisma, audit);
    repo = new OrdersRepository(prisma, audit);
    const testClock: Clock = { now: () => clock.current };
    // F21 solo usa identidad, repositorio, reloj y gate; el resto de colaboradores de F20 no interviene.
    orders = new OrdersService(
      identity,
      repo,
      {} as never,
      {} as never,
      {} as never,
      testClock,
      new DbGate(10, 40, 10_000, ordersBusy),
      {} as never,
    );
    const b = await prisma.branch.create({
      data: { code: `ot-${run}`, name: `Suc ${run}`, address: 'Zona 1' },
    });
    branchId = b.id;
    branchIds.add(b.id);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    if (ready && url) {
      // Solo los pedidos de la sucursal que creó ESTA prueba.
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
          for (const t of ['order_access_tokens', 'order_status_history', 'order_addresses']) {
            await c.query(`DELETE FROM app.${t} WHERE order_id = ANY($1::uuid[])`, [ids]);
          }
          await deletePaymentsOf(c, ids); // F24 (0019): FK RESTRICT hacia orders
          await c.query('DELETE FROM app.orders WHERE id = ANY($1::uuid[])', [ids]);
          await c.query(
            "DELETE FROM app.audit_events WHERE entity_type = 'order' AND entity_id = ANY($1::uuid[])",
            [ids],
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
      await cleanupTestData(url, { authUserIds, branchIds, productIds: [], categoryIds: [] });
    }
  });

  it('filas 4, 17: recorrido pending->accepted->preparing->ready->picked_up de un PICKUP, en orden y con horas reales', async (ctx) => {
    skipUnlessReady(ctx);
    const o = await seedOrder({
      status: 'picked_up',
      events: flow('pending', 'accepted', 'preparing', 'ready', 'picked_up'),
    });
    const t = await orders.getTracking(undefined, o.id, o.token);
    expect(t.events.map((e) => [e.seq, e.status, e.publicStatus])).toEqual([
      [1, 'pending', 'received'],
      [2, 'accepted', 'accepted'],
      [3, 'preparing', 'preparing'],
      [4, 'ready', 'ready'],
      [5, 'picked_up', 'completed'],
    ]);
    expect(t.events.map((e) => e.occurredAt)).toEqual([0, 5, 10, 15, 20].map(iso));
    expect(t).toMatchObject({
      status: 'picked_up',
      publicStatus: 'completed',
      terminal: true,
      pollAfterSeconds: null,
      fulfillmentType: 'PICKUP',
      delivery: null,
      eventsTruncated: false,
    });
    expect(t.steps.map((s) => [s.phase, s.reachedAt])).toEqual([
      ['received', iso(0)],
      ['accepted', iso(5)],
      ['preparing', iso(10)],
      ['ready', iso(15)],
      ['completed', iso(20)],
    ]);
  });

  it('fila 3: rechazo y cancelación (desde ready) cortan el recorrido', async (ctx) => {
    skipUnlessReady(ctx);
    const rejected = await seedOrder({ status: 'rejected', events: flow('pending', 'rejected') });
    const r = await orders.getTracking(undefined, rejected.id, rejected.token);
    expect(r.steps.map((s) => s.phase)).toEqual(['received', 'rejected']);
    expect(r).toMatchObject({ terminal: true, publicStatus: 'rejected', pollAfterSeconds: null });
    const cancelled = await seedOrder({
      status: 'cancelled',
      events: flow('pending', 'accepted', 'preparing', 'ready', 'cancelled'),
    });
    const c = await orders.getTracking(undefined, cancelled.id, cancelled.token);
    expect(c.steps.map((s) => s.phase)).toEqual([
      'received',
      'accepted',
      'preparing',
      'ready',
      'cancelled',
    ]);
    expect(c.terminal).toBe(true);
  });

  it('fila 4: duplicados, desorden y salto => events tal cual (orden changed_at), steps sin inventar, status manda', async (ctx) => {
    skipUnlessReady(ctx);
    const o = await seedOrder({
      status: 'ready',
      events: [
        { old: 'accepted', next: 'preparing', minutes: 10 }, // insertado antes que `pending`: la consulta ordena
        { old: null, next: 'pending', minutes: 0 },
        { old: 'accepted', next: 'preparing', minutes: 12 }, // duplicado
        { old: 'preparing', next: 'accepted', minutes: 14 }, // fuera de orden de negocio
      ],
    });
    const t = await orders.getTracking(undefined, o.id, o.token);
    expect(t.events.map((e) => e.status)).toEqual([
      'pending',
      'preparing',
      'preparing',
      'accepted',
    ]);
    expect(t.status).toBe('ready');
    expect(t.publicStatus).toBe('ready');
    const byPhase = Object.fromEntries(t.steps.map((s) => [s.phase, s.reachedAt]));
    expect(byPhase['preparing']).toBe(iso(10)); // el PRIMER evento de la fase
    expect(byPhase['accepted']).toBe(iso(14)); // la única vez que aparece, tal cual
    expect(byPhase['ready']).toBeNull(); // sin evento: no se inventa
  });

  it('fila 5: empates de changed_at se desempatan por id (determinista); seq 1..N', async (ctx) => {
    skipUnlessReady(ctx);
    const o = await seedOrder({
      status: 'preparing',
      events: [
        {
          id: '00000000-0000-4000-8000-00000000000c',
          old: 'accepted',
          next: 'preparing',
          minutes: 5,
        },
        { id: '00000000-0000-4000-8000-00000000000a', old: null, next: 'pending', minutes: 5 },
        {
          id: '00000000-0000-4000-8000-00000000000b',
          old: 'pending',
          next: 'accepted',
          minutes: 5,
        },
      ],
    });
    const t = await orders.getTracking(undefined, o.id, o.token);
    expect(t.events.map((e) => [e.seq, e.status])).toEqual([
      [1, 'pending'],
      [2, 'accepted'],
      [3, 'preparing'],
    ]);
  });

  it('fila 5: más de 50 eventos => los 50 MÁS RECIENTES (se conserva el último) y eventsTruncated', async (ctx) => {
    skipUnlessReady(ctx);
    const many: SeedEvent[] = Array.from({ length: 55 }, (_, i) => ({
      old: i === 0 ? null : 'pending',
      next: i === 0 ? 'pending' : i % 2 ? 'accepted' : 'pending',
      minutes: i,
    }));
    const o = await seedOrder({ status: 'pending', events: many });
    const t = await orders.getTracking(undefined, o.id, o.token);
    expect(t.events).toHaveLength(50);
    expect(t.eventsTruncated).toBe(true);
    expect(t.events[0]?.occurredAt).toBe(iso(5));
    expect(t.events.at(-1)?.occurredAt).toBe(iso(54));
    const exact = await seedOrder({ events: many.slice(0, 50) });
    const t50 = await orders.getTracking(undefined, exact.id, exact.token);
    expect(t50.events).toHaveLength(50);
    expect(t50.eventsTruncated).toBe(false);
  });

  it('fila 6: sin historial => events [], steps desde el estado, sin error', async (ctx) => {
    skipUnlessReady(ctx);
    const o = await seedOrder({ status: 'accepted', events: [] });
    const t = await orders.getTracking(undefined, o.id, o.token);
    expect(t.events).toEqual([]);
    expect(t.eventsTruncated).toBe(false);
    expect(t.publicStatus).toBe('accepted');
    expect(t.pollAfterSeconds).toBe(20);
    expect(t.steps.every((s) => s.reachedAt === null)).toBe(true);
  });

  it('fila 15: PICKUP null; DELIVERY OWN y PEDIDOSYA con solo el proveedor', async (ctx) => {
    skipUnlessReady(ctx);
    const pickup = await seedOrder();
    expect((await orders.getTracking(undefined, pickup.id, pickup.token)).delivery).toBeNull();
    const own = await seedOrder({
      fulfillment: 'DELIVERY',
      provider: 'OWN',
      status: 'on_the_way',
      events: flow('pending', 'accepted', 'preparing', 'ready', 'on_the_way'),
    });
    const o = await orders.getTracking(undefined, own.id, own.token);
    expect(o.delivery).toEqual({ provider: 'OWN', status: null });
    expect(o.steps.map((s) => s.phase)).toEqual([
      'received',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'completed',
    ]);
    expect(o.pollAfterSeconds).toBe(15);
    const py = await seedOrder({ fulfillment: 'DELIVERY', provider: 'PEDIDOSYA' });
    expect((await orders.getTracking(undefined, py.id, py.token)).delivery).toEqual({
      provider: 'PEDIDOSYA',
      status: null,
    });
  });

  it('fila 7: ni contacto, correo, notas, dirección, reason, changed_by ni ids salen en la respuesta', async (ctx) => {
    skipUnlessReady(ctx);
    const o = await seedOrder({
      fulfillment: 'DELIVERY',
      status: 'accepted',
      events: flow('pending', 'accepted'),
    });
    const t = await orders.getTracking(undefined, o.id, o.token);
    const raw = JSON.stringify(t);
    for (const secret of [
      NAME,
      NOTES,
      REASON,
      ADDRESS,
      changedBy,
      o.token,
      `pii-${run}`,
      '+5025',
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(Object.keys(t.events[0] ?? {}).sort()).toEqual([
      'occurredAt',
      'publicStatus',
      'seq',
      'status',
    ]);
    const rows = await q<{ id: string }>(
      'SELECT id FROM app.order_status_history WHERE order_id = $1',
      [o.id],
    );
    for (const row of rows) expect(raw).not.toContain(row.id);
  });

  it('filas 8, 9: dueño por JWT; ajeno, invitado con JWT, sin token, vencido, revocado, de otro pedido e inexistente => 404', async (ctx) => {
    skipUnlessReady(ctx);
    const owner = await newPrincipal();
    const stranger = await newPrincipal();
    const mine = await seedOrder({ owner });
    const guest = await seedOrder();
    const other = await seedOrder();
    const expired = await seedOrder({ token: 'expired' });
    const revoked = await seedOrder({ token: 'revoked' });

    expect((await orders.getTracking(owner, mine.id, undefined)).orderId).toBe(mine.id);
    expect((await orders.getTracking(undefined, guest.id, guest.token)).orderId).toBe(guest.id);
    // Con JWT y un token válido del mismo pedido de invitado el acceso es por el TOKEN (no por la sesión).
    expect((await orders.getTracking(owner, guest.id, guest.token)).orderId).toBe(guest.id);

    const denied: Array<() => Promise<unknown>> = [
      () => orders.getTracking(stranger, mine.id, undefined),
      () => orders.getTracking(owner, guest.id, undefined), // pedido de invitado con JWT (P59)
      () => orders.getTracking(undefined, mine.id, undefined),
      () => orders.getTracking(undefined, guest.id, undefined),
      () => orders.getTracking(undefined, guest.id, other.token),
      () => orders.getTracking(undefined, expired.id, expired.token),
      () => orders.getTracking(undefined, revoked.id, revoked.token),
      () => orders.getTracking(undefined, randomUUID(), guest.token),
    ];
    for (const d of denied) expect(statusOf(await err(d()))).toBe(404);
  });

  it('fila 14: presupuesto de consultas (invitado <= 4, dueño <= 4, token fallido + JWT <= 8; F24 añade la búsqueda del pago y F28 la de la entrega) y SIN N+1 con 50 eventos', async (ctx) => {
    skipUnlessReady(ctx);
    const owner = await newPrincipal();
    const small = await seedOrder({});
    const big = await seedOrder({
      events: Array.from({ length: 52 }, (_, i) => ({ old: null, next: 'pending', minutes: i })),
    });
    const mine = await seedOrder({ owner });
    await orders.getTracking(undefined, small.id, small.token); // calienta el pool/plan
    const count = async (fn: () => Promise<unknown>) => {
      const before = queries.n;
      await fn();
      return queries.n - before;
    };
    const guestSmall = await count(() => orders.getTracking(undefined, small.id, small.token));
    const guestBig = await count(() => orders.getTracking(undefined, big.id, big.token));
    const ownerCount = await count(() => orders.getTracking(owner, mine.id, undefined));
    // F24 (spec 025 §11): pedido + historial + pago (búsqueda por la única `payments_order_key`): 3, sin N+1. F28 (spec 029 §12)
    // añade la entrega (`deliveries` por `UNIQUE(order_id)`, estrategia de carga por defecto de Prisma): 4, sin N+1.
    expect(guestSmall).toBeLessThanOrEqual(4);
    expect(guestBig).toBe(guestSmall);
    expect(ownerCount).toBeLessThanOrEqual(4);
    // El fallo ejecuta las MISMAS sentencias que el éxito (404 uniforme).
    const failedAlone = await count(() =>
      orders.getTracking(undefined, mine.id, big.token).catch(() => null),
    );
    expect(failedAlone).toBe(guestSmall);
    const tokenThenOwner = await count(() => orders.getTracking(owner, mine.id, big.token));
    expect(tokenThenOwner).toBeLessThanOrEqual(8); // token fallido (4) + dueño (4)
  });

  it('fila 16: solo lectura (no cambia orders, historial, tokens ni auditoría)', async (ctx) => {
    skipUnlessReady(ctx);
    const o = await seedOrder({ status: 'accepted', events: flow('pending', 'accepted') });
    const snapshot = async () => ({
      order: await q('SELECT status, updated_at FROM app.orders WHERE id = $1', [o.id]),
      history: await q(
        'SELECT count(*)::int AS n FROM app.order_status_history WHERE order_id = $1',
        [o.id],
      ),
      tokens: await q(
        'SELECT count(*)::int AS n FROM app.order_access_tokens WHERE order_id = $1',
        [o.id],
      ),
      audits: await q('SELECT count(*)::int AS n FROM app.audit_events WHERE entity_id = $1', [
        o.id,
      ]),
    });
    const before = await snapshot();
    await orders.getTracking(undefined, o.id, o.token);
    await orders.getTracking(undefined, o.id, o.token);
    expect(await snapshot()).toEqual(before);
  });

  it('opcional (database-engineer): la consulta del historial usa order_status_history_order_idx', async (ctx) => {
    skipUnlessReady(ctx);
    const o = await seedOrder({ events: flow('pending', 'accepted', 'preparing') });
    await withClient(url as string, async (c) => {
      await c.query('BEGIN');
      try {
        // Con pocas filas el planificador prefiere un seq scan: se desactiva SOLO para comprobar que el índice sirve.
        await c.query('SET LOCAL enable_seqscan = off');
        const plan = await c.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT new_status, changed_at FROM app.order_status_history
            WHERE order_id = $1 ORDER BY changed_at ASC, id ASC LIMIT 51`,
          [o.id],
        );
        expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain(
          'order_status_history_order_idx',
        );
      } finally {
        await c.query('ROLLBACK');
      }
    });
  });
});
