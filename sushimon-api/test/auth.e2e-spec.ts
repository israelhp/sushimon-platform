import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestKeys, USER_ID, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const BRANCH = '11111111-1111-4111-8111-111111111111';

/** Rutas de prueba SOLO para verificar el guard de autorización (no existen en la API real). */
async function createApp(keys: TestKeys, db: ReturnType<typeof fakeDb>) {
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
  const { RequireStaff } = await import('../src/auth/staff.guard.js');

  @Controller('probe')
  class ProbeController {
    @Get('staff') @RequireStaff() staff() {
      return { ok: true };
    }
    @Get('users') @RequireStaff('users') users() {
      return { ok: true };
    }
  }
  @Module({ controllers: [ProbeController] })
  class ProbeModule {}

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProbeModule] })
    .overrideProvider(PrismaService)
    .useValue(Object.assign(db, { $disconnect: () => Promise.resolve() }))
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

function staffRow(
  over: { active?: boolean; permissions?: string[]; branchId?: string | null } = {},
) {
  return {
    id: STAFF_ID,
    fullName: 'Ana Admin',
    active: over.active ?? true,
    assignments: [
      {
        branchId: over.branchId ?? null,
        role: {
          code: 'manager',
          permissions: (over.permissions ?? ['dashboard']).map((code) => ({
            permission: { code },
          })),
        },
      },
    ],
  };
}

