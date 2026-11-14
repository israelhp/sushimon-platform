import { Controller, ForbiddenException, Get, Inject, Module, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestKeys, USER_ID, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const BRANCH = '11111111-1111-4111-8111-111111111111';
const OTHER_BRANCH = '22222222-2222-4222-8222-222222222222';
/** Claims de una sesión que completó el segundo factor TOTP (lo que emite Supabase Auth tras `mfa.verify`). */
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};

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
  const { AuthorizationService } = await import('../src/auth/authorization.service.js');

  @Controller('probe')
  class ProbeController {
    constructor(
      @Inject(AuthorizationService)
      private readonly authz: InstanceType<typeof AuthorizationService>,
    ) {}
    @Get('staff') @RequireStaff() staff() {
      return { ok: true };
    }
    @Get('users') @RequireStaff('staff.read') users() {
      return { ok: true };
    }
    /** Alcance por sucursal: la ruta decide por recurso con `canAccess(permiso)` sobre el contexto del guard. */
    @Get('branch/:id') @RequireStaff('orders.read') branch(
      @Param('id') id: string,
      @Req() req: Request,
    ) {
      if (!req.staff || !this.authz.canAccess(req.staff, 'orders.read', id))
        throw new ForbiddenException('Acceso denegado');
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
  over: {
    active?: boolean;
    permissions?: string[];
    branchId?: string | null;
    branchActive?: boolean;
  } = {},
) {
  const branchId = over.branchId ?? null;
  return {
    id: STAFF_ID,
    fullName: 'Ana Admin',
    active: over.active ?? true,
    assignments: [
      {
        active: true,
        branchId,
        branch: branchId
          ? { id: branchId, name: 'Zona 10', code: 'zona-10', active: over.branchActive ?? true }
          : null,
        role: {
          code: 'manager',
          permissions: (over.permissions ?? ['dashboard.read']).map((code) => ({
            permission: { code },
          })),
        },
      },
    ],
  };
}

function fakeDb() {
  const db = {
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
      create: vi.fn(),
    },
    branch: {
      findMany: vi.fn().mockResolvedValue([{ id: BRANCH, name: 'Zona 10', code: 'zona-10' }]),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  return db;
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
        aal: 'aal1',
        staffAuthorized: false,
        mfaRequired: false,
        access: 'NOT_STAFF',
        staff: null,
        backofficeAccess: false,
      });
    });

    it('empleado activo: roles, permisos y alcance salen de la base de datos', async () => {
      db.staffUser.findUnique.mockResolvedValue(
        staffRow({ permissions: ['dashboard.read', 'reports.read'], branchId: BRANCH }),
      );
      const res = await http()
        .get('/v1/auth/context')
        .set('Authorization', await bearer(AAL2))
        .expect(200);
      expect(res.body).toMatchObject({
        backofficeAccess: true,
        access: 'GRANTED',
        aal: 'aal2',
        staff: {
          staffId: STAFF_ID,
          assignments: [{ role: 'manager', branchId: BRANCH }],
          permissions: ['dashboard.read', 'reports.read'],
          allBranches: false,
          branchIds: [BRANCH],
          grants: {
            'dashboard.read': { allBranches: false, branchIds: [BRANCH] },
            'reports.read': { allBranches: false, branchIds: [BRANCH] },
          },
          branches: [{ id: BRANCH, name: 'Zona 10', code: 'zona-10' }],
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
      db.staffUser.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: STAFF_ID })
        .mockResolvedValueOnce(staffRow());
      db.staffUser.updateMany.mockResolvedValue({ count: 1 });
      const res = await http()
        .get('/v1/auth/context')
        .set('Authorization', await bearer())
        .expect(200);
      // Aunque se vincule, en aal1 todavía no hay acceso: debe completar MFA.
      expect(res.body).toMatchObject({ backofficeAccess: false, access: 'MFA_REQUIRED' });
      expect(db.staffUser.updateMany).toHaveBeenCalledWith({
        where: { email: 'cliente@example.com', authUserId: null, active: true },
        data: { authUserId: USER_ID, linkedAt: expect.any(Date) as unknown },
      });
    });

    it('empleado activo en aal1: MFA_REQUIRED, sin permisos ni sucursales en la respuesta', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['dashboard.read'] }));
      const res = await http()
        .get('/v1/auth/context')
        .set('Authorization', await bearer())
        .expect(200);
      expect(res.body).toMatchObject({
        staffAuthorized: true,
        mfaRequired: true,
        access: 'MFA_REQUIRED',
        backofficeAccess: false,
        staff: null,
      });
      expect(JSON.stringify(res.body)).not.toContain('dashboard');
      expect(JSON.stringify(res.body)).not.toContain('grants');
    });

    it('un token aal1 con aal2 solo en user_metadata/cabeceras/query sigue en aal1', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow());
      const res = await http()
        .get('/v1/auth/context?aal=aal2')
        .set('x-aal', 'aal2')
        .set('Authorization', await bearer({ user_metadata: { aal: 'aal2' } }))
        .expect(200);
      expect(res.body).toMatchObject({ access: 'MFA_REQUIRED', aal: 'aal1' });
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

  describe('vinculación de identidad (preautorización por correo)', () => {
    it.each([
      ['correo marcado como no verificado', { user_metadata: { email_verified: false } }],
      ['sin el claim email_verified (default-deny)', { user_metadata: { full_name: 'X' } }],
      [
        'proveedor distinto de Google',
        { app_metadata: { provider: 'email', providers: ['email'] } },
      ],
    ])('NO vincula: %s', async (_n, claims) => {
      db.staffUser.findUnique.mockResolvedValue(null);
      const res = await http()
        .get('/v1/auth/context')
        .set('Authorization', await bearer(claims))
        .expect(200);
      expect(res.body).toMatchObject({ staffAuthorized: false, backofficeAccess: false });
      expect(db.staffUser.updateMany).not.toHaveBeenCalled();
      expect(db.auditEvent.create).not.toHaveBeenCalled();
    });

    it('un cliente con perfil NO se vuelve empleado: sin preautorización no se crea ni vincula personal', async () => {
      db.customer.count.mockResolvedValue(1);
      db.customer.findUnique.mockResolvedValue({
        id: 'c-9',
        fullName: 'Cliente',
        email: 'cliente@example.com',
        phone: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      db.staffUser.findUnique.mockResolvedValue(null);
      db.staffUser.updateMany.mockResolvedValue({ count: 0 }); // no existe fila preautorizada
      await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await bearer(AAL2))
        .expect(403);
      const me = await http()
        .get('/v1/me')
        .set('Authorization', await bearer(AAL2))
        .expect(200);
      expect(me.body).toMatchObject({ isStaff: false });
      expect(db.staffUser.create).not.toHaveBeenCalled();
      expect(db.auditEvent.create).not.toHaveBeenCalled();
    });

    it('dos identidades con el mismo correo: solo una se vincula (UPDATE atómico)', async () => {
      const OTHER_USER = '8a9b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
      // Fila preautorizada compartida: el UPDATE condicionado a `auth_user_id IS NULL` solo lo cumple el primero.
      const row = { id: STAFF_ID, authUserId: null as string | null, email: 'cliente@example.com' };
      db.staffUser.updateMany.mockImplementation(
        (a: { where: { authUserId: null }; data: { authUserId: string } }) => {
          if (row.authUserId === null) {
            row.authUserId = a.data.authUserId;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        },
      );
      db.staffUser.findUnique.mockImplementation(
        (a: { where: { authUserId: string }; select: object }) => {
          if (row.authUserId !== a.where.authUserId) return Promise.resolve(null);
          return Promise.resolve({ ...staffRow(), id: row.id });
        },
      );
      const [first, second] = await Promise.all([
        http()
          .get('/v1/auth/context')
          .set('Authorization', await bearer(AAL2)),
        http()
          .get('/v1/auth/context')
          .set('Authorization', await bearer({ ...AAL2, sub: OTHER_USER })),
      ]);
      const granted = [first, second].filter(
        (r) => (r.body as { backofficeAccess: boolean }).backofficeAccess,
      );
      expect(granted).toHaveLength(1);
      expect(row.authUserId).not.toBeNull();
      expect(db.auditEvent.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('sin caché de autorización entre solicitudes', () => {
    it('desactivar al empleado corta el acceso en la SIGUIENTE solicitud con el mismo JWT', async () => {
      const token = await bearer(AAL2);
      db.staffUser.findUnique.mockResolvedValue(staffRow());
      await http().get('/v1/probe/staff').set('Authorization', token).expect(200);
      db.staffUser.findUnique.mockResolvedValue(staffRow({ active: false }));
      await http().get('/v1/probe/staff').set('Authorization', token).expect(403);
    });

    it('revocar un permiso rige de inmediato; una sucursal desactivada no concede acceso', async () => {
      const token = await bearer(AAL2);
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['staff.read'] }));
      await http().get('/v1/probe/users').set('Authorization', token).expect(200);
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['dashboard.read'] }));
      await http().get('/v1/probe/users').set('Authorization', token).expect(403);
      db.staffUser.findUnique.mockResolvedValue(
        staffRow({ branchId: BRANCH, branchActive: false, permissions: ['staff.read'] }),
      );
      await http().get('/v1/probe/users').set('Authorization', token).expect(403);
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

    it('empleado inactivo → 403 aunque la sesión sea aal2', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow({ active: false }));
      await http()
        .get('/v1/probe/staff')
        .set('Authorization', await bearer(AAL2))
        .expect(403);
    });

    it('cliente con MFA aal2 pero sin fila de personal → 403 genérico', async () => {
      const res = await http()
        .get('/v1/probe/staff')
        .set('Authorization', await bearer(AAL2))
        .expect(403);
      expect((res.body as { message: string }).message).toBe('Acceso denegado');
    });

    it('empleado activo sin el permiso requerido → 403; con el permiso → 200', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['dashboard.read'] }));
      await http()
        .get('/v1/probe/users')
        .set('Authorization', await bearer(AAL2))
        .expect(403);
      await http()
        .get('/v1/probe/staff')
        .set('Authorization', await bearer(AAL2))
        .expect(200);
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['staff.read'] }));
      await http()
        .get('/v1/probe/users')
        .set('Authorization', await bearer(AAL2))
        .expect(200);
    });

    it('empleado de otra sucursal → 403; de la suya → 200', async () => {
      db.staffUser.findUnique.mockResolvedValue(
        staffRow({ branchId: BRANCH, permissions: ['orders.read'] }),
      );
      await http()
        .get(`/v1/probe/branch/${OTHER_BRANCH}`)
        .set('Authorization', await bearer(AAL2))
        .expect(403);
      await http()
        .get(`/v1/probe/branch/${BRANCH}`)
        .set('Authorization', await bearer(AAL2))
        .expect(200);
    });

    it('sin token, la ruta de personal responde 401 (no 403)', async () => {
      await http().get('/v1/probe/staff').expect(401);
    });
  });

  describe('MFA aal2 obligatorio en el backoffice', () => {
    it('empleado activo con permisos en aal1 → 403 MFA_REQUIRED', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['staff.read'] }));
      const res = await http()
        .get('/v1/probe/users')
        .set('Authorization', await bearer())
        .expect(403);
      expect((res.body as { message: string }).message).toBe('MFA_REQUIRED');
    });

    it('el cliente en aal1 NO recibe MFA_REQUIRED (no se revela qué correos son personal)', async () => {
      const res = await http()
        .get('/v1/probe/staff')
        .set('Authorization', await bearer())
        .expect(403);
      expect((res.body as { message: string }).message).toBe('Acceso denegado');
    });

    it.each([
      ['aal2 sin TOTP en amr', { aal: 'aal2' }],
      ['claim aal2 con tipo inválido', { aal: ['aal2'], amr: AAL2.amr }],
      ['TOTP en amr pero claim aal1', { aal: 'aal1', amr: AAL2.amr }],
    ])('claim MFA falsificado o inválido (%s) → 403', async (_n, claims) => {
      db.staffUser.findUnique.mockResolvedValue(staffRow());
      await http()
        .get('/v1/probe/staff')
        .set('Authorization', await bearer(claims))
        .expect(403);
    });

    it('un token aal2 con firma ajena no sirve (401)', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow());
      const token = await keys.signWithForeignKey(AAL2);
      await http().get('/v1/probe/staff').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('un token aal2 expirado no sirve (401): reutilizar un token antiguo no eleva nada', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow());
      const token = await keys.sign(AAL2, { expiresIn: Math.floor(Date.now() / 1000) - 120 });
      await http().get('/v1/probe/staff').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('no repite la consulta de personal dentro de una solicitud', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow());
      await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await bearer(AAL2))
        .expect(200);
      expect(db.staffUser.findUnique).toHaveBeenCalledTimes(1);
    });

    it('GET /v1/admin/me/context: aal2 → perfil, roles, permisos y sucursales del servidor', async () => {
      db.staffUser.findUnique.mockResolvedValue(
        staffRow({ permissions: ['dashboard.read', 'orders.read'], branchId: BRANCH }),
      );
      const res = await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await bearer(AAL2))
        .expect(200);
      expect(res.body).toEqual({
        authUserId: USER_ID,
        email: 'cliente@example.com',
        aal: 'aal2',
        staff: {
          staffId: STAFF_ID,
          fullName: 'Ana Admin',
          assignments: [{ role: 'manager', branchId: BRANCH }],
          permissions: ['dashboard.read', 'orders.read'],
          allBranches: false,
          branchIds: [BRANCH],
          grants: {
            'dashboard.read': { allBranches: false, branchIds: [BRANCH] },
            'orders.read': { allBranches: false, branchIds: [BRANCH] },
          },
          branches: [{ id: BRANCH, name: 'Zona 10', code: 'zona-10' }],
        },
      });
    });

    it('GET /v1/admin/me/context: con alcance global, branches = todas las sucursales activas', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['dashboard.read'] }));
      const res = await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await bearer(AAL2))
        .expect(200);
      expect(res.body).toMatchObject({
        staff: {
          allBranches: true,
          grants: { 'dashboard.read': { allBranches: true, branchIds: [] } },
          branches: [{ id: BRANCH, name: 'Zona 10', code: 'zona-10' }],
        },
      });
    });

    it('GET /v1/admin/me/context: aal1 → 403, sin token → 401, desactivado en aal2 → 403', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow());
      await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await bearer())
        .expect(403);
      await http().get('/v1/admin/me/context').expect(401);
      db.staffUser.findUnique.mockResolvedValue(staffRow({ active: false }));
      await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await bearer(AAL2))
        .expect(403);
    });

    it('el cliente (aal1 o aal2) no obtiene contexto administrativo', async () => {
      await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await bearer())
        .expect(403);
      await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await bearer(AAL2))
        .expect(403);
    });

    it('los errores no filtran el correo ni los permisos del personal', async () => {
      db.staffUser.findUnique.mockResolvedValue(staffRow({ permissions: ['secret-permission'] }));
      const res = await http()
        .get('/v1/probe/users')
        .set('Authorization', await bearer())
        .expect(403);
      expect(JSON.stringify(res.body)).not.toContain('secret-permission');
    });

    it('las rutas públicas y /v1/me no exigen MFA', async () => {
      await http().get('/v1/health').expect(200);
      await http()
        .get('/v1/me')
        .set('Authorization', await bearer())
        .expect(200);
    });
  });

  it('CORS: el preflight con Authorization se permite solo al origen configurado', async () => {
    const ok = await http()
      .options('/v1/me')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization')
      .expect(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-headers']?.toLowerCase()).toContain('authorization');
    const denied = await http()
      .options('/v1/me')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('las rutas de salud siguen públicas', async () => {
    await http().get('/v1/health').expect(200);
  });
});
