import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { bid, FakeBranchProductsRepo } from './support/fake-branch-products-repo.js';
import { FakePromotionsRepo } from './support/fake-promotions-repo.js';
import { CAT, seedCategories } from './support/products-harness.js';
import {
  A,
  B,
  C,
  INACTIVE,
  local,
  MutableClock,
  NOW,
  P1,
  P2,
  P3,
  promotionsHarness,
} from './support/promotions-harness.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const ALL_PERMS = ['promotions.read', 'promotions.create', 'promotions.update'];
const MISSING = '00000000-0000-4000-8000-0000000000ff';

function fakeDb(categories: ReturnType<typeof seedCategories>) {
  const db = {
    category: { findMany: vi.fn(() => Promise.resolve(categories.map((c) => ({ ...c })))) },
    customer: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
    staffUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: unknown) => unknown)(db)
        : Promise.all(arg as unknown[]),
    ),
    $disconnect: () => Promise.resolve(),
  };
  return db;
}

interface Assignment {
  branchId: string | null;
  permissions: string[];
}

function staffRow(assignments: Assignment[]) {
  return {
    id: STAFF_ID,
    fullName: 'Ana Admin',
    active: true,
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

type Body = Record<string, unknown>;
interface Json {
  code?: string;
  total?: number;
  items?: Body[];
  violations?: { path: string; code: string }[];
  [k: string]: unknown;
}
const json = (res: request.Response) => res.body as Json;

const validCreate = (over: Body = {}): Body => ({
  name: 'Happy Hour',
  kind: 'PERCENT',
  value: '15.00',
  startsAt: '2026-01-01T00:00:00-06:00',
  endsAt: '2027-01-01T00:00:00-06:00',
  branchScope: 'ALL',
  productScope: 'ALL',
  ...over,
});

describe('Promociones, cupones y Happy Hour (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  let world: FakeBranchProductsRepo;
  let repo: FakePromotionsRepo;
  let clock: MutableClock;
  let logged: string[];
  const http = () => request(app.getHttpServer());
  const bearer = async (claims?: Parameters<TestKeys['sign']>[0]) =>
    `Bearer ${await keys.sign(claims)}`;
  const asStaff = async (assignments: Assignment[], claims: Record<string, unknown> = AAL2) => {
    db.staffUser.findUnique.mockResolvedValue(staffRow(assignments));
    return bearer(claims);
  };
  const admin = () => asStaff([{ branchId: null, permissions: ALL_PERMS }]);

  async function createApp() {
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
    const { BranchProductsRepository } =
      await import('../src/branch-products/branch-products.repository.js');
    const { PromotionsRepository } = await import('../src/promotions/promotions.repository.js');
    const { CLOCK } = await import('../src/branch-schedule/clock.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(JWKS_RESOLVER)
      .useValue(keys.jwks)
      .overrideProvider(BranchProductsRepository)
      .useValue(world)
      .overrideProvider(PromotionsRepository)
      .useValue(repo)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    const instance = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(instance, { corsOrigins: ['http://localhost:3000'] });
    await instance.init();
    return instance;
  }

  beforeAll(async () => {
    keys = await createTestKeys();
  });

  beforeEach(async () => {
    logged = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    db = fakeDb(seedCategories());
    const h = promotionsHarness([CAT.frios]);
    world = h.world;
    repo = h.repo;
    clock = h.clock;
    clock.current = NOW;
    app = await createApp();
  });
  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/store/promotions (público)', () => {
    const happy = () =>
      repo.seed({
        name: 'Happy Hour',
        value: '20.00',
        productIds: [P1, P2],
        schedule: [{ weekday: 1, startsAt: '15:00', endsAt: '18:00' }],
      });

    it('sin JWT: Happy Hour vigente con items indicativos; sin code ni descuento de cupones', async () => {
      world.seedRow(A, P1, { priceOverride: '70.00' });
      const hh = happy();
      repo.seed({ code: 'SECRETO10', value: '90.00', name: 'Cupón' });
      const res = await http().get(`/v1/store/promotions?branchId=${A}`).expect(200);
      const items = json(res).items as Json[];
      const out = items.find((i) => i['id'] === hh.id)!;
      expect(out).toMatchObject({ isHappyHour: true, requiresCode: false, kind: 'PERCENT' });
      expect(out['items']).toEqual([
        { productId: P2, regularPrice: '30.00', promoPrice: '24.00' },
        { productId: P1, regularPrice: '70.00', promoPrice: '56.00' },
      ]);
      const coupon = items.find((i) => i['name'] === 'Cupón')!;
      expect(coupon['requiresCode']).toBe(true);
      expect(coupon).not.toHaveProperty('kind');
      expect(coupon).not.toHaveProperty('value');
      expect(JSON.stringify(res.body)).not.toContain('SECRETO10');
      expect(JSON.stringify(res.body)).not.toContain('90.00');
    });

    it('Cache-Control acotado por nextChangeAt (max-age = segundos, tope 30)', async () => {
      repo.seed({ endsAt: new Date(NOW.getTime() + 8_500) });
      let res = await http().get(`/v1/store/promotions?branchId=${A}`).expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=8');
      repo.promotions.clear();
      repo.seed({ endsAt: new Date(NOW.getTime() + 3_600_000) });
      res = await http().get(`/v1/store/promotions?branchId=${A}`).expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=30');
      expect(res.headers['cache-control']).not.toContain('stale-while-revalidate');
      expect(res.headers['etag']).toBeUndefined(); // sin ETag en esta ruta (el resto de la API lo conserva)
    });

    it('lista vacía: 200 con nextChangeAt null y caché de 30 s', async () => {
      const res = await http().get(`/v1/store/promotions?branchId=${A}`).expect(200);
      expect(res.body).toMatchObject({
        branchId: A,
        items: [],
        nextChangeAt: null,
        truncated: false,
      });
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=30');
    });

    it('compact=true (F17): sin items ni productIds; compact=false o ausente = respuesta completa; inválido => 400', async () => {
      happy();
      const full = await http().get(`/v1/store/promotions?branchId=${A}`).expect(200);
      const first = json(full).items?.[0] ?? {};
      expect(first).toHaveProperty('items');
      expect(first).toHaveProperty('productIds');
      const compact = await http()
        .get(`/v1/store/promotions?branchId=${A}&compact=true`)
        .expect(200);
      expect(json(compact).items).toHaveLength(1);
      const slim = json(compact).items?.[0] ?? {};
      expect(slim).not.toHaveProperty('items');
      expect(slim).not.toHaveProperty('productIds');
      const off = await http().get(`/v1/store/promotions?branchId=${A}&compact=false`).expect(200);
      expect(json(off).items?.[0] ?? {}).toHaveProperty('items');
      await http().get(`/v1/store/promotions?branchId=${A}&compact=si`).expect(400);
    });

    it('state=upcoming; state desconocido => 400', async () => {
      clock.current = local('2026-11-16T10:00:00');
      happy();
      const live = await http().get(`/v1/store/promotions?branchId=${A}`).expect(200);
      expect(json(live).items).toEqual([]);
      const up = await http().get(`/v1/store/promotions?branchId=${A}&state=upcoming`).expect(200);
      expect(json(up).items).toHaveLength(1);
      await http().get(`/v1/store/promotions?branchId=${A}&state=otro`).expect(400);
    });

    it('errores: 400 sin caché pública; 404 idéntico para inexistente e inactiva', async () => {
      for (const url of ['/v1/store/promotions', '/v1/store/promotions?branchId=x']) {
        const res = await http().get(url).expect(400);
        expect(res.headers['cache-control'] ?? '').not.toContain('public');
      }
      const missing = await http().get(`/v1/store/promotions?branchId=${MISSING}`).expect(404);
      const inactive = await http().get(`/v1/store/promotions?branchId=${INACTIVE}`).expect(404);
      expect(json(missing).code).toBe('BRANCH_NOT_FOUND');
      expect({ ...inactive.body, requestId: 0 }).toEqual({ ...missing.body, requestId: 0 });
      expect(inactive.headers['cache-control'] ?? '').not.toContain('public');
    });

    it('el resto de la API conserva su ETag: solo se quita en promociones', async () => {
      const categories = await http().get('/v1/store/categories').expect(200);
      expect(categories.headers['etag']).toBeDefined();
    });

    it('límite de tasa propio: 60 por minuto por IP', async () => {
      let last = 200;
      for (let i = 0; i < 61; i += 1) {
        last = (await http().get(`/v1/store/promotions?branchId=${A}`)).status;
      }
      expect(last).toBe(429);
    });

    it('ignora cabeceras de identidad: la respuesta no depende de Authorization', async () => {
      happy();
      const anon = await http().get(`/v1/store/promotions?branchId=${A}`).expect(200);
      const authed = await http()
        .get(`/v1/store/promotions?branchId=${A}`)
        .set('Authorization', await admin())
        .expect(200);
      expect(authed.body).toEqual(anon.body);
    });
  });

  describe('autenticación y autorización del backoffice', () => {
    const ID = MISSING;
    const OPS: [string, string, Body?][] = [
      ['get', '/v1/admin/promotions'],
      ['post', '/v1/admin/promotions', validCreate()],
      ['get', `/v1/admin/promotions/${ID}`],
      ['patch', `/v1/admin/promotions/${ID}`, { expectedVersion: 1, name: 'x' }],
      ['patch', `/v1/admin/promotions/${ID}/status`, { active: false }],
    ];
    const call = (method: string, url: string, auth?: string, body?: Body) => {
      const r = (http() as unknown as Record<string, (u: string) => request.Test>)[method]!(url);
      if (auth) r.set('Authorization', auth);
      return body ? r.send(body) : r;
    };

    it.each(OPS)('sin JWT => 401 (%s %s)', async (method, url, body) => {
      await call(method, url, undefined, body).expect(401);
    });
    it.each(OPS)('cliente (no personal) => 403 (%s %s)', async (method, url, body) => {
      await call(method, url, await bearer(), body).expect(403);
    });
    it.each(OPS)(
      'personal con sesión aal1 (sin MFA) => 403 sin escribir (%s %s)',
      async (method, url, body) => {
        const auth = await asStaff([{ branchId: null, permissions: ALL_PERMS }], { aal: 'aal1' });
        await call(method, url, auth, body).expect(403);
        expect(repo.promotions.size).toBe(0);
        expect(repo.audit).toHaveLength(0);
      },
    );
    it.each(OPS)(
      'todas las respuestas administrativas son no-store (%s %s)',
      async (method, url, body) => {
        const res = await call(method, url, await admin(), body);
        expect(res.headers['cache-control']).toBe('no-store');
      },
    );

    it('cada operación exige SU permiso (read no escribe; update no crea)', async () => {
      const seeded = repo.seed({});
      const readOnly = await asStaff([{ branchId: null, permissions: ['promotions.read'] }]);
      await call('get', '/v1/admin/promotions', readOnly).expect(200);
      await call('get', `/v1/admin/promotions/${seeded.id}`, readOnly).expect(200);
      await call('post', '/v1/admin/promotions', readOnly, validCreate()).expect(403);
      await call('patch', `/v1/admin/promotions/${seeded.id}`, readOnly, {
        expectedVersion: 1,
        name: 'x',
      }).expect(403);
      await call('patch', `/v1/admin/promotions/${seeded.id}/status`, readOnly, {
        active: false,
      }).expect(403);
      const updateOnly = await asStaff([{ branchId: null, permissions: ['promotions.update'] }]);
      await call('post', '/v1/admin/promotions', updateOnly, validCreate()).expect(403);
      await call('get', '/v1/admin/promotions', updateOnly).expect(403);
      await call('patch', `/v1/admin/promotions/${seeded.id}`, updateOnly, {
        expectedVersion: 1,
        name: 'Z',
      }).expect(200);
      const createOnly = await asStaff([{ branchId: null, permissions: ['promotions.create'] }]);
      await call('post', '/v1/admin/promotions', createOnly, validCreate()).expect(201);
      expect(repo.promotions.get(seeded.id)?.name).toBe('Z');
    });

    it('rol sin permisos de promociones (p. ej. manager) => 403', async () => {
      const manager = await asStaff([
        { branchId: A, permissions: ['catalog.read', 'orders.read'] },
      ]);
      await call('get', '/v1/admin/promotions', manager).expect(403);
    });
  });

  describe('validación de forma (400)', () => {
    const post = async (body: Body) =>
      http()
        .post('/v1/admin/promotions')
        .set('Authorization', await admin())
        .send(body);

    it.each([
      ['kind desconocido', { kind: '2x1' }],
      ['value no decimal', { value: '15' }],
      ['value con coma', { value: '15,00' }],
      ['value negativo', { value: '-5.00' }],
      ['value numérico', { value: 15 }],
      ['campo desconocido', { precio: '1.00' }],
      ['importe del cliente (descuento)', { discountAmount: '10.00' }],
      ['startsAt sin zona', { startsAt: '2026-01-01T00:00:00' }],
      ['endsAt inexistente', { endsAt: '2026-02-31T00:00:00Z' }],
      ['name vacío', { name: '' }],
      ['name solo espacios', { name: '   ' }],
      ['name > 120', { name: 'x'.repeat(121) }],
      ['description > 500', { description: 'x'.repeat(501) }],
      ['code con espacio interno', { code: 'AB CD' }],
      ['code corto', { code: 'AB' }],
      ['code > 32', { code: 'A'.repeat(33) }],
      ['branchScope ausente/ inválido', { branchScope: 'TODAS' }],
      ['ALL con branchIds', { branchScope: 'ALL', branchIds: [A] }],
      ['SELECTED sin branchIds', { branchScope: 'SELECTED' }],
      ['SELECTED con lista vacía', { branchScope: 'SELECTED', branchIds: [] }],
      ['branchIds no UUID', { branchScope: 'SELECTED', branchIds: ['x'] }],
      ['branchIds repetidos', { branchScope: 'SELECTED', branchIds: [A, A] }],
      [
        'más de 20 sucursales',
        { branchScope: 'SELECTED', branchIds: Array.from({ length: 21 }, (_, i) => bid(100 + i)) },
      ],
      ['ALL con productIds', { productScope: 'ALL', productIds: [P1] }],
      [
        'más de 200 productos',
        {
          productScope: 'SELECTED',
          productIds: Array.from({ length: 201 }, (_, i) => bid(300 + i)),
        },
      ],
      ['weekday 0', { schedule: [{ weekday: 0, startsAt: '10:00', endsAt: '11:00' }] }],
      ['weekday 8', { schedule: [{ weekday: 8, startsAt: '10:00', endsAt: '11:00' }] }],
      ['weekday decimal', { schedule: [{ weekday: 1.5, startsAt: '10:00', endsAt: '11:00' }] }],
      ['startsAt 24:00', { schedule: [{ weekday: 1, startsAt: '24:00', endsAt: '24:00' }] }],
      ['hora "7:5"', { schedule: [{ weekday: 1, startsAt: '7:5', endsAt: '08:00' }] }],
      ['hora 25:00', { schedule: [{ weekday: 1, startsAt: '10:00', endsAt: '25:00' }] }],
      [
        'tramo con campo extra',
        { schedule: [{ weekday: 1, startsAt: '10:00', endsAt: '11:00', x: 1 }] },
      ],
      [
        'más de 42 tramos',
        {
          schedule: Array.from({ length: 43 }, () => ({
            weekday: 1,
            startsAt: '10:00',
            endsAt: '11:00',
          })),
        },
      ],
      ['dineInOnly no booleano', { dineInOnly: 'si' }],
    ])('%s', async (_n, over) => {
      const res = await post(validCreate(over));
      expect(res.status).toBe(400);
      expect(repo.promotions.size).toBe(0);
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js)/);
    });

    it('NUL o controles bidi en name/description => 400 (no 500)', async () => {
      for (const over of [
        { name: 'a\u0000b' },
        { description: 'x\u0000y' },
        { name: '\u202Egnp' },
      ]) {
        const res = await post(validCreate(over));
        expect(res.status).toBe(400);
      }
      expect(repo.promotions.size).toBe(0);
    });

    it('campos faltantes => 400', async () => {
      for (const field of [
        'name',
        'kind',
        'value',
        'startsAt',
        'endsAt',
        'branchScope',
        'productScope',
      ]) {
        const body = validCreate();
        delete body[field];
        expect((await post(body)).status).toBe(400);
      }
    });

    it('__proto__ / constructor en el cuerpo => 400 (middleware existente)', async () => {
      const auth = await admin();
      const res = await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send('{"name":"x","__proto__":{"admin":true}}');
      expect(res.status).toBe(400);
    });

    it('PATCH sin expectedVersion o con campo no permitido (active, id) => 400', async () => {
      const p = repo.seed({});
      const auth = await admin();
      for (const body of [
        { name: 'x' },
        { expectedVersion: 1, active: false },
        { expectedVersion: 1, id: A },
        { expectedVersion: 0 },
        { expectedVersion: '1' },
      ]) {
        await http()
          .patch(`/v1/admin/promotions/${p.id}`)
          .set('Authorization', auth)
          .send(body)
          .expect(400);
      }
      await http()
        .patch('/v1/admin/promotions/no-uuid')
        .set('Authorization', auth)
        .send({ expectedVersion: 1 })
        .expect(400);
      await http().get('/v1/admin/promotions/no-uuid').set('Authorization', auth).expect(400);
    });

    it('PATCH status: active obligatorio y booleano; reason <= 200', async () => {
      const p = repo.seed({});
      const auth = await admin();
      for (const body of [
        {},
        { active: 'true' },
        { active: true, reason: 'x'.repeat(201) },
        { active: true, extra: 1 },
      ]) {
        await http()
          .patch(`/v1/admin/promotions/${p.id}/status`)
          .set('Authorization', auth)
          .send(body)
          .expect(400);
      }
    });

    it('listado: parámetros inválidos => 400', async () => {
      const auth = await admin();
      for (const qs of [
        'page=0',
        'pageSize=101',
        'status=otro',
        'kind=2x1',
        'branchId=x',
        'from=ayer',
        'sort=code',
        'order=up',
        `q=${'x'.repeat(81)}`,
      ]) {
        await http().get(`/v1/admin/promotions?${qs}`).set('Authorization', auth).expect(400);
      }
    });
  });

  describe('escrituras', () => {
    it('POST => 201 con la promoción creada, version 1 y auditoría', async () => {
      const auth = await admin();
      const res = await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .send(
          validCreate({
            code: ' verano10 ',
            schedule: [{ weekday: 1, startsAt: '15:00', endsAt: '18:00' }],
            productScope: 'SELECTED',
            productIds: [P1],
          }),
        )
        .expect(201);
      expect(res.body).toMatchObject({
        code: 'VERANO10',
        version: 1,
        liveNow: true,
        productScope: 'SELECTED',
        products: [{ id: P1, name: 'Roll California', slug: 'roll-california' }],
      });
      expect(repo.audit).toHaveLength(1);
      expect(repo.audit[0]).toMatchObject({ action: 'promotion.created', actorId: STAFF_ID });
    });

    it('422: valor, periodo, horario y alcance con su code', async () => {
      const auth = await admin();
      const cases: [Body, string][] = [
        [{ value: '100.01' }, 'PROMOTION_VALUE_INVALID'],
        [{ kind: 'FIXED_AMOUNT', value: '0.00' }, 'PROMOTION_VALUE_INVALID'],
        [{ endsAt: '2026-01-01T00:00:00-06:00' }, 'PROMOTION_PERIOD_INVALID'],
        [
          { schedule: [{ weekday: 1, startsAt: '18:00', endsAt: '15:00' }] },
          'PROMOTION_SCHEDULE_INVALID',
        ],
        [{ productScope: 'SELECTED', productIds: [P1, MISSING] }, 'PROMOTION_SCOPE_INVALID'],
      ];
      for (const [over, code] of cases) {
        const res = await http()
          .post('/v1/admin/promotions')
          .set('Authorization', auth)
          .send(validCreate(over))
          .expect(422);
        expect(json(res).code).toBe(code);
      }
      const bad = await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .send(validCreate({ productScope: 'SELECTED', productIds: [P1, MISSING] }));
      expect(json(bad).violations?.[0]).toMatchObject({
        path: 'productIds[1]',
        code: 'PRODUCT_UNKNOWN',
      });
      expect(repo.promotions.size).toBe(0);
    });

    it('código duplicado => 409 PROMOTION_CODE_TAKEN (sin distinguir mayúsculas)', async () => {
      const auth = await admin();
      await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .send(validCreate({ code: 'VERANO' }))
        .expect(201);
      const dup = await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .send(validCreate({ code: 'verano' }))
        .expect(409);
      expect(json(dup).code).toBe('PROMOTION_CODE_TAKEN');
      expect(repo.promotions.size).toBe(1);
      // varias automáticas (code NULL) sí pueden coexistir
      await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .send(validCreate())
        .expect(201);
      await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .send(validCreate())
        .expect(201);
    });

    it('PATCH: 409 de versión, luego éxito con version+1; el status es idempotente', async () => {
      const auth = await admin();
      const p = repo.seed({ name: 'Base' });
      const conflict = await http()
        .patch(`/v1/admin/promotions/${p.id}`)
        .set('Authorization', auth)
        .send({ expectedVersion: 5, name: 'X' })
        .expect(409);
      expect(json(conflict).code).toBe('PROMOTION_VERSION_CONFLICT');
      const ok = await http()
        .patch(`/v1/admin/promotions/${p.id}`)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, name: 'Nuevo' })
        .expect(200);
      expect(ok.body).toMatchObject({ name: 'Nuevo', version: 2 });
      const same = await http()
        .patch(`/v1/admin/promotions/${p.id}`)
        .set('Authorization', auth)
        .send({ expectedVersion: 2, name: 'Nuevo' })
        .expect(200);
      expect(json(same).version).toBe(2);
      expect(repo.audit.map((a) => a['action'])).toEqual(['promotion.updated']);
      const off = await http()
        .patch(`/v1/admin/promotions/${p.id}/status`)
        .set('Authorization', auth)
        .send({ active: false, reason: 'fin' })
        .expect(200);
      expect(off.body).toMatchObject({ active: false, version: 3, lifecycle: 'INACTIVE' });
      await http()
        .patch(`/v1/admin/promotions/${p.id}/status`)
        .set('Authorization', auth)
        .send({ active: false })
        .expect(200);
      expect(repo.audit.map((a) => a['action'])).toEqual([
        'promotion.updated',
        'promotion.status_changed',
      ]);
    });

    it('PATCH/GET sobre inexistente => 404 PROMOTION_NOT_FOUND', async () => {
      const auth = await admin();
      for (const res of [
        await http().get(`/v1/admin/promotions/${MISSING}`).set('Authorization', auth).expect(404),
        await http()
          .patch(`/v1/admin/promotions/${MISSING}`)
          .set('Authorization', auth)
          .send({ expectedVersion: 1 })
          .expect(404),
        await http()
          .patch(`/v1/admin/promotions/${MISSING}/status`)
          .set('Authorization', auth)
          .send({ active: true })
          .expect(404),
      ]) {
        expect(json(res).code).toBe('PROMOTION_NOT_FOUND');
      }
    });

    it('PROMOTIONS_BUSY (503) por timeout de la transacción, sin detalles internos', async () => {
      const auth = await admin();
      repo.failTransactionWith = Object.assign(new Error('secreto interno: pg timeout'), {
        code: 'P2028',
      });
      const res = await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .send(validCreate())
        .expect(503);
      expect(json(res).code).toBe('PROMOTIONS_BUSY');
      expect(JSON.stringify(res.body)).not.toContain('secreto');
    });

    it('error inesperado => 500 genérico sin traza ni mensaje interno', async () => {
      const auth = await admin();
      repo.failTransactionWith = new Error('SELECT * FROM app.promotions; password=hunter2');
      const res = await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .send(validCreate())
        .expect(500);
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|SELECT|stack/);
      expect(json(res).code).toBeUndefined();
    });

    it('límite de escrituras: 30 por minuto por actor', async () => {
      const auth = await admin();
      const p = repo.seed({});
      let last = 200;
      for (let i = 0; i < 31; i += 1) {
        last = (
          await http()
            .patch(`/v1/admin/promotions/${p.id}/status`)
            .set('Authorization', auth)
            .send({ active: true })
        ).status;
      }
      expect(last).toBe(429);
    });

    it('el código del cupón no se escribe en los logs de aplicación', async () => {
      const auth = await admin();
      await http()
        .post('/v1/admin/promotions')
        .set('Authorization', auth)
        .send(validCreate({ code: 'CODIGOSECRETO' }))
        .expect(201);
      expect(logged.join('\n')).not.toContain('CODIGOSECRETO');
    });
  });

  describe('alcance por sucursal (IDOR)', () => {
    const post = (auth: string, body: Body) =>
      http().post('/v1/admin/promotions').set('Authorization', auth).send(body);

    it('empleado de A: crea para A; ALL => 403; B => 404 BRANCH_NOT_FOUND', async () => {
      const staff = await asStaff([{ branchId: A, permissions: ALL_PERMS }]);
      expect(json(await post(staff, validCreate()).expect(403)).code).toBe(
        'PROMOTION_SCOPE_FORBIDDEN',
      );
      expect(
        json(
          await post(staff, validCreate({ branchScope: 'SELECTED', branchIds: [B] })).expect(404),
        ).code,
      ).toBe('BRANCH_NOT_FOUND');
      const ok = await post(staff, validCreate({ branchScope: 'SELECTED', branchIds: [A] })).expect(
        201,
      );
      expect(json(ok).branches).toEqual([{ id: A, name: 'Zona 10' }]);
      expect(repo.promotions.size).toBe(1);
    });

    it('promoción ajena => 404 igual que inexistente; compartida => 403 y no se modifica', async () => {
      const onlyB = repo.seed({ branchIds: [B], name: 'B' });
      const shared = repo.seed({ branchIds: [A, B], name: 'AB' });
      const staff = await asStaff([{ branchId: A, permissions: ALL_PERMS }]);
      const other = await http()
        .get(`/v1/admin/promotions/${onlyB.id}`)
        .set('Authorization', staff)
        .expect(404);
      const missing = await http()
        .get(`/v1/admin/promotions/${MISSING}`)
        .set('Authorization', staff)
        .expect(404);
      expect({ ...other.body, requestId: 0 }).toEqual({ ...missing.body, requestId: 0 });
      await http()
        .patch(`/v1/admin/promotions/${onlyB.id}`)
        .set('Authorization', staff)
        .send({ expectedVersion: 1, name: 'X' })
        .expect(404);
      await http()
        .patch(`/v1/admin/promotions/${onlyB.id}/status`)
        .set('Authorization', staff)
        .send({ active: false })
        .expect(404);
      const forbidden = await http()
        .patch(`/v1/admin/promotions/${shared.id}`)
        .set('Authorization', staff)
        .send({ expectedVersion: 1, name: 'X' })
        .expect(403);
      expect(json(forbidden).code).toBe('PROMOTION_SCOPE_FORBIDDEN');
      await http()
        .patch(`/v1/admin/promotions/${shared.id}/status`)
        .set('Authorization', staff)
        .send({ active: false })
        .expect(403);
      expect(repo.promotions.get(shared.id)).toMatchObject({
        name: 'AB',
        active: true,
        version: 1,
      });
      expect(repo.audit).toHaveLength(0);
    });

    it('listado acotado: sus promociones y las de toda la cadena; filtro de otra sucursal => 404', async () => {
      repo.seed({ name: 'Todas' });
      repo.seed({ name: 'Solo B', branchIds: [B] });
      repo.seed({ name: 'Solo A', branchIds: [A] });
      const staff = await asStaff([{ branchId: A, permissions: ALL_PERMS }]);
      const res = await http().get('/v1/admin/promotions').set('Authorization', staff).expect(200);
      expect((json(res).items as Body[]).map((i) => i['name']).sort()).toEqual(['Solo A', 'Todas']);
      await http()
        .get(`/v1/admin/promotions?branchId=${B}`)
        .set('Authorization', staff)
        .expect(404);
      await http()
        .get(`/v1/admin/promotions?branchId=${A}`)
        .set('Authorization', staff)
        .expect(200);
    });

    it('permisos con alcances distintos: update solo en A, read global', async () => {
      const staff = await asStaff([
        { branchId: null, permissions: ['promotions.read'] },
        { branchId: A, permissions: ['promotions.update'] },
      ]);
      const onlyB = repo.seed({ branchIds: [B] });
      const onlyA = repo.seed({ branchIds: [A] });
      const seen = await http()
        .get(`/v1/admin/promotions/${onlyB.id}`)
        .set('Authorization', staff)
        .expect(200);
      expect(json(seen).editable).toBe(false);
      await http()
        .patch(`/v1/admin/promotions/${onlyB.id}`)
        .set('Authorization', staff)
        .send({ expectedVersion: 1, name: 'X' })
        .expect(404);
      await http()
        .patch(`/v1/admin/promotions/${onlyA.id}`)
        .set('Authorization', staff)
        .send({ expectedVersion: 1, name: 'X' })
        .expect(200);
    });
  });

  describe('listado y detalle', () => {
    it('paginado con filtros y orden; devuelve resumen sin products/schedule', async () => {
      for (let i = 0; i < 3; i += 1)
        repo.seed({ name: `Promo ${i}`, kind: i === 0 ? 'FIXED_AMOUNT' : 'PERCENT' });
      const auth = await admin();
      const res = await http()
        .get('/v1/admin/promotions?page=1&pageSize=2&sort=name&order=asc')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect((json(res).items as Body[]).map((i) => i['name'])).toEqual(['Promo 0', 'Promo 1']);
      expect(json(res).items?.[0]).not.toHaveProperty('products');
      const fixed = await http()
        .get('/v1/admin/promotions?kind=FIXED_AMOUNT')
        .set('Authorization', auth)
        .expect(200);
      expect(json(fixed).total).toBe(1);
      const q = await http()
        .get('/v1/admin/promotions?q=promo%202')
        .set('Authorization', auth)
        .expect(200);
      expect(json(q).total).toBe(1);
    });

    it('detalle incluye el código del cupón (solo backoffice)', async () => {
      const p = repo.seed({ code: 'VERANO', productIds: [P3] });
      const res = await http()
        .get(`/v1/admin/promotions/${p.id}`)
        .set('Authorization', await admin())
        .expect(200);
      expect(res.body).toMatchObject({ code: 'VERANO', products: [{ id: P3 }], schedule: [] });
    });
  });

  it('el cliente nunca puede fijar importes: el descuento sale solo de la configuración guardada', async () => {
    const p = repo.seed({ value: '10.00', productIds: [P1] });
    const res = await http().get(`/v1/store/promotions?branchId=${A}`).expect(200);
    expect(JSON.stringify(res.body)).toContain('"promoPrice":"76.50"');
    expect(p.value).toBe('10.00');
    await http().get(`/v1/store/promotions?branchId=${A}&discount=99.00`).expect(400);
  });

  it('se usa C solo para verificar sucursales distintas (sin efecto)', () => {
    expect(C).not.toBe(A);
  });
});