function fakeDb() {
  return {
    customer: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'c-1',
          phone: null,
          createdAt: new Date('2026-11-12T10:00:00Z'),
          ...data,
        }),
      ),
      findUniqueOrThrow: vi.fn(),
    },
    staffUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('Autenticación y autorización (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  const http = () => request(app.getHttpServer());
  const bearer = async (claims?: Parameters<TestKeys['sign']>[0]) =>
    `Bearer ${await keys.sign(claims)}`;

  beforeAll(async () => {
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    db = fakeDb();
    app = await createApp(keys, db);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('token inválido se rechaza (401 uniforme)', () => {
    it.each(['/v1/auth/context', '/v1/me'])('%s sin token', async (path) => {
      const res = await http().get(path).expect(401);
      expect(res.body).toMatchObject({
        statusCode: 401,
        error: 'UNAUTHORIZED',
        message: 'No autenticado',
      });
      expect((res.body as { requestId?: string }).requestId).toBeTruthy();
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it('expirado, firma ajena, emisor y audiencia incorrectos devuelven el mismo 401', async () => {
      const tokens = [
        await keys.sign({}, { expiresIn: Math.floor(Date.now() / 1000) - 120 }),
        await keys.signWithForeignKey(),
        await keys.sign({}, { issuer: 'https://otro.example/auth/v1' }),
        await keys.sign({}, { audience: 'otra' }),
        await keys.sign({ role: 'anon' }),
        'esto.no.escrito',
      ];
      for (const t of tokens) {
        const res = await http().get('/v1/me').set('Authorization', `Bearer ${t}`).expect(401);
        expect((res.body as { message: string }).message).toBe('No autenticado');
      }
      expect(db.customer.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/me (cliente autenticado entra a su cuenta)', () => {
    it('crea el perfil de cliente en el primer acceso a partir del token', async () => {
      const res = await http()
        .get('/v1/me')
        .set('Authorization', await bearer())
        .expect(200);
      expect(res.body).toEqual({
        authUserId: USER_ID,
        email: 'cliente@example.com',
        customer: {
          id: 'c-1',
          fullName: 'Cliente Prueba',
          email: 'cliente@example.com',
          phone: null,
          createdAt: '2026-11-12T10:00:00.000Z',
        },
        isStaff: false,
      });
      expect(db.customer.create).toHaveBeenCalledWith({
        data: { authUserId: USER_ID, fullName: 'Cliente Prueba', email: 'cliente@example.com' },
      });
    });

    it('reutiliza el perfil existente', async () => {
      db.customer.findUnique.mockResolvedValue({
        id: 'c-9',
        fullName: 'Existente',
        email: null,
        phone: '5555-0000',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      const res = await http()
        .get('/v1/me')
        .set('Authorization', await bearer())
        .expect(200);
      expect((res.body as { customer: { id: string } }).customer.id).toBe('c-9');
      expect(db.customer.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/auth/context (autenticación ≠ autorización)', () => {
    it('cliente autenticado sin rol interno: backofficeAccess=false', async () => {
      db.customer.count.mockResolvedValue(1);
      const res = await http()
        .get('/v1/auth/context')
        .set('Authorization', await bearer())
        .expect(200);
      expect(res.body).toEqual({
        authUserId: USER_ID,
        email: 'cliente@example.com',
        provider: 'google',
        isCustomer: true,
        staff: null,
        backofficeAccess: false,
      });
    });

    it('empleado activo: roles, permisos y alcance salen de la base de datos', async () => {
      db.staffUser.findUnique.mockResolvedValue(
        staffRow({ permissions: ['dashboard', 'reports'], branchId: BRANCH }),
      );
      const res = await http()
        .get('/v1/auth/context')
        .set('Authorization', await bearer())
        .expect(200);
      expect(res.body).toMatchObject({
        backofficeAccess: true,
        staff: {
          staffId: STAFF_ID,
          assignments: [{ role: 'manager', branchId: BRANCH }],
          permissions: ['dashboard', 'reports'],
          allBranches: false,
          branchIds: [BRANCH],
        },
      });
    });

    it('un token que AFIRMA ser admin no concede nada: la autoridad es la base de datos', async () => {
      const res = await http()
        .get('/v1/auth/context')
        .set(
          'Authorization',
          await bearer({
            app_metadata: { provider: 'google', role: 'admin' },
            user_metadata: { role: 'admin' },
          }),
        )
        .expect(200);
      expect(res.body).toMatchObject({ staff: null, backofficeAccess: false });
    });

    it('primer acceso del empleado preregistrado: vincula por correo verificado con Google', async () => {
      db.staffUser.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(staffRow());
      db.staffUser.updateMany.mockResolvedValue({ count: 1 });
      const res = await http()
        .get('/v1/auth/context')
        .set('Authorization', await bearer())
        .expect(200);
      expect(res.body).toMatchObject({ backofficeAccess: true });
      expect(db.staffUser.updateMany).toHaveBeenCalledWith({
        where: { email: 'cliente@example.com', authUserId: null, active: true },
        data: { authUserId: USER_ID },
      });
    });

    it('NO vincula si la sesión no viene de OAuth con Google', async () => {
      const res = await http()
        .get('/v1/auth/context')
        .set('Authorization', await bearer({ amr: [{ method: 'password' }] }))
        .expect(200);
      expect(res.body).toMatchObject({ backofficeAccess: false });
      expect(db.staffUser.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('usuario sin autorización administrativa no accede al backoffice (403)', () => {
    it('cliente sin fila de personal → 403', async () => {
      const res = await http()
        .get('/v1/probe/staff')
        .set('Authorization', await bearer())
        .expect(403);
      expect(res.body).toMatchObject({
        statusCode: 403,
        error: 'FORBIDDEN',
        message: 'Acceso denegado',
      });
    });

    it('empleado inactivo → 403', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow({ active: false }));
      await http()
        .get('/v1/probe/staff')
        .set('Authorization', await bearer())
        .expect(403);
    });

    it('empleado activo sin el permiso requerido → 403; con el permiso → 200', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['dashboard'] }));
      await http()
        .get('/v1/probe/users')
        .set('Authorization', await bearer())
        .expect(403);
      await http()
        .get('/v1/probe/staff')
        .set('Authorization', await bearer())
        .expect(200);
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['users'] }));
      await http()
        .get('/v1/probe/users')
        .set('Authorization', await bearer())
        .expect(200);
    });

    it('sin token, la ruta de personal responde 401 (no 403)', async () => {
      await http().get('/v1/probe/staff').expect(401);
    });
  });

  it('las rutas de salud siguen públicas', async () => {
    await http().get('/v1/health').expect(200);
  });
});
