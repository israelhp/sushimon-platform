import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { fixedClock } from './support/schedule-harness.js';
import { FakeScheduleRepo } from './support/fake-schedule-repo.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333'; // inactiva
const MISSING = '44444444-4444-4444-8444-444444444444';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const NOW = '2026-11-16T18:00:00.000Z'; // lunes 12:00 en Guatemala
const HOURS_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
const AVAILABILITY_CACHE = 'public, max-age=10, s-maxage=10';
const EMPTY_VERSION = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const READ_MANAGE = ['branches.read', 'branches.manage_hours'];

interface AssignmentFake {
  branchId: string | null;
  permissions: string[];
}

function staffRow(assignments: AssignmentFake[], active = true) {
  return {
    id: STAFF_ID,
    fullName: 'Ana Admin',
    active,
    assignments: assignments.map((a, i) => ({
      active: true,
      branchId: a.branchId,
      branch: a.branchId
        ? { id: a.branchId, name: `Sucursal ${i}`, code: `s-${i}`, active: true }
        : null,
      role: {
        code: `rol-${i}`,
        permissions: a.permissions.map((code) => ({ permission: { code } })),
      },
    })),
  };
}

/** Doble de PrismaService: solo identidad/personal y el estado de la sucursal (lo demás va al repo en memoria). */
function fakeDb(repo: FakeScheduleRepo) {
  const db = {
    branch: {
      findUnique: vi.fn((a: { where: { id: string } }) =>
        Promise.resolve(repo.branches.get(a.where.id) ?? null),
      ),
    },
    customer: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
    staffUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db))),
    $disconnect: () => Promise.resolve(),
  };
  return db;
}

const day = (weekday: number, intervals: [string, string][] = []) => ({
  weekday,
  intervals: intervals.map(([opensAt, closesAt]) => ({ opensAt, closesAt })),
});
const weekBody = (
  over: Record<number, [string, string][]> = {},
  expectedVersion = EMPTY_VERSION,
) => ({
  expectedVersion,
  days: [1, 2, 3, 4, 5, 6, 7].map((d) => day(d, over[d])),
});

