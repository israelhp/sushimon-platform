import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FakeAuthAdmin } from './support/fake-auth-admin.js';
import { FakeStaffRepo } from './support/fake-staff-repo.js';
import { ROLE_PERMISSIONS } from './support/staff-context.js';
import { assignmentRecord, BRANCH_A, BRANCH_B, staffRecord } from './support/staff-fixtures.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

/**
 * F02 · `POST /v1/admin/staff/{id}/mfa-reset` por HTTP real con el repositorio de personal en memoria y el puerto
 * de Supabase Auth Admin simulado: NINGUNA llamada a Supabase. Un administrador global reinicia el MFA de otro.
 */
const ACTOR = '99999999-9999-4999-8999-999999999999';
const T1 = 'cccccccc-0000-4000-8000-000000000001'; // cocina en A (vinculado)
const T_ADMIN2 = 'cccccccc-0000-4000-8000-000000000003'; // otro administrador
const T_PENDING = 'cccccccc-0000-4000-8000-000000000004'; // sin vincular
const MISSING = 'cccccccc-0000-4000-8000-0000000000ff';
const F1 = 'f0000000-0000-4000-8000-000000000001';
const F2 = 'f0000000-0000-4000-8000-000000000002';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const url = (id: string) => `/v1/admin/staff/${id}/mfa-reset`;

function actorRow(roleCode: string, branchIds: string[]) {
  const permissions = (ROLE_PERMISSIONS[roleCode] as string[]).map((code) => ({
    permission: { code },
  }));
  const branches = roleCode === 'admin' ? [null] : branchIds;
  return {
    id: ACTOR,
    fullName: 'Marta Actora',
    active: true,
    assignments: branches.map((b) => ({
      active: true,
      branchId: b,
      branch: b ? { id: b, name: `Sucursal ${b[0]}`, code: `s-${b[0]}`, active: true } : null,
      role: { code: roleCode, permissions },
    })),
  };
}

async function createApp(
  keys: TestKeys,
  repo: FakeStaffRepo,
  prisma: unknown,
  authAdmin: FakeAuthAdmin | null,
) {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
    RATE_LIMIT_MAX: '1000',
  });
  delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
  vi.resetModules();
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
  const { StaffRepository } = await import('../src/staff/staff.repository.js');
  const { AUTH_ADMIN_PORT } = await import('../src/auth-admin/auth-admin.port.js');
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(StaffRepository)
    .useValue(repo)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks);
  // Sin override: el adaptador real por defecto («no disponible» porque no hay clave de servicio).
  if (authAdmin) builder = builder.overrideProvider(AUTH_ADMIN_PORT).useValue(authAdmin);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

