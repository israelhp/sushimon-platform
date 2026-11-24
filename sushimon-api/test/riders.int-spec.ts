import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import type { StaffContext } from '../src/identity/identity.types.js';
import { RiderEligibilityService } from '../src/riders/rider-eligibility.service.js';
import { RidersCommandsService } from '../src/riders/riders-commands.service.js';
import { ridersBusy } from '../src/riders/riders-errors.js';
import { RidersQueriesService } from '../src/riders/riders-queries.service.js';
import { RidersRepository } from '../src/riders/riders.repository.js';
import {
  cleanupTestData,
  deleteRidersOf,
  ensureAuthStub,
  TEST_URL,
  withClient,
} from './support/db.js';
import { FakeBusyPort } from './support/fake-riders-repo.js';
import { globalStaff, scopedStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * F27 (motoristas propios) contra PostgreSQL REAL. Se OMITE (con aviso) sin `DATABASE_URL_TEST` o si `app.riders` no existe
 * (`to_regclass('app.riders')`): la migración 0021 NO está aplicada a la base compartida y quien la aplique decide cuándo correr
 * esto. NO se ejecuta contra el Supabase compartido sin autorización: usar una BD desechable o el proyecto de pruebas CON 0021.
 *
 * ESTADO: ESCRITA PERO NO EJECUTADA (el api-engineer no aplicó 0021 ni tiene acceso autorizado a la BD). Hasta que corra 100 %
 * verde, F27 no pasa de `API_IMPLEMENTED`. Cubre las filas I de spec 028 §13: R03, R04, R05, R10, R11, R13, R16, R17, R20, R26,
 * R27, R29 y R32 (R33 está en `migration-0021.int-spec.ts`). Todo lo que se siembra es de la propia prueba (sucursales `zz-`);
 * la limpieza usa `app.allow_order_cleanup` (trigger `riders_guard`) y `app.allow_audit_cleanup` SOLO sobre esos datos.
 *
 * LÍMITES DEL POOLER: `DB_POOL_MAX` es 8; la concurrencia real usa como máximo 8 solicitudes.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['app.riders','app.branches','app.staff_users','app.audit_events','app.branch_delivery_settings']) t
          WHERE to_regclass(t) IS NOT NULL`,
      );
      return (res.rows[0]?.n ?? 0) === 5;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[riders.int-spec] OMITIDA: app.riders no existe en DATABASE_URL_TEST (migración 0021 sin aplicar). El SQL de F27 NO se probó contra PostgreSQL real.',
  );
}

const PERMS = ['riders.read', 'riders.create', 'riders.update'];

describe.skipIf(!url || !ready)('Motoristas propios contra PostgreSQL real (F27)', () => {
  const run = randomUUID().slice(0, 8);
  let prisma: PrismaService;
  let commands: RidersCommandsService;
  let queries: RidersQueriesService;
  let eligibility: RiderEligibilityService;
  let authorization: AuthorizationService;
  const port = new FakeBusyPort();
  let branchA = '';
  let branchB = '';
  let branchDead = '';
  const branchIds = new Set<string>();
  let staffRowId = '';
  let admin: StaffContext;
  const statements = { n: 0 };
  let counting = false;
  let originalQuery: typeof pg.Client.prototype.query;
  let phoneSeq = 0;

  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('falta app.riders (0021)');
  };
  const err = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const codeOf = (e: unknown) =>
    (e as { getResponse?: () => { code?: string } } | null)?.getResponse?.().code;
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
  /** Teléfono único por ejecución (UNIQUE global): `+502` + 8 dígitos derivados de la corrida. */
  const phone = (): string => {
    phoneSeq += 1;
    const base = parseInt(run, 16) % 90_000;
    return `+502${String(10_000_000 + base * 100 + phoneSeq).slice(-8)}`;
  };
  const make = (over: Record<string, unknown> = {}, staff: StaffContext = admin) =>
    commands.create(staff, {
      branchId: branchA,
      fullName: `zz-Rider ${run}`,
      phone: phone(),
      ...over,
    });
  const rowOf = async (id: string) =>
    (
      await q<{
        branch_id: string;
        active: boolean;
        availability: string;
        version: number;
        phone: string;
      }>('SELECT branch_id, active, availability, version, phone FROM app.riders WHERE id = $1', [
        id,
      ])
    )[0];
  const auditOf = (id: string) =>
    q<{
      action: string;
      actor_id: string | null;
      branch_id: string | null;
      reason: string | null;
      old_values: unknown;
      new_values: unknown;
    }>(
      "SELECT action, actor_id, branch_id, reason, old_values, new_values FROM app.audit_events WHERE entity_type = 'rider' AND entity_id = $1 ORDER BY created_at, id",
      [id],
    );

  const build = (auditService: AuditService) => {
    const r = new RidersRepository(prisma, auditService);
    const gate = new DbGate(10, 40, 10_000, ridersBusy);
    return {
      repo: r,
      commands: new RidersCommandsService(r, authorization, port, gate),
      queries: new RidersQueriesService(r, authorization, port, gate),
      eligibility: new RiderEligibilityService(r, port),
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
    eligibility = built.eligibility;
    for (const code of ['a', 'b', 'x']) {
      const b = await prisma.branch.create({
        data: {
          code: `ri${code}-${run}`,
          name: `Suc ${code} ${run}`,
          address: 'Zona 1',
          active: code !== 'x',
        },
      });
      branchIds.add(b.id);
      if (code === 'a') branchA = b.id;
      else if (code === 'b') branchB = b.id;
      else branchDead = b.id;
    }
    const staffRow = await prisma.staffUser.create({
      data: { fullName: `Admin ${run}`, email: `f27-${run}@sushimon.test` },
    });
    staffRowId = staffRow.id;
    admin = globalStaff(PERMS, { staffId: staffRowId, fullName: `Admin ${run}` });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    if (ready && url) {
      await withClient(url, (c) => deleteRidersOf(c, [...branchIds]));
    }
    await prisma.$disconnect();
    if (ready && url) {
      await cleanupTestData(url, { authUserIds: [], branchIds });
    }
  });

  it('R03 R29 alta: activa, UNAVAILABLE, v1; auditoría con actor y sucursal, SIN PII; 2 sentencias (R32)', async (ctx) => {
    skipUnlessReady(ctx);
    const tel = phone();
    const m = await measure(() =>
      make({ phone: tel, fullName: `  zz-Álvaro   Gómez ${run} `, licensePlate: 'p-123 abc' }),
    );
    const r = m.result;
    expect(m.n).toBeLessThanOrEqual(3);
    expect(r).toMatchObject({
      active: true,
      availability: 'UNAVAILABLE',
      version: 1,
      licensePlate: 'P123ABC',
    });
    const row = await rowOf(r.id);
    expect(row).toMatchObject({
      active: true,
      availability: 'UNAVAILABLE',
      version: 1,
      phone: tel,
    });
    const audits = await auditOf(r.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'rider.created',
      actor_id: staffRowId,
      branch_id: branchA,
      new_values: {
        branchId: branchA,
        vehicleType: null,
        active: true,
        availability: 'UNAVAILABLE',
      },
    });
    const dump = JSON.stringify(audits);
    for (const pii of [tel, 'P123ABC', 'lvaro', 'mez']) expect(dump).not.toContain(pii);
  });

  it('R29 atomicidad: si falla la auditoría no queda el motorista', async (ctx) => {
    skipUnlessReady(ctx);
    const failing = build({
      record: () => Promise.reject(new Error('audit down')),
    });
    const tel = phone();
    expect(
      await err(
        failing.commands.create(admin, { branchId: branchA, fullName: 'zz-Fallo', phone: tel }),
      ),
    ).not.toBeNull();
    expect(await q('SELECT 1 FROM app.riders WHERE phone = $1', [tel])).toHaveLength(0);
  });

  it('R04 teléfono repetido (activo, inactivo, otra sucursal) => 409 RIDER_PHONE_TAKEN', async (ctx) => {
    skipUnlessReady(ctx);
    const first = await make();
    const dup = await err(make({ phone: first.phone, branchId: branchB }));
    expect(codeOf(dup)).toBe('RIDER_PHONE_TAKEN');
    await commands.setStatus(admin, first.id, { active: false });
    expect(codeOf(await err(make({ phone: first.phone })))).toBe('RIDER_PHONE_TAKEN');
  });

  it('R05 doble alta simultánea del mismo teléfono => una 201 y una 409', async (ctx) => {
    skipUnlessReady(ctx);
    const tel = phone();
    const results = await Promise.all(
      [make({ phone: tel }), make({ phone: tel })].map((p) => err(p)),
    );
    expect(results.filter((e) => e === null)).toHaveLength(1);
    expect(results.filter((e) => codeOf(e) === 'RIDER_PHONE_TAKEN')).toHaveLength(1);
    expect(await q('SELECT 1 FROM app.riders WHERE phone = $1', [tel])).toHaveLength(1);
  });

  it('alta: sucursal inactiva => 422 BRANCH_NOT_AVAILABLE; fuera del alcance => 403', async (ctx) => {
    skipUnlessReady(ctx);
    expect(codeOf(await err(make({ branchId: branchDead })))).toBe('BRANCH_NOT_AVAILABLE');
    const onlyB = scopedStaff(PERMS, [branchB], { staffId: staffRowId });
    expect(codeOf(await err(make({}, onlyB)))).toBe('RIDER_ACTION_FORBIDDEN');
  });

  it('R10 R11 listado: filtros (q con acentos), alcance, paginación, enmascarado y presupuesto (R32)', async (ctx) => {
    skipUnlessReady(ctx);
    const tag = `zz-L${run}`;
    const x = await make({ fullName: `${tag} Álvaro`, branchId: branchA });
    const y = await make({ fullName: `${tag} Beatriz`, branchId: branchB });
    const z = await make({ fullName: `${tag} Carlos`, branchId: branchA });
    await commands.setAvailability(admin, x.id, { availability: 'AVAILABLE' });
    await commands.setStatus(admin, z.id, { active: false });
    const names = async (qy: Parameters<typeof queries.list>[1], who: StaffContext = admin) =>
      (await queries.list(who, { q: tag.toLowerCase(), ...qy })).items.map((i) => i.id);

    const m = await measure(() => queries.list(admin, { q: tag, pageSize: 2 }));
    expect(m.n).toBeLessThanOrEqual(3);
    expect(m.result).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(m.result.items.map((i) => i.id)).toEqual([x.id, y.id]);
    expect(JSON.stringify(m.result)).not.toContain(x.phone);
    expect(m.result.items[0]?.phoneMasked).toBe(`${x.phone.slice(0, 4)}****${x.phone.slice(-4)}`);
    expect(await names({ q: `${tag} ALVARO` })).toEqual([x.id]);
    expect(await names({ branchId: branchB })).toEqual([y.id]);
    expect(await names({ active: false })).toEqual([z.id]);
    expect(await names({ availability: 'AVAILABLE' })).toEqual([x.id]);
    expect(await names({ availability: 'UNAVAILABLE' })).toEqual([y.id, z.id]);
    expect(await names({ availability: 'BUSY' })).toEqual([]);
    expect(await names({ order: 'desc' })).toEqual([z.id, y.id, x.id]);
    expect(
      (await queries.list(admin, { q: tag, pageSize: 2, page: 2 })).items.map((i) => i.id),
    ).toEqual([z.id]);
    expect(await queries.list(admin, { q: tag, pageSize: 2, page: 9 })).toMatchObject({
      items: [],
      total: 3,
    });
    const onlyA = scopedStaff(['riders.read'], [branchA]);
    expect(await names({}, onlyA)).toEqual([x.id, z.id]);
    expect(await queries.list(onlyA, { branchId: branchB })).toMatchObject({ items: [], total: 0 });
    // con el puerto doble (F28 simulada): AVAILABLE excluye a los ocupados y BUSY los incluye
    port.known = true;
    port.busyIds = new Set([x.id]);
    try {
      expect(await names({ availability: 'BUSY' })).toEqual([x.id]);
      expect(await names({ availability: 'AVAILABLE' })).toEqual([]);
    } finally {
      port.known = false;
      port.busyIds = new Set();
    }
  });

  it('detalle: completo con teléfono y placa; ajeno e inexistente => el mismo 404; 1 sentencia (R32)', async (ctx) => {
    skipUnlessReady(ctx);
    const r = await make({ licensePlate: 'ABC123' });
    const m = await measure(() => queries.get(admin, r.id));
    expect(m.n).toBeLessThanOrEqual(2);
    expect(m.result).toMatchObject({ phone: r.phone, licensePlate: 'ABC123' });
    const onlyB = scopedStaff(['riders.read'], [branchB]);
    const foreign = await err(queries.get(onlyB, r.id));
    const missing = await err(queries.get(admin, randomUUID()));
    expect(codeOf(foreign)).toBe('RIDER_NOT_FOUND');
    expect(codeOf(missing)).toBe('RIDER_NOT_FOUND');
  });

  it('R13 edición: CAS por versión, 409 con current, sin cambios no sube versión ni audita; ≤5 sentencias (R32)', async (ctx) => {
    skipUnlessReady(ctx);
    const r = await make();
    const m = await measure(() =>
      commands.update(admin, r.id, {
        expectedVersion: 1,
        fullName: `zz-Nuevo ${run}`,
        vehicleType: 'CAR',
      }),
    );
    expect(m.n).toBeLessThanOrEqual(5);
    expect(m.result).toMatchObject({ version: 2, vehicleType: 'CAR' });
    const stale = await err(
      commands.update(admin, r.id, { expectedVersion: 1, vehicleType: 'BICYCLE' }),
    );
    expect(codeOf(stale)).toBe('RIDER_VERSION_CONFLICT');
    expect(
      (stale as { getResponse: () => { extra: { current: number } } }).getResponse().extra.current,
    ).toBe(2);
    const before = (await auditOf(r.id)).length;
    const same = await commands.update(admin, r.id, { expectedVersion: 2, vehicleType: 'CAR' });
    expect(same.version).toBe(2);
    expect(await auditOf(r.id)).toHaveLength(before);
    const audits = await auditOf(r.id);
    expect(audits.at(-1)).toMatchObject({
      action: 'rider.updated',
      new_values: { changedFields: ['fullName', 'vehicleType'] },
    });
    expect(JSON.stringify(audits)).not.toContain('Nuevo');
  });

  it('R16 dos PATCH con la misma versión => uno gana y el otro recibe 409', async (ctx) => {
    skipUnlessReady(ctx);
    const r = await make();
    const results = await Promise.all([
      err(commands.update(admin, r.id, { expectedVersion: 1, fullName: `zz-Uno ${run}` })),
      err(commands.update(admin, r.id, { expectedVersion: 1, fullName: `zz-Dos ${run}` })),
    ]);
    expect(results.filter((e) => e === null)).toHaveLength(1);
    expect(results.filter((e) => codeOf(e) === 'RIDER_VERSION_CONFLICT')).toHaveLength(1);
    expect((await rowOf(r.id))?.version).toBe(2);
    expect(await auditOf(r.id)).toHaveLength(2); // created + un solo updated
  });

  it('R17 traslado: mismo id y teléfono, UNAVAILABLE, branch_changed; destino inactivo => 422; sin duplicar fila', async (ctx) => {
    skipUnlessReady(ctx);
    const r = await make();
    await commands.setAvailability(admin, r.id, { availability: 'AVAILABLE' });
    const dead = await err(
      commands.update(admin, r.id, { expectedVersion: 2, branchId: branchDead }),
    );
    expect(codeOf(dead)).toBe('BRANCH_NOT_AVAILABLE');
    const m = await measure(() =>
      commands.update(admin, r.id, { expectedVersion: 2, branchId: branchB }),
    );
    expect(m.n).toBeLessThanOrEqual(5);
    expect(m.result).toMatchObject({
      id: r.id,
      branchId: branchB,
      availability: 'UNAVAILABLE',
      version: 3,
    });
    expect(await rowOf(r.id)).toMatchObject({
      branch_id: branchB,
      phone: r.phone,
      availability: 'UNAVAILABLE',
    });
    expect(await q('SELECT 1 FROM app.riders WHERE phone = $1', [r.phone])).toHaveLength(1);
    const ev = (await auditOf(r.id)).at(-1);
    expect(ev).toMatchObject({
      action: 'rider.branch_changed',
      branch_id: branchB,
      old_values: { branchId: branchA },
      new_values: { branchId: branchB, availability: 'UNAVAILABLE' },
    });
    // exige riders.update en origen Y destino; el que no ve el origen recibe el 404 uniforme
    const onlyB = scopedStaff(PERMS, [branchB], { staffId: staffRowId });
    const back = await err(commands.update(onlyB, r.id, { expectedVersion: 3, branchId: branchA }));
    expect(codeOf(back)).toBe('RIDER_ACTION_FORBIDDEN');
    const foreign = await err(
      commands.update(scopedStaff(PERMS, [branchA]), r.id, {
        expectedVersion: 3,
        fullName: 'zz-x',
      }),
    );
    expect(codeOf(foreign)).toBe('RIDER_NOT_FOUND');
  });

  it('desactivar vs traslado concurrentes: se serializan; el estado final es consistente y la auditoría coincide', async (ctx) => {
    skipUnlessReady(ctx);
    const r = await make();
    await commands.setAvailability(admin, r.id, { availability: 'AVAILABLE' });
    const results = await Promise.all([
      err(commands.setStatus(admin, r.id, { active: false, reason: 'zz' })),
      err(commands.update(admin, r.id, { expectedVersion: 2, branchId: branchB })),
    ]);
    const ok = results.filter((e) => e === null).length;
    for (const e of results) {
      if (e !== null) expect(codeOf(e)).toBe('RIDER_VERSION_CONFLICT');
    }
    const row = await rowOf(r.id);
    expect(row?.version).toBe(2 + ok);
    expect(row?.active).toBe(results[0] === null ? false : true);
    // el invariante de BD: un inactivo jamás queda disponible
    expect(row && (row.active || row.availability === 'UNAVAILABLE')).toBe(true);
    const actions = (await auditOf(r.id)).map((a) => a.action);
    expect(actions.length).toBe(2 + ok); // created + availability_changed + (deactivated | branch_changed)
  });

  it('carrera traslado vs PATCH de teléfono con dos sesiones: resultado consistente, sin fila a medias', async (ctx) => {
    skipUnlessReady(ctx);
    const r = await make();
    const newPhone = phone();
    const results = await Promise.all([
      err(commands.update(admin, r.id, { expectedVersion: 1, branchId: branchB })),
      err(commands.update(admin, r.id, { expectedVersion: 1, phone: newPhone })),
    ]);
    // ambos parten de la versión 1: exactamente uno gana y el otro recibe 409 (o 404 si el alcance ya no lo ve)
    expect(results.filter((e) => e === null)).toHaveLength(1);
    for (const e of results) {
      if (e !== null) expect(['RIDER_VERSION_CONFLICT', 'RIDER_NOT_FOUND']).toContain(codeOf(e));
    }
    const row = await rowOf(r.id);
    expect(row?.version).toBe(2);
    const moved = results[0] === null;
    expect(row).toMatchObject(
      moved
        ? { branch_id: branchB, phone: r.phone, availability: 'UNAVAILABLE' }
        : { branch_id: branchA, phone: newPhone },
    );
    expect(await q('SELECT 1 FROM app.riders WHERE id = $1', [r.id])).toHaveLength(1);
    expect(await auditOf(r.id)).toHaveLength(2); // created + un solo evento del ganador
  });

  it('R20 estado: desactivar fuerza UNAVAILABLE, reactivar no lo deja disponible, repetir no audita; ≤4 sentencias (R32)', async (ctx) => {
    skipUnlessReady(ctx);
    const r = await make();
    await commands.setAvailability(admin, r.id, { availability: 'AVAILABLE' });
    const m = await measure(() =>
      commands.setStatus(admin, r.id, { active: false, reason: ' baja ' }),
    );
    expect(m.n).toBeLessThanOrEqual(4);
    expect(m.result).toMatchObject({ active: false, availability: 'UNAVAILABLE' });
    expect(await rowOf(r.id)).toMatchObject({
      active: false,
      availability: 'UNAVAILABLE',
      version: 3,
    });
    const n = (await auditOf(r.id)).length;
    const noop = await measure(() => commands.setStatus(admin, r.id, { active: false }));
    expect(noop.n).toBeLessThanOrEqual(2);
    expect(await auditOf(r.id)).toHaveLength(n);
    expect(await commands.setStatus(admin, r.id, { active: true })).toMatchObject({
      active: true,
      availability: 'UNAVAILABLE',
    });
    const audits = await auditOf(r.id);
    expect(audits.map((a) => a.action).slice(-2)).toEqual(['rider.deactivated', 'rider.activated']);
    expect(audits.find((a) => a.action === 'rider.deactivated')).toMatchObject({
      reason: null, // el texto libre no se persiste (PII)
      new_values: { hasReason: true, reasonLength: 4 },
      actor_id: staffRowId,
    });
  });

  it('disponibilidad: inactivo => 409 RIDER_INACTIVE; idempotente; con el puerto ocupado => 409', async (ctx) => {
    skipUnlessReady(ctx);
    const r = await make();
    expect(
      await commands.setAvailability(admin, r.id, { availability: 'AVAILABLE' }),
    ).toMatchObject({ version: 2 });
    expect(
      await commands.setAvailability(admin, r.id, { availability: 'AVAILABLE' }),
    ).toMatchObject({ version: 2 });
    port.known = true;
    port.busyIds = new Set([r.id]);
    try {
      expect(
        codeOf(await err(commands.setAvailability(admin, r.id, { availability: 'UNAVAILABLE' }))),
      ).toBe('RIDER_HAS_ACTIVE_DELIVERY');
      expect(codeOf(await err(commands.setStatus(admin, r.id, { active: false })))).toBe(
        'RIDER_HAS_ACTIVE_DELIVERY',
      );
      expect(
        codeOf(await err(commands.update(admin, r.id, { expectedVersion: 2, branchId: branchB }))),
      ).toBe('RIDER_HAS_ACTIVE_DELIVERY');
    } finally {
      port.known = false;
      port.busyIds = new Set();
    }
    expect(await rowOf(r.id)).toMatchObject({
      active: true,
      availability: 'AVAILABLE',
      branch_id: branchA,
      version: 2,
    });
    await commands.setStatus(admin, r.id, { active: false });
    expect(
      codeOf(await err(commands.setAvailability(admin, r.id, { availability: 'AVAILABLE' }))),
    ).toBe('RIDER_INACTIVE');
  });

  it('R26 R27 elegibilidad contra BD: razones, fila de ajustes ausente, reparto propio habilitado; ≤2 sentencias', async (ctx) => {
    skipUnlessReady(ctx);
    const r = await make();
    await commands.setAvailability(admin, r.id, { availability: 'AVAILABLE' });
    const settingsBefore = await q(
      'SELECT 1 FROM app.branch_delivery_settings WHERE branch_id = ANY($1::uuid[])',
      [[branchA, branchB]],
    );
    const off = await measure(() => eligibility.evaluate({ riderId: r.id, branchId: branchA }));
    expect(off.n).toBeLessThanOrEqual(2);
    expect(off.result.reasons).toEqual(['OWN_DELIVERY_DISABLED']); // fila ausente = false
    expect((await eligibility.evaluate({ riderId: r.id, branchId: branchB })).reasons).toEqual([
      'WRONG_BRANCH',
      'OWN_DELIVERY_DISABLED',
    ]);
    expect(
      (await eligibility.evaluate({ riderId: randomUUID(), branchId: branchA })).reasons,
    ).toEqual(['NOT_FOUND']);
    // F27 nunca escribe la bandera de F09: la habilita quien administra las zonas (aquí, SQL de la prueba)
    expect(
      await q('SELECT 1 FROM app.branch_delivery_settings WHERE branch_id = ANY($1::uuid[])', [
        [branchA, branchB],
      ]),
    ).toHaveLength(settingsBefore.length);
    await q(
      `INSERT INTO app.branch_delivery_settings (branch_id, own_delivery_zones_enabled) VALUES ($1, true)
       ON CONFLICT (branch_id) DO UPDATE SET own_delivery_zones_enabled = true`,
      [branchA],
    );
    expect((await eligibility.evaluate({ riderId: r.id, branchId: branchA })).eligible).toBe(true);
    await commands.setAvailability(admin, r.id, { availability: 'UNAVAILABLE' });
    expect((await eligibility.evaluate({ riderId: r.id, branchId: branchA })).reasons).toEqual([
      'UNAVAILABLE',
    ]);
    await commands.setStatus(admin, r.id, { active: false });
    expect((await eligibility.evaluate({ riderId: r.id, branchId: branchA })).reasons).toEqual([
      'INACTIVE',
    ]);
    port.known = true;
    port.busyIds = new Set([r.id]);
    try {
      expect((await eligibility.evaluate({ riderId: r.id, branchId: branchA })).reasons).toContain(
        'BUSY',
      );
    } finally {
      port.known = false;
      port.busyIds = new Set();
    }
  });

  it('no se crean pagos ni entregas: las escrituras de F27 solo tocan app.riders y app.audit_events', async (ctx) => {
    skipUnlessReady(ctx);
    const count = async (t: string) =>
      (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))[0]?.n ?? 0;
    const hasPayments = (
      await q<{ oid: string | null }>("SELECT to_regclass('app.payments') AS oid")
    )[0]?.oid;
    const before = hasPayments ? await count('app.payments') : 0;
    const deliveriesBefore = await count('app.deliveries');
    const r = await make();
    await commands.setAvailability(admin, r.id, { availability: 'AVAILABLE' });
    await commands.setStatus(admin, r.id, { active: false });
    expect(hasPayments ? await count('app.payments') : 0).toBe(before);
    // F28 creó `app.deliveries`: F27 sigue sin escribir entregas (el recuento no cambia con sus comandos).
    expect(await count('app.deliveries')).toBe(deliveriesBefore);
  });
});
