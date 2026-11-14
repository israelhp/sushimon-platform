import { ConfigService } from '@nestjs/config';
import { Logger, type HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { BranchAvailabilityService } from '../src/branch-schedule/branch-availability.service.js';
import { BranchClosuresService } from '../src/branch-schedule/branch-closures.service.js';
import { BranchHoursService } from '../src/branch-schedule/branch-hours.service.js';
import {
  BranchScheduleRepository,
  type ScheduleTx,
} from '../src/branch-schedule/branch-schedule.repository.js';
import { hoursVersion, rowsToDays, type HoursDay } from '../src/branch-schedule/schedule-policy.js';
import { BranchesQueryService } from '../src/branches/branches-query.service.js';
import { BranchesRepository } from '../src/branches/branches.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import type { StaffContext } from '../src/identity/identity.types.js';
import { fixedClock } from './support/schedule-harness.js';
import { globalStaff, scopedStaff } from './support/staff-context.js';
import { cleanupTestData, ensureAuthStub, migrate, TEST_URL, withClient } from './support/db.js';

/**
 * F08 contra PostgreSQL REAL (DATABASE_URL_TEST; se omite sin ella). Cubre lo que los dobles no pueden: SQL crudo
 * con `time` '24:00:00', FOR UPDATE, EXCLUDE y CHECK reales, atomicidad y concurrencia. Datos marcados
 * `@sushimon.test`; la limpieza borra solo lo creado aquí.
 */
const url = TEST_URL;
const NOW = '2026-11-16T18:00:00.000Z'; // lunes 12:00 Guatemala
const EMPTY_VERSION = hoursVersion(rowsToDays([]));
const uniqueCode = () => `t${randomUUID().slice(0, 8)}`;

const week = (over: Record<number, [string, string][]> = {}) => ({
  days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    intervals: (over[weekday] ?? []).map(([opensAt, closesAt]) => ({ opensAt, closesAt })),
  })),
});

async function failure(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}
const codeOf = (e: HttpException) => (e.getResponse() as { code?: string }).code;

/** Escribe parte del horario y luego rompe un CHECK real: el PUT entero debe revertirse. */
class BrokenCheckRepo extends BranchScheduleRepository {
  override async replaceHours(tx: ScheduleTx, branchId: string, days: readonly HoursDay[]) {
    await super.replaceHours(tx, branchId, days);
    await tx.$executeRaw`INSERT INTO app.branch_hours (branch_id, weekday, opens_at, closes_at)
      VALUES (${branchId}::uuid, 7::smallint, '12:00'::time, '11:00'::time)`;
  }
}

/** Escribe parte del horario y luego viola el EXCLUDE real `branch_hours_no_overlap`. */
class BrokenOverlapRepo extends BranchScheduleRepository {
  override async replaceHours(tx: ScheduleTx, branchId: string, days: readonly HoursDay[]) {
    await super.replaceHours(tx, branchId, days);
    await tx.$executeRaw`INSERT INTO app.branch_hours (branch_id, weekday, opens_at, closes_at)
      VALUES (${branchId}::uuid, 2::smallint, '11:00'::time, '13:00'::time),
             (${branchId}::uuid, 2::smallint, '12:00'::time, '14:00'::time)`;
  }
}