describe('POST /v1/admin/staff/{id}/mfa-reset (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let repo: FakeStaffRepo;
  let authAdmin: FakeAuthAdmin;
  let prisma: ReturnType<typeof fakePrisma>;
  const http = () => request(app.getHttpServer());

  function fakePrisma() {
    const db = {
      customer: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      staffUser: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(),
      $disconnect: () => Promise.resolve(),
    };
    db.$transaction.mockImplementation((fn: (tx: typeof db) => Promise<unknown>) => fn(db));
    return db;
  }

  const as = async (
    roleCode: string,
    branchIds: string[] = [],
    claims: Record<string, unknown> = AAL2,
  ) => {
    prisma.staffUser.findUnique.mockResolvedValue(actorRow(roleCode, branchIds));
    return `Bearer ${await keys.sign(claims)}`;
  };

  const boot = async (withFake = true) => {
    repo = new FakeStaffRepo();
    authAdmin = new FakeAuthAdmin();
    repo.seed(
      staffRecord(ACTOR, [assignmentRecord('admin', null)], { email: 'marta@sushimon.test' }),
      staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)], { email: 'ana@sushimon.test' }),
      staffRecord(T_ADMIN2, [assignmentRecord('admin', null)]),
      staffRecord(T_PENDING, [assignmentRecord('kitchen', BRANCH_B)], {
        linked: false,
        linkedAt: null,
      }),
    );
    prisma = fakePrisma();
    repo.txExtras = { staffUser: prisma.staffUser };
    app = await createApp(keys, repo, prisma, withFake ? authAdmin : null);
  };

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    await boot();
  });
  afterEach(async () => {
    await app.close();
  });

  it('sin JWT / JWT ajeno => 401 y no toca el proveedor', async () => {
    await http().post(url(T1)).expect(401);
    await http()
      .post(url(T1))
      .set('Authorization', `Bearer ${await keys.signWithForeignKey(AAL2)}`)
      .expect(401);
    expect(authAdmin.calls).toEqual([]);
  });

  it('un cliente (no es personal) => 403 genérico', async () => {
    const res = await http()
      .post(url(T1))
      .set('Authorization', `Bearer ${await keys.sign(AAL2)}`)
      .expect(403);
    expect(res.body).toMatchObject({ message: 'Acceso denegado' });
    expect(authAdmin.calls).toEqual([]);
  });

  it('personal con permiso pero sesión aal1 => 403 MFA_REQUIRED y no toca el proveedor', async () => {
    const res = await http()
      .post(url(T1))
      .set('Authorization', await as('admin', [], {}))
      .expect(403);
    expect(res.body).toMatchObject({ message: 'MFA_REQUIRED' });
    expect(authAdmin.calls).toEqual([]);
    expect(repo.audit).toEqual([]);
  });

  it('empleado sin staff.update (cocina) => 403', async () => {
    await http()
      .post(url(T1))
      .set('Authorization', await as('kitchen', [BRANCH_A]))
      .expect(403);
    expect(authAdmin.calls).toEqual([]);
  });

  it('administrador de sucursal (encargado con staff.update acotado) => 403 y se audita la denegación', async () => {
    const res = await http()
      .post(url(T1))
      .set('Authorization', await as('manager', [BRANCH_A]))
      .expect(403);
    expect(res.body).toMatchObject({ message: 'Acceso denegado' });
    expect(authAdmin.calls).toEqual([]);
    expect(repo.audit).toMatchObject([
      { action: 'staff.denied_escalation', reason: 'mfa_reset_requires_global_scope' },
    ]);
  });

  it('a uno mismo => 403 y no toca el proveedor', async () => {
    const res = await http()
      .post(url(ACTOR))
      .set('Authorization', await as('admin'))
      .expect(403);
    expect(res.body).toMatchObject({ message: 'Acceso denegado' });
    expect(authAdmin.calls).toEqual([]);
    expect(repo.audit).toMatchObject([
      { action: 'staff.denied_escalation', reason: 'self_modification' },
    ]);
  });

  it('id no UUID => 400', async () => {
    await http()
      .post('/v1/admin/staff/no-uuid/mfa-reset')
      .set('Authorization', await as('admin'))
      .expect(400);
  });

  it('objetivo inexistente => 404 STAFF_NOT_FOUND; sin vincular => 409 STAFF_NOT_LINKED', async () => {
    const auth = await as('admin');
    const missing = await http().post(url(MISSING)).set('Authorization', auth).expect(404);
    expect(missing.body).toMatchObject({ code: 'STAFF_NOT_FOUND' });
    const pending = await http().post(url(T_PENDING)).set('Authorization', auth).expect(409);
    expect(pending.body).toMatchObject({ code: 'STAFF_NOT_LINKED' });
    expect(authAdmin.calls).toEqual([]);
    expect(repo.audit).toEqual([]);
  });

  it('éxito: 204 sin cuerpo, no-store, factores eliminados y auditoría sin PII', async () => {
    const authUserId = repo.authUserIdOf(T1) as string;
    authAdmin.seed(authUserId, F1, F2);
    const res = await http()
      .post(url(T1))
      .set('Authorization', await as('admin'))
      .expect(204);
    expect(res.text).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(authAdmin.factors.get(authUserId)).toEqual([]);
    expect(repo.audit).toHaveLength(1);
    expect(repo.audit[0]).toMatchObject({
      actorId: ACTOR,
      entityId: T1,
      action: 'staff.mfa_reset',
      newValues: { factorsRemoved: 2 },
    });
    const dump = JSON.stringify(repo.audit);
    for (const pii of ['ana@sushimon.test', 'marta@sushimon.test', 'Marta', authUserId, F1]) {
      expect(dump).not.toContain(pii);
    }
  });

  it('un administrador global puede reiniciar a otro administrador; idempotente sin factores => 204', async () => {
    const auth = await as('admin');
    await http().post(url(T_ADMIN2)).set('Authorization', auth).expect(204);
    await http().post(url(T_ADMIN2)).set('Authorization', auth).expect(204);
    expect(repo.audit.map((e) => e.action)).toEqual(['staff.mfa_reset', 'staff.mfa_reset']);
  });

  it('fallo del proveedor => 502 MFA_RESET_FAILED sin detalle y se audita mfa_reset_failed', async () => {
    const { AuthAdminProviderError } = await import('../src/auth-admin/auth-admin.port.js');
    authAdmin.failList = new AuthAdminProviderError('http_status', 500);
    const res = await http()
      .post(url(T1))
      .set('Authorization', await as('admin'))
      .expect(502);
    expect(res.body).toMatchObject({ code: 'MFA_RESET_FAILED', statusCode: 502 });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toMatch(/500|http_status|supabase/i);
    expect(repo.audit).toMatchObject([
      { action: 'staff.mfa_reset_failed', reason: 'http_status_500' },
    ]);
  });

  it('puerto «no disponible» (sin clave de servicio) => 503 MFA_RESET_UNAVAILABLE con mensaje fijo', async () => {
    authAdmin.unavailable = true;
    const res = await http()
      .post(url(T1))
      .set('Authorization', await as('admin'))
      .expect(503);
    expect(res.body).toMatchObject({
      code: 'MFA_RESET_UNAVAILABLE',
      message: 'El reinicio de MFA no está disponible en este entorno',
    });
  });

  it('configuración real sin SUPABASE_SERVICE_ROLE_KEY: el adaptador por defecto responde 503 sin red', async () => {
    await app.close();
    await boot(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await http()
      .post(url(T1))
      .set('Authorization', await as('admin'))
      .expect(503);
    expect(res.body).toMatchObject({ code: 'MFA_RESET_UNAVAILABLE' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('throttle por ruta: la 6.ª solicitud en un minuto => 429 RATE_LIMITED', async () => {
    const auth = await as('admin');
    for (let i = 0; i < 5; i++) {
      await http().post(url(T1)).set('Authorization', auth).expect(204);
    }
    const res = await http().post(url(T1)).set('Authorization', auth).expect(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});