async function createApp(
  keys: TestKeys,
  db: ReturnType<typeof fakeDb>,
  repo: FakeScheduleRepo,
  clock: ReturnType<typeof fixedClock>,
) {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
    RATE_LIMIT_MAX: '1000',
  });
  vi.resetModules();
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
  const { BranchScheduleRepository } =
    await import('../src/branch-schedule/branch-schedule.repository.js');
  const { CLOCK } = await import('../src/branch-schedule/clock.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .overrideProvider(BranchScheduleRepository)
    .useValue(repo)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

describe('Horarios, cierres y disponibilidad (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let repo: FakeScheduleRepo;
  let clock: ReturnType<typeof fixedClock>;
  let db: ReturnType<typeof fakeDb>;
  const http = () => request(app.getHttpServer());
  const bearer = async (claims?: Parameters<TestKeys['sign']>[0]) =>
    `Bearer ${await keys.sign(claims)}`;
  const asStaffWith = async (
    assignments: AssignmentFake[],
    claims: Record<string, unknown> = AAL2,
    active = true,
  ) => {
    db.staffUser.findUnique.mockResolvedValue(staffRow(assignments, active));
    return bearer(claims);
  };
  const asStaff = (
    over: { permissions?: string[]; branchId?: string | null } = {},
    claims: Record<string, unknown> = AAL2,
  ) =>
    asStaffWith(
      [{ branchId: over.branchId ?? null, permissions: over.permissions ?? READ_MANAGE }],
      claims,
    );

  const seedSchedule = () =>
    repo.setHours(A, [
      { weekday: 1, intervals: [{ opensAt: '11:00', closesAt: '22:00' }] },
      { weekday: 5, intervals: [{ opensAt: '11:00', closesAt: '24:00' }] },
      { weekday: 6, intervals: [{ opensAt: '00:00', closesAt: '02:00' }] },
    ]);

  beforeAll(async () => {
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    repo = new FakeScheduleRepo().addBranch(A).addBranch(B).addBranch(C, false);
    db = fakeDb(repo);
    clock = fixedClock(NOW);
    app = await createApp(keys, db, repo, clock);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('públicos', () => {
    it('GET /branches/:id/hours: 7 días ordenados, zona, cierres sin motivo, caché pública; sin autenticación', async () => {
      seedSchedule();
      repo.addClosure(A, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'Motivo interno');
      const res = await http().get(`/v1/branches/${A}/hours`).expect(200);
      expect(res.headers['cache-control']).toBe(HOURS_CACHE);
      expect(res.body).toEqual({
        branchId: A,
        timezone: 'America/Guatemala',
        days: [
          day(1, [['11:00', '22:00']]),
          day(2),
          day(3),
          day(4),
          day(5, [['11:00', '24:00']]),
          day(6, [['00:00', '02:00']]),
          day(7),
        ],
        upcomingClosures: [
          { startsAt: '2026-11-20T10:00:00.000Z', endsAt: '2026-11-20T12:00:00.000Z' },
        ],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/Motivo interno|reason|active/);
    });

    it('hours: sucursal sin horario => 200 con 7 días vacíos', async () => {
      const res = await http().get(`/v1/branches/${B}/hours`).expect(200);
      expect((res.body as { days: unknown[] }).days).toHaveLength(7);
    });

    it('GET /branches/:id/availability: contrato, serverTime del reloj inyectado, caché de 10 s sin stale-while-revalidate', async () => {
      seedSchedule();
      const res = await http().get(`/v1/branches/${A}/availability`).expect(200);
      expect(res.headers['cache-control']).toBe(AVAILABILITY_CACHE);
      expect(res.headers['cache-control']).not.toContain('stale-while-revalidate');
      expect(res.body).toEqual({
        branchId: A,
        timezone: 'America/Guatemala',
        serverTime: NOW,
        isOpenNow: true,
        isAcceptingOrders: true,
        reason: 'OPEN',
        nextOpensAt: null,
        nextClosesAt: '2026-11-17T04:00:00.000Z',
        nextTransitionAt: '2026-11-17T04:00:00.000Z',
      });
    });

    it('availability: cierre excepcional visible como estado, nunca su motivo; sin horario => SCHEDULE_NOT_CONFIGURED', async () => {
      seedSchedule();
      repo.addClosure(A, '2026-11-16T17:00:00Z', '2026-11-16T23:00:00Z', 'Duelo familiar');
      const res = await http().get(`/v1/branches/${A}/availability`).expect(200);
      expect(res.body).toMatchObject({
        reason: 'EXCEPTIONAL_CLOSURE',
        isOpenNow: false,
        nextOpensAt: '2026-11-16T23:00:00.000Z',
      });
      expect(JSON.stringify(res.body)).not.toContain('Duelo');
      const empty = await http().get(`/v1/branches/${B}/availability`).expect(200);
      expect(empty.body).toMatchObject({ reason: 'SCHEDULE_NOT_CONFIGURED', isOpenNow: false });
    });

    it('availability IGNORA at/now/timezone enviados por el cliente (no hay DTO de query: no se rechazan, no cambian nada)', async () => {
      seedSchedule();
      const base = await http().get(`/v1/branches/${A}/availability`).expect(200);
      const res = await http()
        .get(`/v1/branches/${A}/availability`)
        .query({ at: '2030-01-01T00:00:00Z', now: '2030-01-01T00:00:00Z', timezone: 'Asia/Tokyo' })
        .expect(200);
      expect(res.body).toEqual(base.body);
      expect((res.body as { serverTime: string }).serverTime).toBe(NOW);
      expect((res.body as { timezone: string }).timezone).toBe('America/Guatemala');
    });

    it('Cache-Control de availability nunca cruza una transición: max-age = min(10, s hasta nextTransitionAt); <1 s => no-store', async () => {
      seedSchedule(); // lunes cierra a las 22:00 local = 2026-11-17T04:00:00Z
      for (const [now, expected] of [
        ['2026-11-17T03:59:55.000Z', 'public, max-age=5, s-maxage=5'],
        ['2026-11-17T03:59:50.500Z', 'public, max-age=9, s-maxage=9'],
        ['2026-11-17T03:59:59.500Z', 'no-store'],
        ['2026-11-17T03:59:40.000Z', 'public, max-age=10, s-maxage=10'],
      ] as const) {
        clock.set(now);
        const res = await http().get(`/v1/branches/${A}/availability`).expect(200);
        expect(res.headers['cache-control']).toBe(expected);
        expect(res.headers['cache-control']).not.toContain('stale-while-revalidate');
      }
    });

    it('reason del cierre nunca aparece en respuestas públicas (hours ni availability), con un cierre en curso y otro futuro', async () => {
      seedSchedule();
      repo.addClosure(A, '2026-11-16T17:00:00Z', '2026-11-16T20:00:00Z', 'SECRETO-en-curso');
      repo.addClosure(A, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'SECRETO-futuro');
      for (const path of ['hours', 'availability']) {
        const res = await http().get(`/v1/branches/${A}/${path}`).expect(200);
        expect(res.text).not.toContain('SECRETO');
        if (path === 'hours') expect(res.text).not.toContain('reason');
      }
    });

    it('inexistente o inactiva => 404 idéntico y sin caché pública; uuid inválido => 400', async () => {
      for (const path of ['hours', 'availability']) {
        const inactive = await http().get(`/v1/branches/${C}/${path}`).expect(404);
        const missing = await http().get(`/v1/branches/${MISSING}/${path}`).expect(404);
        expect(inactive.headers['cache-control']).toBe('no-store');
        expect(missing.headers['cache-control']).toBe('no-store');
        expect((inactive.body as { message: string }).message).toBe(
          (missing.body as { message: string }).message,
        );
        expect(JSON.stringify(inactive.body)).not.toContain('INACTIVE');
        const bad = await http().get(`/v1/branches/no-uuid/${path}`).expect(400);
        expect(bad.headers['cache-control']).toBe('no-store');
      }
    });
  });

  describe('autenticación y autorización admin', () => {
    const closureId = '55555555-5555-4555-8555-555555555555';
    const routes: [string, string, unknown?][] = [
      ['get', `/v1/admin/branches/${A}/hours`],
      ['put', `/v1/admin/branches/${A}/hours`, weekBody()],
      ['get', `/v1/admin/branches/${A}/closures`],
      [
        'post',
        `/v1/admin/branches/${A}/closures`,
        { startsAt: '2026-11-20T10:00:00Z', endsAt: '2026-11-20T12:00:00Z' },
      ],
      ['patch', `/v1/admin/branches/${A}/closures/${closureId}`, { reason: 'x' }],
      ['delete', `/v1/admin/branches/${A}/closures/${closureId}`],
    ];
    const call = (method: string, url: string, auth?: string, body?: unknown) => {
      const r = (http() as unknown as Record<string, (u: string) => request.Test>)[method]!(url);
      if (auth) void r.set('Authorization', auth);
      return body === undefined ? r : r.send(body as object);
    };

    it('sin JWT, JWT inválido o firmado con otra clave => 401 con no-store', async () => {
      for (const [method, url, body] of routes) {
        for (const auth of [
          undefined,
          'Bearer x.y.z',
          `Bearer ${await keys.signWithForeignKey()}`,
        ]) {
          const res = await call(method, url, auth, body).expect(401);
          expect(res.headers['cache-control']).toBe('no-store');
        }
      }
    });

    it('cliente (no personal) => 403 con no-store en todas las rutas', async () => {
      const auth = await bearer(AAL2);
      for (const [method, url, body] of routes) {
        const res = await call(method, url, auth, body).expect(403);
        expect((res.body as { message: string }).message).toBe('Acceso denegado');
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });

    it('empleado desactivado => 403', async () => {
      const auth = await asStaffWith([{ branchId: null, permissions: READ_MANAGE }], AAL2, false);
      for (const [method, url, body] of routes) await call(method, url, auth, body).expect(403);
      expect(repo.audit).toHaveLength(0);
    });

    it('sesión aal1 => 403 MFA_REQUIRED, sin tocar datos', async () => {
      const auth = await asStaff({}, {});
      for (const [method, url, body] of routes) {
        const res = await call(method, url, auth, body).expect(403);
        expect((res.body as { message: string }).message).toBe('MFA_REQUIRED');
      }
      expect(repo.queries).toMatchObject({ readHours: 0, lockBranch: 0 });
    });

    it('aal2 sin permisos de sucursales => 403; solo lectura no puede escribir', async () => {
      const none = await asStaff({ permissions: ['dashboard.read'] });
      for (const [method, url, body] of routes) await call(method, url, none, body).expect(403);
      const readOnly = await asStaff({ permissions: ['branches.read'] });
      await call('get', `/v1/admin/branches/${A}/hours`, readOnly).expect(200);
      await call('get', `/v1/admin/branches/${A}/closures`, readOnly).expect(200);
      for (const [method, url, body] of routes.filter(([m]) => m !== 'get')) {
        await call(method, url, readOnly, body).expect(403);
      }
      expect(repo.audit).toHaveLength(0);
    });

    it('gerente de OTRA sucursal => 404 (igual que inexistente) en lectura y escritura', async () => {
      const auth = await asStaff({ branchId: B });
      for (const [method, url, body] of routes) {
        const other = await call(method, url, auth, body).expect(404);
        const missing = await call(method, url.replace(A, MISSING), auth, body).expect(404);
        expect((other.body as { message: string }).message).toBe(
          (missing.body as { message: string }).message,
        );
        expect(other.headers['cache-control']).toBe('no-store');
      }
      expect(repo.hours.get(A)).toBeUndefined();
      expect(repo.audit).toHaveLength(0);
    });

    it('gerente de SU sucursal sí opera', async () => {
      const auth = await asStaff({ branchId: A });
      await call('get', `/v1/admin/branches/${A}/hours`, auth).expect(200);
      await call(
        'put',
        `/v1/admin/branches/${A}/hours`,
        auth,
        weekBody({ 1: [['11:00', '22:00']] }),
      ).expect(200);
    });
  });

  describe('seguridad (revisión F08)', () => {
    const closureOf = (branch: string) =>
      repo.addClosure(branch, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'x');

    it('roles mezclados: read global + manage_hours solo en A => en B GET 200 y escrituras 404; en A todo permitido', async () => {
      const auth = await asStaffWith([
        { branchId: null, permissions: ['branches.read'] },
        { branchId: A, permissions: ['branches.manage_hours'] },
      ]);
      const inB = closureOf(B);
      await http().get(`/v1/admin/branches/${B}/hours`).set('Authorization', auth).expect(200);
      await http().get(`/v1/admin/branches/${B}/closures`).set('Authorization', auth).expect(200);
      await http()
        .put(`/v1/admin/branches/${B}/hours`)
        .set('Authorization', auth)
        .send(weekBody({ 1: [['11:00', '22:00']] }))
        .expect(404);
      await http()
        .post(`/v1/admin/branches/${B}/closures`)
        .set('Authorization', auth)
        .send({ startsAt: '2026-11-25T10:00:00Z', endsAt: '2026-11-25T12:00:00Z' })
        .expect(404);
      await http()
        .patch(`/v1/admin/branches/${B}/closures/${inB.id}`)
        .set('Authorization', auth)
        .send({ reason: 'y' })
        .expect(404);
      await http()
        .delete(`/v1/admin/branches/${B}/closures/${inB.id}`)
        .set('Authorization', auth)
        .expect(404);
      expect(repo.closures).toHaveLength(1);
      expect(repo.hours.get(B)).toBeUndefined();
      expect(repo.audit).toHaveLength(0);
      await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .send(weekBody({ 1: [['11:00', '22:00']] }))
        .expect(200);
    });

    it('IDOR cruzado: closureId de B bajo la ruta de A => mismo 404 que inexistente, sin escritura ni auditoría', async () => {
      const auth = await asStaff();
      const inB = closureOf(B);
      const missing = '66666666-6666-4666-8666-666666666666';
      for (const [method, id] of [
        ['patch', inB.id],
        ['patch', missing],
        ['delete', inB.id],
        ['delete', missing],
      ] as const) {
        const server = http();
        const req = server[method](`/v1/admin/branches/${A}/closures/${id}`).set(
          'Authorization',
          auth,
        );
        const res = await (method === 'patch' ? req.send({ reason: 'hack' }) : req).expect(404);
        expect((res.body as { message: string }).message).toBe('Cierre no encontrado');
        expect(res.headers['cache-control']).toBe('no-store');
      }
      expect(repo.closures).toEqual([
        expect.objectContaining({ id: inB.id, branchId: B, reason: 'x' }),
      ]);
      expect(repo.audit).toHaveLength(0);
    });

    it('__proto__ (raíz o anidado) en el body del PUT => 400 sin efectos ni contaminación', async () => {
      const auth = await asStaff();
      const days = JSON.stringify(weekBody().days);
      const raw = `{"expectedVersion":"${EMPTY_VERSION}","days":${days},"__proto__":{"admin":true}}`;
      await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(400);
      const nested = JSON.stringify(weekBody({ 1: [['10:00', '11:00']] })).replace(
        '"closesAt":"11:00"',
        '"closesAt":"11:00","__proto__":{"x":1}',
      );
      await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send(nested)
        .expect(400);
      expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
      expect(repo.hours.get(A)).toBeUndefined();
      expect(repo.audit).toHaveLength(0);
    });

    it('`constructor` como clave del body es inerte: no contamina el prototipo (comportamiento real: se ignora)', async () => {
      const res = await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', await asStaff())
        .send({ ...weekBody(), constructor: { prototype: { polluted: true } } });
      expect([200, 400]).toContain(res.status);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    });

    it('cuerpo > 100 kb o días de más => rechazado sin efectos (413 del parser; 400 por días)', async () => {
      const auth = await asStaff();
      const huge = { ...weekBody(), padding: 'x'.repeat(150_000) };
      const res = await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .send(huge);
      expect([400, 413]).toContain(res.status);
      expect(res.headers['cache-control']).toBe('no-store');
      const many = { ...weekBody(), days: Array.from({ length: 500 }, (_, i) => day((i % 7) + 1)) };
      await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .send(many)
        .expect(400);
      expect(repo.hours.get(A)).toBeUndefined();
      expect(repo.audit).toHaveLength(0);
    });

    it('errores de cualquier ruta llevan no-store: públicos (400/404) y admin (401/403/404/409/422)', async () => {
      const auth = await asStaff();
      for (const [url, status] of [
        [`/v1/branches/${MISSING}/hours`, 404],
        ['/v1/branches/xx/availability', 400],
        ['/v1/admin/branches/xx/hours', 401],
      ] as const) {
        const res = await http().get(url).expect(status);
        expect(res.headers['cache-control']).toBe('no-store');
      }
      const res = await http()
        .get(`/v1/admin/branches/${MISSING}/hours`)
        .set('Authorization', auth)
        .expect(404);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('PATCH de cierre futuro con startsAt retroactivo (> 1 h atrás) => 422 en path startsAt', async () => {
      const auth = await asStaff();
      const c = closureOf(A);
      const res = await http()
        .patch(`/v1/admin/branches/${A}/closures/${c.id}`)
        .set('Authorization', auth)
        .send({ startsAt: '2026-11-16T16:00:00Z' })
        .expect(422);
      expect(res.body).toMatchObject({
        code: 'CLOSURE_RANGE_INVALID',
        violations: [{ path: 'startsAt', code: 'STARTS_TOO_EARLY' }],
      });
    });

    it('lock timeout / transacción agotada => 409 BRANCH_SCHEDULE_BUSY; sin detalle interno', async () => {
      const auth = await asStaff();
      repo.failNextWriteWith = {
        code: 'P2010',
        meta: { code: '55P03' },
        message: 'canceling statement due to lock timeout',
      };
      const res = await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .send(weekBody({ 1: [['11:00', '22:00']] }))
        .expect(409);
      expect(res.body).toMatchObject({ code: 'BRANCH_SCHEDULE_BUSY', error: 'CONFLICT' });
      expect(res.text).not.toMatch(/lock timeout|55P03/);
      expect(repo.hours.get(A)).toBeUndefined();
    });

    it('página > 10 000 => 400', async () => {
      const auth = await asStaff();
      await http()
        .get(`/v1/admin/branches/${A}/closures?page=10001`)
        .set('Authorization', auth)
        .expect(400);
      await http()
        .get(`/v1/admin/branches/${A}/closures?page=10000`)
        .set('Authorization', auth)
        .expect(200);
    });
  });

  describe('horario admin', () => {
    it('GET: 7 días, versión y no-store; sucursal inactiva se puede consultar', async () => {
      seedSchedule();
      const res = await http()
        .get(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', await asStaff())
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.body as { version: string; days: unknown[]; timezone: string };
      expect(body.version).toMatch(/^[0-9a-f]{64}$/);
      expect(body.days).toHaveLength(7);
      await http()
        .get(`/v1/admin/branches/${C}/hours`)
        .set('Authorization', await asStaff())
        .expect(200);
    });

    it('PUT: guarda, devuelve la nueva versión (200) y audita; la lectura posterior coincide', async () => {
      const auth = await asStaff();
      const res = await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .send(weekBody({ 5: [['18:00', '24:00']], 6: [['00:00', '02:00']] }))
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const saved = res.body as {
        version: string;
        days: { weekday: number; intervals: unknown[] }[];
      };
      expect(saved.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(repo.audit).toEqual([
        expect.objectContaining({ action: 'branch.hours_updated', actorId: STAFF_ID }),
      ]);
      const read = await http()
        .get(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .expect(200);
      expect(read.body).toEqual(saved);
    });

    it('PUT idéntico es idempotente (200, una sola auditoría); versión vieja => 409 HOURS_VERSION_CONFLICT', async () => {
      const auth = await asStaff();
      const first = await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .send(weekBody({ 1: [['11:00', '22:00']] }))
        .expect(200);
      const version = (first.body as { version: string }).version;
      await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .send(weekBody({ 1: [['11:00', '22:00']] }, version))
        .expect(200);
      expect(repo.audit).toHaveLength(1);
      const stale = await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', auth)
        .send(weekBody({ 2: [['11:00', '22:00']] }))
        .expect(409);
      expect(stale.body).toMatchObject({
        statusCode: 409,
        error: 'CONFLICT',
        code: 'HOURS_VERSION_CONFLICT',
      });
      expect(stale.headers['cache-control']).toBe('no-store');
    });

    it('PUT 422 SCHEDULE_INVALID: code, violations con path/code y requestId; no guarda', async () => {
      const res = await http()
        .put(`/v1/admin/branches/${A}/hours`)
        .set('Authorization', await asStaff())
        .send(
          weekBody({
            5: [
              ['11:00', '15:00'],
              ['14:00', '18:00'],
            ],
            6: [['18:00', '02:00']],
          }),
        )
        .expect(422);
      expect(res.body).toMatchObject({
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        code: 'SCHEDULE_INVALID',
        message: 'Horario inválido',
        violations: [
          {
            path: 'days[4].intervals[1]',
            code: 'INTERVAL_OVERLAP',
            message: 'Se solapa con days[4].intervals[0] (11:00-15:00)',
          },
          { path: 'days[5].intervals[0]', code: 'INTERVAL_RANGE_INVALID' },
        ],
      });
      expect(res.body).toHaveProperty('requestId');
      expect(res.body).not.toHaveProperty('details');
      expect(repo.hours.get(A)).toBeUndefined();
      expect(repo.audit).toHaveLength(0);
    });

    it('PUT 400 de forma (con details, sin code): cada variante', async () => {
      const auth = await asStaff();
      const ok = weekBody();
      const bads: Record<string, unknown> = {
        'versión malformada': { ...ok, expectedVersion: 'abc' },
        'sin versión': { days: ok.days },
        '6 días': { ...ok, days: ok.days.slice(0, 6) },
        '8 días': { ...ok, days: [...ok.days, day(1)] },
        'weekday 0': { ...ok, days: [day(0), ...ok.days.slice(1)] },
        'weekday 8': { ...ok, days: [day(8), ...ok.days.slice(1)] },
        'weekday repetido': { ...ok, days: [day(1), day(1), ...ok.days.slice(2)] },
        'HH:mm inválido': { ...ok, days: [day(1, [['9:00', '10:00']]), ...ok.days.slice(1)] },
        '25:00': { ...ok, days: [day(1, [['10:00', '25:00']]), ...ok.days.slice(1)] },
        'apertura 24:00': { ...ok, days: [day(1, [['24:00', '24:00']]), ...ok.days.slice(1)] },
        '7 intervalos': {
          ...ok,
          days: [
            day(
              1,
              Array.from({ length: 7 }, (_, i) => [`0${i}:00`, `0${i}:30`] as [string, string]),
            ),
            ...ok.days.slice(1),
          ],
        },
        'propiedad extra': { ...ok, extra: 1 },
        'intervalo con propiedad extra': {
          ...ok,
          days: [
            { weekday: 1, intervals: [{ opensAt: '10:00', closesAt: '11:00', x: 1 }] },
            ...ok.days.slice(1),
          ],
        },
      };
      for (const [name, body] of Object.entries(bads)) {
        const res = await http()
          .put(`/v1/admin/branches/${A}/hours`)
          .set('Authorization', auth)
          .send(body as object)
          .expect(400);
        expect(res.body, name).toHaveProperty('details');
        expect(res.body, name).not.toHaveProperty('code');
      }
      await http()
        .put('/v1/admin/branches/no-uuid/hours')
        .set('Authorization', auth)
        .send(ok)
        .expect(400);
      expect(repo.audit).toHaveLength(0);
    });
  });

  describe('cierres admin', () => {
    const body = {
      startsAt: '2026-11-20T10:00:00Z',
      endsAt: '2026-11-20T12:00:00-06:00',
      reason: ' Evento ',
    };

    it('POST: 201 con el cierre normalizado y auditado; sin zona => 400; rango => 422; solape => 409', async () => {
      const auth = await asStaff();
      const created = await http()
        .post(`/v1/admin/branches/${A}/closures`)
        .set('Authorization', auth)
        .send({ ...body, endsAt: '2026-11-20T12:00:00Z' })
        .expect(201);
      expect(created.headers['cache-control']).toBe('no-store');
      expect(created.body).toMatchObject({
        branchId: A,
        startsAt: '2026-11-20T10:00:00.000Z',
        endsAt: '2026-11-20T12:00:00.000Z',
        reason: 'Evento',
        status: 'upcoming',
      });
      expect(repo.audit).toEqual([expect.objectContaining({ action: 'branch_closure.created' })]);

      await http()
        .post(`/v1/admin/branches/${A}/closures`)
        .set('Authorization', auth)
        .send({ startsAt: '2026-11-21T10:00:00', endsAt: '2026-11-21T12:00:00Z' })
        .expect(400);
      await http()
        .post(`/v1/admin/branches/${A}/closures`)
        .set('Authorization', auth)
        .send({ startsAt: '2026-11-21T10:00:00Z' })
        .expect(400);
      await http()
        .post(`/v1/admin/branches/${A}/closures`)
        .set('Authorization', auth)
        .send({ ...body, id: 'x' })
        .expect(400);

      const range = await http()
        .post(`/v1/admin/branches/${A}/closures`)
        .set('Authorization', auth)
        .send({ startsAt: '2026-11-21T12:00:00Z', endsAt: '2026-11-21T10:00:00Z' })
        .expect(422);
      expect(range.body).toMatchObject({
        code: 'CLOSURE_RANGE_INVALID',
        error: 'UNPROCESSABLE_ENTITY',
        violations: [{ code: 'RANGE_EMPTY' }],
      });

      const overlap = await http()
        .post(`/v1/admin/branches/${A}/closures`)
        .set('Authorization', auth)
        .send({ startsAt: '2026-11-20T11:00:00Z', endsAt: '2026-11-20T13:00:00Z' })
        .expect(409);
      expect(overlap.body).toMatchObject({
        code: 'CLOSURE_OVERLAP',
        error: 'CONFLICT',
        violations: [{ path: `closures/${(created.body as { id: string }).id}` }],
      });
      expect(repo.closures).toHaveLength(1);
    });

    it('GET lista: filtros y paginación, solo de la sucursal, con motivo y no-store; 400 en parámetros inválidos', async () => {
      const auth = await asStaff();
      repo.addClosure(A, '2026-11-10T10:00:00Z', '2026-11-11T10:00:00Z', 'pasado');
      repo.addClosure(A, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'futuro');
      repo.addClosure(B, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'otra sucursal');
      const current = await http()
        .get(`/v1/admin/branches/${A}/closures`)
        .set('Authorization', auth)
        .expect(200);
      expect(current.headers['cache-control']).toBe('no-store');
      expect(current.body).toMatchObject({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [{ reason: 'futuro', status: 'upcoming' }],
      });
      const all = await http()
        .get(`/v1/admin/branches/${A}/closures?status=all&pageSize=1&page=2`)
        .set('Authorization', auth)
        .expect(200);
      expect(all.body).toMatchObject({
        page: 2,
        pageSize: 1,
        total: 2,
        items: [{ reason: 'pasado', status: 'past' }],
      });
      for (const qs of [
        'status=otro',
        'page=0',
        'pageSize=101',
        'from=2026-11-20T10:00:00',
        'from=2026-11-21T00:00:00Z&to=2026-11-20T00:00:00Z',
      ]) {
        await http()
          .get(`/v1/admin/branches/${A}/closures?${qs}`)
          .set('Authorization', auth)
          .expect(400);
      }
    });

    it('PATCH y DELETE por estado (futuro, en curso, terminado) y pertenencia', async () => {
      const auth = await asStaff();
      const past = repo.addClosure(A, '2026-11-10T10:00:00Z', '2026-11-11T10:00:00Z');
      const active = repo.addClosure(A, '2026-11-16T15:00:00Z', '2026-11-16T20:00:00Z');
      const future = repo.addClosure(A, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z');
      const url = (id: string, branch = A) => `/v1/admin/branches/${branch}/closures/${id}`;

      const edited = await http()
        .patch(url(future.id))
        .set('Authorization', auth)
        .send({ reason: 'Nuevo' })
        .expect(200);
      expect(edited.body).toMatchObject({ id: future.id, reason: 'Nuevo' });
      expect(edited.headers['cache-control']).toBe('no-store');
      await http().patch(url(future.id)).set('Authorization', auth).send({}).expect(400);

      const ended = await http()
        .patch(url(active.id))
        .set('Authorization', auth)
        .send({ endsAt: '2026-11-16T00:00:00Z' })
        .expect(200);
      expect(ended.body).toMatchObject({ endsAt: NOW, status: 'past' });
      const locked = await http()
        .patch(url(past.id))
        .set('Authorization', auth)
        .send({ reason: 'x' })
        .expect(409);
      expect(locked.body).toMatchObject({ code: 'CLOSURE_NOT_EDITABLE' });

      const notDeletable = await http().delete(url(past.id)).set('Authorization', auth).expect(409);
      expect(notDeletable.body).toMatchObject({ code: 'CLOSURE_NOT_DELETABLE' });
      await http()
        .patch(url(future.id, B))
        .set('Authorization', auth)
        .send({ reason: 'x' })
        .expect(404);
      await http().delete(url(future.id, B)).set('Authorization', auth).expect(404);
      await http().delete(url('no-uuid')).set('Authorization', auth).expect(400);

      const removed = await http().delete(url(future.id)).set('Authorization', auth).expect(204);
      expect(removed.headers['cache-control']).toBe('no-store');
      expect(removed.text).toBe('');
      await http().delete(url(future.id)).set('Authorization', auth).expect(404);
      expect(repo.audit.map((a) => a.action)).toEqual([
        'branch_closure.updated',
        'branch_closure.updated',
        'branch_closure.cancelled',
      ]);
    });

    it('un cierre creado afecta de inmediato a la disponibilidad pública', async () => {
      seedSchedule();
      const auth = await asStaff();
      await http()
        .post(`/v1/admin/branches/${A}/closures`)
        .set('Authorization', auth)
        .send({ startsAt: '2026-11-16T17:00:00Z', endsAt: '2026-11-16T20:00:00Z' })
        .expect(201);
      const res = await http().get(`/v1/branches/${A}/availability`).expect(200);
      expect(res.body).toMatchObject({
        reason: 'EXCEPTIONAL_CLOSURE',
        nextOpensAt: '2026-11-16T20:00:00.000Z',
      });
    });
  });
});