/** Salta la verificación previa de solape para ejercitar la red de seguridad del EXCLUDE real. */
class NoPrecheckRepo extends BranchScheduleRepository {
  override findOverlap(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

describe.skipIf(!url)('Horarios y cierres contra PostgreSQL real', () => {
  let prisma: PrismaService;
  let repo: BranchScheduleRepository;
  let hours: BranchHoursService;
  let closures: BranchClosuresService;
  let availability: BranchAvailabilityService;
  let actor: StaffContext;
  const clock = fixedClock(NOW);
  const createdBranchIds = new Set<string>();
  const services = (r: BranchScheduleRepository) => {
    const authorization = new AuthorizationService({} as IdentityService);
    const branches = new BranchesQueryService(new BranchesRepository(prisma), authorization);
    const audit = new AuditService();
    return {
      hours: new BranchHoursService(r, branches, authorization, audit, clock, 'America/Guatemala'),
      closures: new BranchClosuresService(r, branches, authorization, audit, clock),
      availability: new BranchAvailabilityService(r, clock, 'America/Guatemala'),
    };
  };
  const newBranch = async (active = true) => {
    const b = await prisma.branch.create({
      data: { code: uniqueCode(), name: 'Sucursal de prueba', address: 'Zona 1', active },
    });
    createdBranchIds.add(b.id);
    return b.id;
  };
  const auditOf = (entityType: string, branchId: string) =>
    prisma.auditEvent.findMany({
      where: { entityType, branchId },
      orderBy: { createdAt: 'asc' },
    });
  const rawHours = (branchId: string) =>
    prisma.$queryRaw<{ weekday: number; opens_at: string; closes_at: string }[]>`
      SELECT weekday::int AS weekday, opens_at::text AS opens_at, closes_at::text AS closes_at
      FROM app.branch_hours WHERE branch_id = ${branchId}::uuid ORDER BY weekday, opens_at`;

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await withClient(url as string, ensureAuthStub);
    migrate(url as string);
    prisma = new PrismaService(new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url })));
    repo = new BranchScheduleRepository(prisma);
    ({ hours, closures, availability } = services(repo));
    const admin = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    const staff = await prisma.staffUser.create({
      data: {
        fullName: 'Admin Prueba F08',
        email: `${randomUUID().slice(0, 8)}@sushimon.test`,
        assignments: { create: [{ roleId: admin.id, branchId: null }] },
      },
    });
    actor = globalStaff(['branches.read', 'branches.manage_hours'], { staffId: staff.id });
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await cleanupTestData(url as string, { authUserIds: [], branchIds: createdBranchIds });
  });

  describe('horario semanal', () => {
    it('24:00 de ida y vuelta: se guarda como time, se lee como "24:00" y el motor lo usa', async () => {
      const id = await newBranch();
      const saved = await hours.replace(actor, id, {
        expectedVersion: EMPTY_VERSION,
        ...week({
          5: [['11:00', '24:00']],
          6: [
            ['00:00', '02:00'],
            ['11:00', '24:00'],
          ],
        }),
      });
      expect(saved.days[4]?.intervals).toEqual([{ opensAt: '11:00', closesAt: '24:00' }]);
      expect((await rawHours(id)).map((r) => r.closes_at)).toContain('24:00:00');
      const read = await hours.getAdmin(actor, id);
      expect(read).toEqual(saved);
      expect(read.version).toBe(hoursVersion(read.days));
      // Viernes 20-nov 23:59:59 local (= 2026-11-21T05:59:59Z): abierta hasta sáb 02:00 (medianoche fusionada).
      const r = await availability.getAvailability({
        branchId: id,
        at: new Date('2026-11-21T05:59:59Z'),
      });
      expect(r).toMatchObject({ reason: 'OPEN', nextClosesAt: new Date('2026-11-21T08:00:00Z') });
    });

    it('PUT atómico: si el CHECK real falla en un día no se guarda NADA ni se audita', async () => {
      const id = await newBranch();
      const first = await hours.replace(actor, id, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 1: [['11:00', '22:00']] }),
      });
      const broken = services(new BrokenCheckRepo(prisma)).hours;
      const e = await failure(
        broken.replace(actor, id, {
          expectedVersion: first.version,
          ...week({ 1: [['09:00', '10:00']], 3: [['11:00', '12:00']] }),
        }),
      );
      expect(e.getStatus()).toBe(400);
      expect(JSON.stringify(e.getResponse())).not.toContain('branch_hours');
      expect((await hours.getAdmin(actor, id)).version).toBe(first.version);
      expect(await rawHours(id)).toHaveLength(1);
      expect(await auditOf('branch_hours', id)).toHaveLength(1);
    });

    it('EXCLUDE real de horarios (23P01) => 422 SCHEDULE_INVALID y rollback total', async () => {
      const id = await newBranch();
      const first = await hours.replace(actor, id, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 1: [['11:00', '22:00']] }),
      });
      const broken = services(new BrokenOverlapRepo(prisma)).hours;
      const e = await failure(
        broken.replace(actor, id, {
          expectedVersion: first.version,
          ...week({ 4: [['11:00', '12:00']] }),
        }),
      );
      expect([e.getStatus(), codeOf(e)]).toEqual([422, 'SCHEDULE_INVALID']);
      expect((await hours.getAdmin(actor, id)).version).toBe(first.version);
      expect(await auditOf('branch_hours', id)).toHaveLength(1);
    });

    it('concurrencia: dos PUT con la misma expectedVersion => uno gana y el otro recibe 409', async () => {
      const id = await newBranch();
      const [x, y] = await Promise.allSettled([
        hours.replace(actor, id, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['10:00', '12:00']] }),
        }),
        hours.replace(actor, id, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['13:00', '15:00']] }),
        }),
      ]);
      const outcomes = [x, y];
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const lost = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
      expect([
        (lost.reason as HttpException).getStatus(),
        codeOf(lost.reason as HttpException),
      ]).toEqual([409, 'HOURS_VERSION_CONFLICT']);
      const winner = outcomes.find((o) => o.status === 'fulfilled') as PromiseFulfilledResult<{
        version: string;
      }>;
      expect((await hours.getAdmin(actor, id)).version).toBe(winner.value.version);
      expect(await rawHours(id)).toHaveLength(1);
      expect(await auditOf('branch_hours', id)).toHaveLength(1);
    });

    it('PUT idéntico: idempotente, sin escritura ni auditoría nueva; auditoría con diff real', async () => {
      const id = await newBranch();
      const a = await hours.replace(actor, id, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 1: [['11:00', '22:00']], 2: [['11:00', '22:00']] }),
      });
      const same = await hours.replace(actor, id, {
        expectedVersion: a.version,
        ...week({ 2: [['11:00', '22:00']], 1: [['11:00', '22:00']] }),
      });
      expect(same).toEqual(a);
      const b = await hours.replace(actor, id, {
        expectedVersion: a.version,
        ...week({ 1: [['11:00', '22:00']], 2: [['12:00', '22:00']] }),
      });
      const events = await auditOf('branch_hours', id);
      expect(events.map((e) => e.action)).toEqual(['branch.hours_updated', 'branch.hours_updated']);
      expect(events[1]).toMatchObject({
        actorId: actor.staffId,
        entityId: id,
        oldValues: { weekday_2: '11:00-22:00', version: a.version },
        newValues: { weekday_2: '12:00-22:00', version: b.version },
      });
    });

    it('alcance: otra sucursal => 404 sin escribir; se puede preparar una sucursal inactiva', async () => {
      const id = await newBranch();
      const inactive = await newBranch(false);
      const other = scopedStaff(['branches.read', 'branches.manage_hours'], [randomUUID()], {
        staffId: actor.staffId,
      });
      await expect(
        hours.replace(other, id, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['11:00', '22:00']] }),
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await rawHours(id)).toHaveLength(0);
      await expect(
        hours.replace(actor, inactive, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['11:00', '22:00']] }),
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('cierres', () => {
    const body = (startsAt: string, endsAt: string, reason?: string) => ({
      startsAt,
      endsAt,
      ...(reason ? { reason } : {}),
    });

    it('EXCLUDE: solapamiento => 409 CLOSURE_OVERLAP (verificación previa) y contiguos permitidos', async () => {
      const id = await newBranch();
      const first = await closures.create(
        actor,
        id,
        body('2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z'),
      );
      const e = await failure(
        closures.create(actor, id, body('2026-11-20T11:00:00Z', '2026-11-20T13:00:00Z')),
      );
      expect([e.getStatus(), codeOf(e)]).toEqual([409, 'CLOSURE_OVERLAP']);
      expect(e.getResponse()).toMatchObject({ violations: [{ path: `closures/${first.id}` }] });
      await expect(
        closures.create(actor, id, body('2026-11-20T12:00:00Z', '2026-11-20T13:00:00Z')),
      ).resolves.toBeDefined();
      await expect(
        closures.create(actor, id, body('2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z')),
      ).resolves.toBeDefined();
      expect(await prisma.branchClosure.count({ where: { branchId: id } })).toBe(3);
    });

    it('EXCLUDE real como red de seguridad (sin verificación previa): 23P01 => 409 y sin auditoría', async () => {
      const id = await newBranch();
      await closures.create(actor, id, body('2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z'));
      const bare = services(new NoPrecheckRepo(prisma)).closures;
      const e = await failure(
        bare.create(actor, id, body('2026-11-20T11:00:00Z', '2026-11-20T13:00:00Z')),
      );
      expect([e.getStatus(), codeOf(e)]).toEqual([409, 'CLOSURE_OVERLAP']);
      expect(await prisma.branchClosure.count({ where: { branchId: id } })).toBe(1);
      expect(await auditOf('branch_closure', id)).toHaveLength(1);
    });

    it('creaciones simultáneas con el mismo rango: una gana y la otra recibe 409', async () => {
      const id = await newBranch();
      const results = await Promise.allSettled([
        closures.create(actor, id, body('2026-11-25T10:00:00Z', '2026-11-25T12:00:00Z')),
        closures.create(actor, id, body('2026-11-25T11:00:00Z', '2026-11-25T13:00:00Z')),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(codeOf(lost.reason as HttpException)).toBe('CLOSURE_OVERLAP');
      expect(await prisma.branchClosure.count({ where: { branchId: id } })).toBe(1);
    });

    it('cierres de OTRA sucursal no se ven (listado, disponibilidad ni solape)', async () => {
      const a = await newBranch();
      const b = await newBranch();
      await hours.replace(actor, a, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 1: [['11:00', '22:00']] }),
      });
      await closures.create(
        actor,
        b,
        body('2026-11-16T17:00:00Z', '2026-11-16T23:00:00Z', 'solo B'),
      );
      expect((await closures.list(actor, a, { status: 'all' })).total).toBe(0);
      expect((await closures.list(actor, b, { status: 'all' })).total).toBe(1);
      expect(
        (await availability.getAvailability({ branchId: a, at: new Date('2026-11-16T19:00:00Z') }))
          .reason,
      ).toBe('OPEN');
      expect(
        (await availability.getAvailability({ branchId: b, at: new Date('2026-11-16T19:00:00Z') }))
          .reason,
      ).toBe('SCHEDULE_NOT_CONFIGURED');
      await expect(
        closures.create(actor, a, body('2026-11-16T17:00:00Z', '2026-11-16T23:00:00Z')),
      ).resolves.toBeDefined();
    });

    it('el cierre vigente se refleja en la disponibilidad desde la BD; fin excluido', async () => {
      const id = await newBranch();
      await hours.replace(actor, id, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 1: [['11:00', '22:00']] }),
      });
      await closures.create(actor, id, body('2026-11-16T19:00:00Z', '2026-11-16T23:00:00Z'));
      const at = (iso: string) => availability.getAvailability({ branchId: id, at: new Date(iso) });
      expect(await at('2026-11-16T19:00:00Z')).toMatchObject({
        reason: 'EXCEPTIONAL_CLOSURE',
        nextOpensAt: new Date('2026-11-16T23:00:00Z'),
      });
      expect((await at('2026-11-16T22:59:59Z')).reason).toBe('EXCEPTIONAL_CLOSURE');
      expect((await at('2026-11-16T23:00:00Z')).reason).toBe('OPEN');
    });

    it('CHECK reales: ends_at > starts_at y motivo en blanco los rechaza la BD', async () => {
      const id = await newBranch();
      await expect(
        prisma.branchClosure.create({
          data: {
            branchId: id,
            startsAt: new Date('2026-12-01T10:00:00Z'),
            endsAt: new Date('2026-12-01T10:00:00Z'),
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.branchClosure.create({
          data: {
            branchId: id,
            startsAt: new Date('2026-12-01T10:00:00Z'),
            endsAt: new Date('2026-12-01T11:00:00Z'),
            reason: '   ',
          },
        }),
      ).rejects.toThrow();
    });

    it('auditoría: created / updated (diff real) / cancelled con actor y sucursal; en curso solo se acorta', async () => {
      const id = await newBranch();
      const created = await closures.create(
        actor,
        id,
        body('2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'Evento'),
      );
      await closures.update(actor, id, created.id, { reason: 'Evento privado' });
      await closures.update(actor, id, created.id, { reason: 'Evento privado' }); // sin cambios: no audita
      await closures.remove(actor, id, created.id);
      const active = await closures.create(
        actor,
        id,
        body('2026-11-16T17:00:00Z', '2026-11-16T22:00:00Z'),
      );
      const ended = await closures.update(actor, id, active.id, { endsAt: '2026-11-16T10:00:00Z' });
      expect(ended).toMatchObject({ endsAt: NOW, status: 'past' });
      expect(await failure(closures.remove(actor, id, active.id))).toMatchObject({ status: 409 });

      const events = await auditOf('branch_closure', id);
      expect(events.map((e) => e.action)).toEqual([
        'branch_closure.created',
        'branch_closure.updated',
        'branch_closure.cancelled',
        'branch_closure.created',
        'branch_closure.updated',
      ]);
      expect(events[1]).toMatchObject({
        actorId: actor.staffId,
        branchId: id,
        entityId: created.id,
        oldValues: { reason: 'Evento' },
        newValues: { reason: 'Evento privado' },
      });
      expect(events[2]).toMatchObject({
        oldValues: {
          startsAt: '2026-11-20T10:00:00.000Z',
          endsAt: '2026-11-20T12:00:00.000Z',
          reason: 'Evento privado',
        },
      });
      expect(await prisma.branchClosure.count({ where: { id: created.id } })).toBe(0);
    });
  });

  describe('candados y topes (S1, S2, M1)', () => {
    it('lock_timeout: si otra transacción retiene la fila, el PUT falla con 409 BRANCH_SCHEDULE_BUSY (~2 s) y no guarda', async () => {
      const id = await newBranch();
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => (release = r));
      let locked: () => void = () => undefined;
      const lockTaken = new Promise<void>((r) => (locked = r));
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM app.branches WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
          locked();
          await held;
        },
        { timeout: 15_000 },
      );
      await lockTaken;
      const started = Date.now();
      const e = await failure(
        hours.replace(actor, id, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['11:00', '22:00']] }),
        }),
      );
      release();
      await holder;
      expect([e.getStatus(), codeOf(e)]).toEqual([409, 'BRANCH_SCHEDULE_BUSY']);
      expect(Date.now() - started).toBeLessThan(6_000);
      expect(await rawHours(id)).toHaveLength(0);
      expect(await auditOf('branch_hours', id)).toHaveLength(0);
    });

    it('FOR NO KEY UPDATE no bloquea inserciones hijas (FK) de otros módulos', async () => {
      const id = await newBranch();
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => (release = r));
      let locked: () => void = () => undefined;
      const lockTaken = new Promise<void>((r) => (locked = r));
      const holder = repo.transaction(async (tx) => {
        await repo.lockBranch(tx, id);
        locked();
        await held;
      });
      await lockTaken;
      // Una inserción hija (FK hacia branches) no espera al candado NO KEY UPDATE.
      const t0 = Date.now();
      await prisma.branchClosure.create({
        data: {
          branchId: id,
          startsAt: new Date('2027-01-01T00:00:00Z'),
          endsAt: new Date('2027-01-01T01:00:00Z'),
        },
      });
      expect(Date.now() - t0).toBeLessThan(1_500);
      release();
      await holder;
    });

    it('tope de 100 cierres vigentes o futuros: el 101º => 422 CLOSURE_LIMIT_REACHED; los pasados no cuentan', async () => {
      const id = await newBranch();
      await prisma.branchClosure.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          branchId: id,
          startsAt: new Date(Date.parse('2026-12-01T00:00:00Z') + i * 7_200_000),
          endsAt: new Date(Date.parse('2026-12-01T01:00:00Z') + i * 7_200_000),
        })),
      });
      await prisma.branchClosure.create({
        data: {
          branchId: id,
          startsAt: new Date('2026-01-01T00:00:00Z'),
          endsAt: new Date('2026-01-02T00:00:00Z'),
        },
      });
      const e = await failure(
        closures.create(actor, id, {
          startsAt: '2027-06-01T00:00:00Z',
          endsAt: '2027-06-01T01:00:00Z',
        }),
      );
      expect([e.getStatus(), codeOf(e)]).toEqual([422, 'CLOSURE_LIMIT_REACHED']);
      expect(await prisma.branchClosure.count({ where: { branchId: id } })).toBe(101);
    });

    it('loadSchedule: varias sucursales en una consulta; inexistente ausente; inactiva sin horario ni cierres', async () => {
      const a = await newBranch();
      const inactive = await newBranch(false);
      await hours.replace(actor, a, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 5: [['11:00', '24:00']] }),
      });
      await closures.create(actor, a, {
        startsAt: '2026-11-20T10:00:00Z',
        endsAt: '2026-11-20T12:00:00Z',
      });
      await prisma.branchClosure.create({
        data: {
          branchId: inactive,
          startsAt: new Date('2026-11-20T10:00:00Z'),
          endsAt: new Date('2026-11-20T12:00:00Z'),
        },
      });
      const out = await repo.loadSchedule(
        [a, inactive, randomUUID()],
        new Date(NOW),
        new Date('2026-11-30T00:00:00Z'),
      );
      expect(out).toHaveLength(2);
      expect(out.find((s) => s.branchId === a)).toMatchObject({
        active: true,
        hours: [{ weekday: 5, opensAt: '11:00', closesAt: '24:00' }],
        closures: [
          {
            startsAt: Date.parse('2026-11-20T10:00:00Z'),
            endsAt: Date.parse('2026-11-20T12:00:00Z'),
          },
        ],
      });
      expect(out.find((s) => s.branchId === inactive)).toMatchObject({
        active: false,
        hours: [],
        closures: [],
      });
    });

    it('IDOR cruzado: el cierre de B bajo la ruta de A responde 404 y no se toca', async () => {
      const a = await newBranch();
      const b = await newBranch();
      const inB = await closures.create(actor, b, {
        startsAt: '2026-11-25T10:00:00Z',
        endsAt: '2026-11-25T12:00:00Z',
        reason: 'B',
      });
      await expect(closures.update(actor, a, inB.id, { reason: 'hack' })).rejects.toMatchObject({
        status: 404,
      });
      await expect(closures.remove(actor, a, inB.id)).rejects.toMatchObject({ status: 404 });
      expect(await prisma.branchClosure.findUniqueOrThrow({ where: { id: inB.id } })).toMatchObject(
        { reason: 'B' },
      );
      expect(await auditOf('branch_closure', a)).toHaveLength(0);
    });
  });
});
