import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createTestKeys, USER_ID, type TestKeys } from './support/tokens.js';

/**
 * F04 · HTTP real de `PATCH /v1/me` y `GET /v1/me/storefront` con Prisma simulado (sin PostgreSQL).
 * Cubre autenticación, validación, campos prohibidos y que el sujeto sea siempre el del JWT.
 */
/** Forma mínima del cuerpo de respuesta que se verifica. */
type Body = {
  authUserId?: string;
  avatarUrl?: string | null;
  customer: { fullName: string; phone: string | null };
};

const OTHER_USER = '8c1e2d3f-4a5b-4c6d-8e7f-901234567890';

function fakeDb() {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c-1',
    authUserId: USER_ID,
    fullName: 'Cliente Prueba',
    email: 'cliente@example.com',
    phone: null,
    createdAt: new Date('2026-11-12T10:00:00Z'),
    ...over,
  });
  const store = new Map<string, ReturnType<typeof row>>([[USER_ID, row()]]);
  return {
    store,
    customer: {
      count: vi.fn(({ where }: { where: { authUserId: string } }) =>
        Promise.resolve(store.has(where.authUserId) ? 1 : 0),
      ),
      findUnique: vi.fn(({ where }: { where: { authUserId: string } }) =>
        Promise.resolve(store.get(where.authUserId) ?? null),
      ),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const created = row({ id: `c-${store.size + 1}`, ...data, phone: null });
        store.set(data['authUserId'] as string, created);
        return Promise.resolve(created);
      }),
      update: vi.fn(
        ({ where, data }: { where: { authUserId: string }; data: Record<string, unknown> }) => {
          const current = store.get(where.authUserId);
          if (!current) {
            return Promise.reject(Object.assign(new Error('No record'), { code: 'P2025' }));
          }
          const next = { ...current, ...data };
          store.set(where.authUserId, next);
          return Promise.resolve(next);
        },
      ),
      findUniqueOrThrow: vi.fn(),
    },
    staffUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(),
    },
    branch: { findMany: vi.fn().mockResolvedValue([]) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
    $disconnect: () => Promise.resolve(),
  };
}

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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

describe('F04 · perfil de cliente (e2e)', () => {
  let keys: TestKeys;
  let db: ReturnType<typeof fakeDb>;
  let app: NestExpressApplication;

  beforeAll(async () => {
    keys = await createTestKeys();
    db = fakeDb();
    app = await createApp(keys, db);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = async (claims = {}) => `Bearer ${await keys.sign(claims)}`;

  describe('autenticación', () => {
    it('PATCH /v1/me sin token → 401', async () => {
      await http().patch('/v1/me').send({ phone: '5555-9999' }).expect(401);
    });

    it('GET /v1/me/storefront sin token → 401', async () => {
      await http().get('/v1/me/storefront').expect(401);
    });

    it('JWT firmado con otra clave → 401', async () => {
      const forged = await keys.signWithForeignKey();
      await http()
        .patch('/v1/me')
        .set('Authorization', `Bearer ${forged}`)
        .send({ phone: '5555-9999' })
        .expect(401);
    });

    it('JWT expirado → 401', async () => {
      const expired = await keys.sign({}, { expiresIn: -60 });
      await http()
        .patch('/v1/me')
        .set('Authorization', `Bearer ${expired}`)
        .send({ phone: '5555-9999' })
        .expect(401);
    });
  });

  describe('PATCH /v1/me', () => {
    it('actualiza nombre y teléfono normalizados', async () => {
      const res = await http()
        .patch('/v1/me')
        .set('Authorization', await bearer())
        .send({ fullName: '  Ana   López ', phone: '5555-9999' })
        .expect(200);
      expect(res.body).toMatchObject({
        authUserId: USER_ID,
        email: 'cliente@example.com',
        customer: { fullName: 'Ana López', phone: '+50255559999' },
        isStaff: false,
      });
    });

    it('un PATCH parcial conserva los campos omitidos', async () => {
      const res = await http()
        .patch('/v1/me')
        .set('Authorization', await bearer())
        .send({ phone: null })
        .expect(200);
      expect((res.body as Body).customer.fullName).toBe('Ana López');
      expect((res.body as Body).customer.phone).toBeNull();
    });

    it.each([
      ['correo', { email: 'otro@example.com' }],
      ['identidad', { authUserId: OTHER_USER }],
      ['customerId', { customerId: 'c-99' }],
      ['rol', { role: 'admin' }],
      ['permisos', { permissions: ['users'] }],
      ['aal', { aal: 'aal2' }],
      ['createdAt', { createdAt: '2000-01-01T00:00:00Z' }],
      ['defaultAddressId (F05)', { defaultAddressId: null }],
    ])('rechaza el campo prohibido: %s → 400', async (_name, body) => {
      await http()
        .patch('/v1/me')
        .set('Authorization', await bearer())
        .send(body)
        .expect(400);
    });

    it('rechaza nombre vacío o null → 400', async () => {
      await http()
        .patch('/v1/me')
        .set('Authorization', await bearer())
        .send({ fullName: '  ' })
        .expect(400);
      await http()
        .patch('/v1/me')
        .set('Authorization', await bearer())
        .send({ fullName: null })
        .expect(400);
    });

    it('rechaza teléfono inválido → 400', async () => {
      await http()
        .patch('/v1/me')
        .set('Authorization', await bearer())
        .send({ phone: '12' })
        .expect(400);
    });

    it('nunca modifica la fila de otro usuario (el sujeto sale del JWT)', async () => {
      const otherClaims = { sub: OTHER_USER, email: 'otro@example.com' };
      await http()
        .patch('/v1/me')
        .set('Authorization', await bearer(otherClaims))
        .send({ fullName: 'Otra Persona' })
        .expect(200);
      expect(db.store.get(USER_ID)?.fullName).toBe('Ana López');
      expect(db.store.get(OTHER_USER)?.fullName).toBe('Otra Persona');
    });
  });

  describe('GET /v1/me/storefront', () => {
    it('devuelve identidad, perfil y secciones pendientes (sin contadores)', async () => {
      const res = await http()
        .get('/v1/me/storefront')
        .set('Authorization', await bearer({ sub: USER_ID }))
        .expect(200);
      expect(res.body).toMatchObject({
        authUserId: USER_ID,
        email: 'cliente@example.com',
        isStaff: false,
        pendingSections: ['favorites', 'orders'],
        customer: { fullName: 'Ana López' },
      });
      expect(res.body).not.toHaveProperty('addresses');
      expect(res.body).not.toHaveProperty('favorites');
      expect(res.body).not.toHaveProperty('orders');
    });

    it('no devuelve un avatar que no sea de Google', async () => {
      const res = await http()
        .get('/v1/me/storefront')
        .set(
          'Authorization',
          await bearer({
            sub: USER_ID,
            user_metadata: { avatar_url: 'https://evil.example/x.png' },
          }),
        )
        .expect(200);
      expect((res.body as Body).avatarUrl).toBeNull();
    });
  });

  it('datos personales nunca se cachean (no-store)', async () => {
    const res = await http()
      .get('/v1/me')
      .set('Authorization', await bearer())
      .expect(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('GET /v1/me sigue funcionando (F01 sin cambios)', async () => {
    const res = await http()
      .get('/v1/me')
      .set('Authorization', await bearer())
      .expect(200);
    expect((res.body as Body).authUserId).toBe(USER_ID);
  });
});
