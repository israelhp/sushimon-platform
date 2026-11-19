import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
import {
  COMMAND_SPECS,
  evaluateTransition,
  ORDER_STATUSES,
  type OrderCommand,
} from '../src/orders/admin/order-transition.matrix.js';
import { OrderTransitionsService } from '../src/orders/admin/order-transitions.service.js';
import { ordersBusy } from '../src/orders/orders-errors.js';
import { NoDeliveryFulfillment } from '../src/orders/ports/order-fulfillment.port.js';
import { PaymentsReadAdapter } from '../src/orders/payments/payments-read.adapter.js';
import { PaymentsRepository } from '../src/orders/payments/payments.repository.js';
import {
  cleanupTestData,
  ensureAuthStub,
  TEST_URL,
  withClient,
  deletePaymentsOf,
} from './support/db.js';
import { globalStaff, ROLE_PERMISSIONS, scopedStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * F22 (gestión de pedidos del backoffice) contra PostgreSQL REAL. Se omite (con aviso) sin DATABASE_URL_TEST o si faltan las
 * tablas de 0018. NO se ejecuta contra el Supabase compartido sin autorización: usar una BD desechable o el proyecto de pruebas.
 *
 * ESTADO: ESCRITA PERO NO EJECUTADA todavía (la escribió el api-engineer sin acceso autorizado a la BD). Hasta que se ejecute
 * 100 % verde, F22 no pasa de `API_IMPLEMENTED` (spec 023 §12.7). Cubre las filas I del spec §11: 5, 6, 7, 11-23, 26-33, 35, 39
 * (parcial: la tabla pública) y 46. Los pedidos se SEMBRARON por SQL en sucursales que crea la propia prueba; la limpieza usa
 * las excepciones controladas `app.allow_order_cleanup` (0018) y `app.allow_audit_cleanup` (0004) SOLO sobre esos pedidos.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['app.branches','app.orders','app.order_items','app.order_addresses','app.order_status_history','app.staff_users','app.audit_events']) t
          WHERE to_regclass(t) IS NOT NULL`,
      );
      return (res.rows[0]?.n ?? 0) === 7;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[admin-orders.int-spec] OMITIDA: faltan tablas de la migración 0018 en DATABASE_URL_TEST. El SQL de F22 NO se probó contra PostgreSQL real.',
  );
}

const MANAGER = ROLE_PERMISSIONS['manager'] as string[];
const ALL = ROLE_PERMISSIONS['admin'] as string[];

describe.skipIf(!url || !ready)('Gestión de pedidos contra PostgreSQL real (F22)', () => {
  const run = randomUUID().slice(0, 8);
  const NAME = `NOMBRE-SECRETO-${run}`;
  const REASON = `RAZON-INTERNA-${run}`;
  let prisma: PrismaService;
  let commands: AdminOrdersCommandsService;
  let queries: AdminOrdersQueryService;
  let authorization: AuthorizationService;
  let branchA = '';
  let branchB = '';
  const branchIds = new Set<string>();
  let staffRowId = '';
  let admin: StaffContext;
  let managerA: StaffContext;
  let managerB: StaffContext;
  let kitchenA: StaffContext;
  const statements = { n: 0 };
  let counting = false;
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

  interface Seed {
    branch?: string;
    status?: string;
    fulfillment?: 'PICKUP' | 'DELIVERY';
    provider?: 'OWN' | 'PEDIDOSYA' | null;
    placedAt?: Date;
    units?: number;
    /** F24: solo `cash` (el trigger de 0019 rechaza `bank_transfer` en INSERT). */
    payment?: 'cash' | null;
    /** `false` = sin evento de historial coherente con el estado (historial inconsistente, fila 23). */
    consistentHistory?: boolean;
    name?: string;
  }

  /** Inserta pedido + líneas (+ dirección si DELIVERY) + historial de creación por SQL, en UNA transacción. */
  const seedOrder = async (o: Seed = {}) => {
    const fulfillment = o.fulfillment ?? 'PICKUP';
    const provider = fulfillment === 'DELIVERY' ? (o.provider ?? 'OWN') : null;
    const id = randomUUID();
    phoneSeq += 1;
    await withClient(url as string, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(
          `INSERT INTO app.orders (id, branch_id, customer_name, customer_phone, customer_email, fulfillment_type,
                                   delivery_provider, notes, status, subtotal, total, payment_method_preference, placed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'NOTA', $8, 100, 100, $9, COALESCE($10::timestamptz, now()))`,
          [
            id,
            o.branch ?? branchA,
            o.name ?? NAME,
            `+5025${String(6000000 + phoneSeq).padStart(7, '0')}`.slice(0, 12),
            `pii-${run}@example.com`,
            fulfillment,
            provider,
            o.status ?? 'pending',
            o.payment ?? null,
            o.placedAt ?? null,
          ],
        );
        if (fulfillment === 'DELIVERY') {
          await c.query(
            `INSERT INTO app.order_addresses (order_id, municipality_name, zone, address_line)
             VALUES ($1, 'Guatemala', 'Zona 10', 'DIRECCION')`,
            [id],
          );
        }
        await c.query(
          `INSERT INTO app.order_items (order_id, line_no, product_name, quantity, unit_price)
           VALUES ($1, 1, 'Roll', $2, 50)`,
          [id, o.units ?? 2],
        );
        await c.query(
          `INSERT INTO app.order_status_history (order_id, old_status, new_status, changed_at)
           VALUES ($1, NULL, 'pending', COALESCE($2::timestamptz, now()))`,
          [id, o.placedAt ?? null],
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
    return id;
  };

  const exec = (
    staff: StaffContext,
    command: OrderCommand,
    id: string,
    expected: string,
    reason?: string,
  ) => commands.execute(staff, command, id, { expectedStatus: expected, reason });
  const stateOf = async (id: string) =>
    (
      await q<{ status: string; updated_at: Date }>(
        'SELECT status, updated_at FROM app.orders WHERE id = $1',
        [id],
      )
    )[0];
  const historyOf = (id: string) =>
    q<{
      old_status: string | null;
      new_status: string;
      changed_by: string | null;
      reason: string | null;
      changed_at: Date;
    }>(
      'SELECT old_status, new_status, changed_by, reason, changed_at FROM app.order_status_history WHERE order_id = $1 ORDER BY changed_at, id',
      [id],
    );
  const auditOf = (id: string) =>
    q<{
      action: string;
      actor_id: string | null;
      reason: string | null;
      old_values: unknown;
      new_values: unknown;
      branch_id: string;
    }>(
      "SELECT action, actor_id, reason, old_values, new_values, branch_id FROM app.audit_events WHERE entity_type = 'order' AND entity_id = $1 ORDER BY created_at, id",
      [id],
    );

  const build = (auditService: AuditService) => {
    const r = new AdminOrdersRepository(prisma, auditService);
    const gate = new DbGate(10, 40, 10_000, ordersBusy);
    const clock: Clock = { now: () => new Date() };
    return {
      repo: r,
      commands: new AdminOrdersCommandsService(
        r,
        new OrderTransitionsService(),
        authorization,
        gate,
        new NoDeliveryFulfillment(),
        new PaymentsReadAdapter(new PaymentsRepository(prisma, auditService)),
      ),
      queries: new AdminOrdersQueryService(r, authorization, clock, gate),
    };
  };

  beforeAll(async () => {
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
    const a = await prisma.branch.create({
      data: { code: `oa-${run}`, name: `Suc A ${run}`, address: 'Zona 1' },
    });
    const b = await prisma.branch.create({
      data: { code: `ob-${run}`, name: `Suc B ${run}`, address: 'Zona 2' },
    });
    branchA = a.id;
    branchB = b.id;
    branchIds.add(a.id);
    branchIds.add(b.id);
    const staffRow = await prisma.staffUser.create({
      data: { fullName: `Empleado ${run}`, email: `f22-${run}@sushimon.test` },
    });
    staffRowId = staffRow.id;
    admin = globalStaff(ALL, { staffId: staffRowId, fullName: `Empleado ${run}` });
    managerA = scopedStaff(MANAGER, [branchA], { staffId: randomUUID() });
    managerB = scopedStaff(MANAGER, [branchB], { staffId: randomUUID() });
    kitchenA = scopedStaff(ROLE_PERMISSIONS['kitchen'] as string[], [branchA], {
      staffId: randomUUID(),
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    if (ready && url) {
      // Solo los pedidos de las sucursales que creó ESTA prueba.
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
          for (const t of ['order_status_history', 'order_addresses', 'order_items']) {
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
      // borra también al empleado `@sushimon.test` creado aquí
      await cleanupTestData(url, { authUserIds: [], branchIds, productIds: [], categoryIds: [] });
    }
  });

  it('filas 5, 6, 7: alcance en SQL — A no lista/cuenta/ve pedidos de B; ajeno = inexistente; branchId ajeno 404', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await seedOrder({ branch: branchA });
    const b = await seedOrder({ branch: branchB });
    const listA = (await queries.list(managerA, {})).items.map((i) => i.id);
    expect(listA).toContain(a);
    expect(listA).not.toContain(b);
    const board = await queries.board(managerA, {});
    expect(board.columns.flatMap((c) => c.items).every((i) => i.branchId === branchA)).toBe(true);
    const global = (await queries.list(admin, { branchId: branchB })).items.map((i) => i.id);
    expect(global).toContain(b);
    const foreign = await err(queries.detail(managerA, b));
    const missing = await err(queries.detail(managerA, randomUUID()));
    expect([statusOf(foreign), codeOf(foreign)]).toEqual([404, 'ORDER_NOT_FOUND']);
    expect((foreign as { getResponse: () => unknown }).getResponse()).toEqual(
      (missing as { getResponse: () => unknown }).getResponse(),
    );
    expect(codeOf(await err(queries.list(managerA, { branchId: branchB })))).toBe(
      'BRANCH_NOT_FOUND',
    );
    expect(
      codeOf(await err(commands.execute(managerA, 'accept', b, { expectedStatus: 'pending' }))),
    ).toBe('ORDER_NOT_FOUND');
    // fila 7: ve el pedido (orders.read en A) pero sin orders.cancel en A => 403 de recurso
    expect(codeOf(await err(exec(kitchenA, 'cancel', a, 'pending', 'motivo ok')))).toBe(
      'ORDER_ACTION_FORBIDDEN',
    );
  });

  it('filas 15, 17, 18: éxito atómico — historial y auditoría coherentes, changed_at = updated_at exacto, solo status/updated_at cambian', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    const before = (
      await q<Record<string, unknown>>('SELECT * FROM app.orders WHERE id = $1', [id])
    )[0] as Record<string, unknown>;
    const res = await exec(admin, 'cancel', id, 'pending', `  ${REASON}  `);
    expect(res.order.status).toBe('cancelled');
    expect(res.pendingActions).toEqual([]);
    const after = (
      await q<Record<string, unknown>>('SELECT * FROM app.orders WHERE id = $1', [id])
    )[0] as Record<string, unknown>;
    const changed = Object.keys(after).filter(
      (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]),
    );
    expect(changed.sort()).toEqual(['status', 'updated_at']);
    const h = await historyOf(id);
    expect(h).toHaveLength(2);
    expect(h[1]).toMatchObject({
      old_status: 'pending',
      new_status: 'cancelled',
      changed_by: staffRowId,
      reason: REASON,
    });
    const exact = await q<{ same: boolean }>(
      `SELECT (o.updated_at = h.changed_at) AS same FROM app.orders o
         JOIN app.order_status_history h ON h.order_id = o.id AND h.new_status = 'cancelled' WHERE o.id = $1`,
      [id],
    );
    expect(exact[0]?.same).toBe(true);
    const audit = await auditOf(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'order.cancelled',
      actor_id: staffRowId,
      reason: REASON,
      branch_id: branchA,
    });
    const raw = JSON.stringify([audit[0]?.old_values, audit[0]?.new_values]);
    for (const leak of [NAME, REASON, 'NOTA', 'DIRECCION', 'pii-']) expect(raw).not.toContain(leak);
    // detalle: actorName del empleado y sin correo
    const d = await queries.detail(admin, id);
    expect(d.history.map((e) => [e.status, e.actorName])).toEqual([
      ['pending', null],
      ['cancelled', `Empleado ${run}`],
    ]);
    expect(JSON.stringify(d)).not.toContain('pii-');
  });

  it('fila 16: si la auditoría falla se revierte TODO (estado, historial y auditoría)', async (ctx) => {
    skipUnlessReady(ctx);
    const failing = {
      record: () => Promise.reject(new Error('fallo de auditoría simulado')),
    } as unknown as AuditService;
    const broken = build(failing);
    const id = await seedOrder();
    await expect(
      broken.commands.execute(admin, 'accept', id, { expectedStatus: 'pending' }),
    ).rejects.toThrow();
    expect((await stateOf(id))?.status).toBe('pending');
    expect(await historyOf(id)).toHaveLength(1);
    expect(await auditOf(id)).toHaveLength(0);
  });

  it('filas 11-14: terminales, complete en DELIVERY, PEDIDOSYA, cancel desde on_the_way', async (ctx) => {
    skipUnlessReady(ctx);
    for (const t of ['delivered', 'picked_up', 'rejected', 'cancelled']) {
      const id = await seedOrder({ status: t });
      const e = await err(exec(admin, 'cancel', id, t, 'motivo ok'));
      expect(codeOf(e)).toBe('ORDER_TRANSITION_INVALID');
      expect((await stateOf(id))?.status).toBe(t);
      expect(await auditOf(id)).toHaveLength(0);
    }
    for (const provider of ['OWN', 'PEDIDOSYA'] as const) {
      const id = await seedOrder({ status: 'ready', fulfillment: 'DELIVERY', provider });
      const e = await err(exec(admin, 'complete', id, 'ready'));
      expect(statusOf(e)).toBe(422);
      expect((await stateOf(id))?.status).toBe('ready');
    }
    const pickup = await seedOrder({ status: 'ready' });
    expect((await exec(admin, 'complete', pickup, 'ready')).order.status).toBe('picked_up');
    const pya = await seedOrder({ fulfillment: 'DELIVERY', provider: 'PEDIDOSYA' });
    for (const [c, from] of [
      ['accept', 'pending'],
      ['start_preparing', 'accepted'],
      ['mark_ready', 'preparing'],
    ] as const) {
      await exec(admin, c, pya, from);
    }
    expect((await stateOf(pya))?.status).toBe('ready');
    const way = await seedOrder({ status: 'on_the_way', fulfillment: 'DELIVERY' });
    expect(codeOf(await err(exec(admin, 'cancel', way, 'on_the_way', 'tarde')))).toBe(
      'ORDER_TRANSITION_INVALID',
    );
    for (const from of ['pending', 'accepted', 'preparing', 'ready']) {
      const id = await seedOrder({ status: from });
      expect((await exec(admin, 'cancel', id, from, 'motivo ok')).order.status).toBe('cancelled');
    }
  });

  it('filas 19-23: 409 con current, repetición idempotente (mismo actor y otro), motivo original, historial inconsistente', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    await exec(admin, 'accept', id, 'pending');
    const stale = await err(exec(admin, 'cancel', id, 'pending', 'motivo ok'));
    expect(statusOf(stale)).toBe(409);
    expect(
      (stale as { getResponse: () => { extra: { current: { status: string } } } }).getResponse()
        .extra.current.status,
    ).toBe('accepted');
    const again = await exec(admin, 'accept', id, 'pending');
    expect(again.transition).toMatchObject({ replayed: true, appliedByMe: true });
    const other = await exec(managerA, 'accept', id, 'pending');
    expect(other.transition).toMatchObject({ replayed: true, appliedByMe: false });
    expect(await historyOf(id)).toHaveLength(2);
    expect(await auditOf(id)).toHaveLength(1);
    // fila 21: sin alcance no hay repetición
    expect(
      codeOf(await err(commands.execute(managerB, 'accept', id, { expectedStatus: 'pending' }))),
    ).toBe('ORDER_NOT_FOUND');
    // fila 22: cancelar dos veces conserva el motivo original
    const c = await seedOrder();
    await exec(admin, 'cancel', c, 'pending', 'Primero');
    const second = await exec(admin, 'cancel', c, 'pending', 'Segundo');
    expect(second.transition.replayed).toBe(true);
    expect((await historyOf(c))[1]?.reason).toBe('Primero');
    // fila 23: estado `accepted` sin el evento correspondiente => 409, no falsa repetición
    const inconsistent = await seedOrder({ status: 'accepted' });
    expect(statusOf(await err(exec(admin, 'accept', inconsistent, 'pending')))).toBe(409);
  });

  it('filas 31-33: CONCURRENCIA real sobre PostgreSQL', async (ctx) => {
    skipUnlessReady(ctx);
    // 31: dos accept simultáneos del mismo actor => una escribe y la otra replayed
    const one = await seedOrder();
    const [a, b] = await Promise.all([
      exec(admin, 'accept', one, 'pending'),
      exec(admin, 'accept', one, 'pending'),
    ]);
    expect([a.transition.replayed, b.transition.replayed].sort()).toEqual([false, true]);
    expect(await historyOf(one)).toHaveLength(2);
    expect(await auditOf(one)).toHaveLength(1);
    // 32: accept y reject simultáneos (dos actores) => una 200 y la otra 409
    for (let i = 0; i < 5; i += 1) {
      const id = await seedOrder();
      const results = await Promise.all([
        err(exec(managerA, 'accept', id, 'pending')),
        err(exec(kitchenA, 'reject', id, 'pending', 'Sin stock')),
      ]);
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(statusOf(results.find((r) => r !== null))).toBe(409);
      const h = await historyOf(id);
      expect(h).toHaveLength(2);
      expect((await stateOf(id))?.status).toBe(h[1]?.new_status);
    }
    // 33: 20 solicitudes mezcladas => nunca fuera del grafo ni más de una fila por transición
    const mixed = await seedOrder({ status: 'pending' });
    const plan: [StaffContext, OrderCommand, string, string?][] = [];
    for (let i = 0; i < 20; i += 1) {
      const pick = i % 5;
      if (pick === 0) plan.push([admin, 'accept', 'pending']);
      else if (pick === 1) plan.push([managerA, 'reject', 'pending', 'Sin stock']);
      else if (pick === 2) plan.push([admin, 'cancel', 'pending', 'Cliente lo pidió']);
      else if (pick === 3) plan.push([kitchenA, 'start_preparing', 'accepted']);
      else plan.push([admin, 'accept', 'pending']);
    }
    await Promise.all(plan.map(([s, c, from, r]) => err(exec(s, c, mixed, from, r))));
    const h = await historyOf(mixed);
    const transitions = h.slice(1).map((e) => `${e.old_status}>${e.new_status}`);
    expect(new Set(transitions).size).toBe(transitions.length);
    for (const e of h.slice(1)) {
      expect(
        evaluateTransition(e.old_status as string, e.new_status, {
          fulfillmentType: 'PICKUP',
          deliveryProvider: null,
        }).ok,
      ).toBe(true);
    }
    // orden de historial coherente con el orden real: changed_at estrictamente creciente
    for (let i = 1; i < h.length; i += 1) {
      expect((h[i]?.changed_at as Date).getTime()).toBeGreaterThanOrEqual(
        (h[i - 1]?.changed_at as Date).getTime(),
      );
    }
    expect((await stateOf(mixed))?.status).toBe(h[h.length - 1]?.new_status);
  });

  it('fila 35: barrido exhaustivo — ningún comando produce un par fuera de la matriz (todos los estados y modalidades)', async (ctx) => {
    skipUnlessReady(ctx);
    const modes = [
      { fulfillment: 'PICKUP' as const, provider: null },
      { fulfillment: 'DELIVERY' as const, provider: 'OWN' as const },
      { fulfillment: 'DELIVERY' as const, provider: 'PEDIDOSYA' as const },
    ];
    for (const mode of modes) {
      for (const status of ORDER_STATUSES) {
        // Los comandos de un (modalidad, estado) corren en lotes de 3 sobre pedidos distintos: la BD de pruebas es remota
        // y el pooler de sesión de Supabase limita a 15 conexiones (cada siembra abre una; el pool de Prisma ocupa hasta 8).
        const commands = Object.keys(COMMAND_SPECS) as OrderCommand[];
        for (let from = 0; from < commands.length; from += 3) {
          await Promise.all(
            commands.slice(from, from + 3).map(async (command) => {
              const id = await seedOrder({
                status,
                fulfillment: mode.fulfillment,
                provider: mode.provider,
              });
              const verdict = evaluateTransition(status, COMMAND_SPECS[command].to, {
                fulfillmentType: mode.fulfillment,
                deliveryProvider: mode.provider,
              });
              const result = await err(
                exec(
                  admin,
                  command,
                  id,
                  status,
                  COMMAND_SPECS[command].reasonRequired ? 'motivo ok' : undefined,
                ),
              );
              const now = (await stateOf(id))?.status;
              if (verdict.ok) {
                expect(result, `${mode.provider} ${status} ${command}`).toBeNull();
                expect(now).toBe(COMMAND_SPECS[command].to);
              } else {
                expect(statusOf(result), `${mode.provider} ${status} ${command}`).toBe(422);
                expect(now).toBe(status);
                expect(await historyOf(id)).toHaveLength(1);
              }
            }),
          );
        }
      }
    }
    const impossible = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.order_status_history h
        WHERE h.order_id IN (SELECT id FROM app.orders WHERE branch_id = ANY($1::uuid[])) AND h.new_status IN ('on_the_way', 'delivered')`,
      [[...branchIds]],
    );
    expect(impossible[0]?.n).toBe(0);
  }, 240_000);

  it('fila 26 y 27: filtros y keyset (sin duplicados ni saltos con placed_at idénticos y pedidos nuevos entre páginas)', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = (
      await prisma.branch.create({
        data: { code: `oc-${run}`, name: `Suc C ${run}`, address: 'Z3' },
      })
    ).id;
    branchIds.add(branch);
    const staff = scopedStaff(MANAGER, [branch], { staffId: randomUUID() });
    const same = new Date(Date.now() - 3_600_000);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1)
      ids.push(
        await seedOrder({
          branch,
          placedAt: same,
          name: i === 0 ? `Búsqueda_100%-${run}` : undefined,
        }),
      );
    const p1 = await queries.list(staff, { limit: 2 });
    await seedOrder({ branch }); // llega entre páginas
    const p2 = await queries.list(staff, { limit: 2, cursor: p1.nextCursor as string });
    const p3 = await queries.list(staff, { limit: 2, cursor: p2.nextCursor as string });
    const seen = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(ids.every((id) => seen.includes(id))).toBe(true);
    expect(p3.nextCursor).toBeNull();
    expect(codeOf(await err(queries.list(staff, { cursor: 'AAAA' })))).toBe('ORDER_CURSOR_INVALID');
    // un cursor de otra sucursal no filtra datos fuera del alcance
    const foreignPage = await queries.list(managerA, { limit: 1 });
    const crossed = await queries.list(managerB, {
      limit: 50,
      cursor: foreignPage.nextCursor ?? (p1.nextCursor as string),
    });
    expect(crossed.items.every((i) => i.branchId === branchB)).toBe(true);
    // filtros: comodines literales y por número
    expect((await queries.list(staff, { q: '100%' })).items.map((i) => i.id)).toEqual([ids[0]]);
    const n = (
      await q<{ order_number: string }>('SELECT order_number FROM app.orders WHERE id = $1', [
        ids[1],
      ])
    )[0]?.order_number as string;
    expect(
      (await queries.list(staff, { q: `MON-${String(n).padStart(6, '0')}` })).items.map(
        (i) => i.id,
      ),
    ).toEqual([ids[1]]);
    expect((await queries.list(staff, { status: ['accepted'] })).items).toEqual([]);
  });

  it('filas 28, 29, 30, 46: tablero, presupuesto de sentencias, detalle y EXPLAIN', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = (
      await prisma.branch.create({
        data: { code: `od-${run}`, name: `Suc D ${run}`, address: 'Z4' },
      })
    ).id;
    branchIds.add(branch);
    const staff = scopedStaff(MANAGER, [branch], { staffId: randomUUID() });
    const old = await seedOrder({ branch, placedAt: new Date(Date.now() - 40 * 86_400_000) }); // activo antiguo: visible
    for (let i = 0; i < 50; i += 1)
      await seedOrder({ branch, placedAt: new Date(Date.now() - i * 60_000), units: 3 });
    await seedOrder({
      branch,
      status: 'cancelled',
      placedAt: new Date(Date.now() - 30 * 3_600_000),
    }); // fuera de la ventana
    const cancelled = await seedOrder({ branch, status: 'cancelled' });
    const board = await measure(() => queries.board(staff, { limit: 5 }));
    expect(board.n).toBeLessThanOrEqual(3);
    const pending = board.result.columns[0];
    expect(pending?.count).toBe(51);
    expect(pending?.items).toHaveLength(5);
    expect(pending?.hasMore).toBe(true);
    expect(pending?.items[0]?.id).toBe(old);
    expect(pending?.items[0]?.itemCount).toBe(2);
    expect(board.result.columns[8]?.items.map((i) => i.id)).toEqual([cancelled]);
    expect(board.result.summary.pending).toBe(51);
    const list = await measure(() =>
      queries.list(staff, {
        limit: 50,
        from: new Date(Date.now() - 60 * 86_400_000).toISOString(),
      }),
    );
    expect(list.n).toBeLessThanOrEqual(2);
    expect(list.result.items).toHaveLength(50);
    const detail = await measure(() => queries.detail(staff, old));
    expect(detail.n).toBeLessThanOrEqual(7);
    expect(detail.result).toMatchObject({
      // F24: pedido sembrado por SQL directo (sin fila de pago) = histórico: se lee CASH/PENDING y no es cobrable.
      payment: { method: 'CASH', status: 'PENDING', registration: { allowed: false } },
      contact: { fullName: NAME },
      historyTruncated: false,
    });
    expect(detail.result.contact.phone).toMatch(/^\+5025/);
    expect(JSON.stringify(detail.result)).not.toContain('pii-');
    const cmd = await measure(() => exec(admin, 'accept', old, 'pending'));
    expect(cmd.n).toBeLessThanOrEqual(6);
    // 46: el plan usa el índice (con seqscan desactivado: la tabla de prueba es diminuta)
    const plan = await withClient(url as string, async (c) => {
      await c.query('BEGIN');
      await c.query('SET LOCAL enable_seqscan = off');
      const r = await c.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM app.orders WHERE status = 'pending' AND branch_id = ANY($1::uuid[]) ORDER BY placed_at ASC, id ASC LIMIT 30`,
        [[branch]],
      );
      await c.query('ROLLBACK');
      return r.rows.map((x) => x['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('orders_branch_status_placed_idx');
  }, 240_000);

  it('fila 39 (parcial): F21 sigue sin exponer changed_by/reason; la tabla pública refleja el historial real', async (ctx) => {
    skipUnlessReady(ctx);
    const id = await seedOrder();
    await exec(admin, 'cancel', id, 'pending', REASON);
    const rows = await q<{ new_status: string; reason: string | null; changed_by: string | null }>(
      'SELECT new_status, reason, changed_by FROM app.order_status_history WHERE order_id = $1 ORDER BY changed_at',
      [id],
    );
    // F21 SOLO selecciona (`new_status`, `changed_at`): la fila contiene reason/changed_by que ese SELECT jamás trae.
    expect(rows.map((r) => r.new_status)).toEqual(['pending', 'cancelled']);
    expect(rows[1]?.reason).toBe(REASON);
  });
});
