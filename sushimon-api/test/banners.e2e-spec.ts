import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  bannersHarness,
  A,
  B,
  INACTIVE_BRANCH,
  MISSING_BRANCH,
  NOW,
  MutableClock,
  local,
} from './support/banners-harness.js';
import {
  assetid,
  bnid,
  catid,
  FakeBannersRepo,
  promoid,
  text,
} from './support/fake-banners-repo.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const ALL_PERMS = ['banners.read', 'banners.create', 'banners.update'];
const MISSING = '00000000-0000-4000-8000-0000000000ff';

function fakeDb() {
  const db = {
    category: { findMany: vi.fn(() => Promise.resolve([])) },
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
  code: 'Verano-2026',
  imageAssetId: assetid(1),
  translations: { es: { title: 'Verano', imageAlt: 'Roll de salmón' } },
  cta: { type: 'MENU' },
  branchScope: 'ALL',
  ...over,
});

describe('Banners, contenido editorial y campañas (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  let repo: FakeBannersRepo;
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
      // Base pública simulada (https://media.mock.invalid): sin ella ningún banner puede publicarse.
      MEDIA_STORAGE_ADAPTER: 'mock',
    });
    vi.resetModules();
    const { AppModule } = await import('../src/app.module.js');
    const { configureApp } = await import('../src/app.setup.js');
    const { PrismaService } = await import('../src/database/prisma.service.js');
    const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
    const { BannersRepository } = await import('../src/banners/banners.repository.js');
    const { BannersReadRepository } = await import('../src/banners/banners-read.repository.js');
    const { CLOCK } = await import('../src/branch-schedule/clock.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(JWKS_RESOLVER)
      .useValue(keys.jwks)
      .overrideProvider(BannersRepository)
      .useValue(repo)
      .overrideProvider(BannersReadRepository)
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
    db = fakeDb();
    const h = bannersHarness();
    repo = h.repo;
    clock = h.clock;
    clock.current = NOW;
    app = await createApp();
  });
  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/store/banners (público)', () => {
    it('sin JWT: banners publicados, ordenados, sin datos administrativos ni de promoción', async () => {
      const promo = repo.seedPromotion(1, { name: 'Cupón SECRETO10' });
      const first = repo.seed({ sortOrder: 1, code: 'secreto-interno', promotionId: promo.id });
      const second = repo.seed({ sortOrder: 0 });
      repo.seed({ active: false });
      const res = await http().get('/v1/store/banners').expect(200);
      expect((json(res).items ?? []).map((i) => i['id'])).toEqual([second.id, first.id]);
      expect(res.body).toMatchObject({ branchId: null, locale: 'es', nextChangeAt: null });
      expect(json(res)['generatedAt']).toBe(NOW.toISOString());
      const raw = JSON.stringify(res.body);
      for (const leak of [
        'secreto-interno',
        'SECRETO10',
        promoid(1),
        'promotionId',
        'version',
        'createdAt',
        'sortOrder',
        'branchIds',
      ])
        expect(raw).not.toContain(leak);
      expect(json(res).items?.[0]).toMatchObject({
        image: {
          url: `https://media.mock.invalid/banners/2026/${assetid(1)}.webp`,
          mimeType: 'image/webp',
        },
        cta: { type: 'NONE' },
        fallbackFields: [],
      });
    });

    it('Cache-Control acotado por nextChangeAt; sin ETag, sin stale-while-revalidate', async () => {
      repo.seed({ endsAt: new Date(NOW.getTime() + 8_500) });
      let res = await http().get('/v1/store/banners').expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=8');
      expect(res.headers['etag']).toBeUndefined();
      repo.banners.clear();
      repo.seed({ endsAt: new Date(NOW.getTime() + 3_600_000) });
      res = await http().get('/v1/store/banners').expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=30');
      expect(res.headers['cache-control']).not.toContain('stale-while-revalidate');
      expect(res.headers['etag']).toBeUndefined();
    });

    it('límite exacto: 1 s antes del cambio => s-maxage=1; en el instante exacto el banner ya no sale', async () => {
      repo.seed({ endsAt: new Date(NOW.getTime() + 1_000) });
      const res = await http().get('/v1/store/banners').expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=1, s-maxage=1');
      clock.current = new Date(NOW.getTime() + 1_000);
      const after = await http().get('/v1/store/banners').expect(200);
      expect(json(after).items).toEqual([]);
      expect(after.headers['cache-control']).toBe('public, max-age=5, s-maxage=30');
    });

    it('lista vacía: 200 con items [] y caché de 30 s', async () => {
      const res = await http().get('/v1/store/banners').expect(200);
      expect(res.body).toMatchObject({
        items: [],
        nextChangeAt: null,
        branchId: null,
        locale: 'es',
      });
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=30');
    });

    it('locale=en con respaldo por campo y fallbackFields; locale desconocido => 400', async () => {
      repo.seed({
        es: text({ title: 'Hola', subtitle: 'Sub', imageAlt: 'Alt' }),
        en: { title: 'Hello', subtitle: null, ctaLabel: null, imageAlt: null },
      });
      const res = await http().get('/v1/store/banners?locale=en').expect(200);
      expect(json(res)['locale']).toBe('en');
      expect(json(res).items?.[0]).toMatchObject({
        title: 'Hello',
        subtitle: 'Sub',
        imageAlt: 'Alt',
        fallbackFields: ['subtitle', 'imageAlt'],
      });
      const bad = await http().get('/v1/store/banners?locale=fr').expect(400);
      expect(bad.headers['cache-control'] ?? '').not.toContain('public');
    });

    it('branchId: ALL + SELECTED que la incluyen; sin él solo ALL; inexistente/inactiva => 404 idéntico; mal formado => 400', async () => {
      const all = repo.seed();
      const inA = repo.seed({ branchIds: [A] });
      repo.seed({ branchIds: [B] });
      const withA = await http().get(`/v1/store/banners?branchId=${A}`).expect(200);
      expect((json(withA).items ?? []).map((i) => i['id'])).toEqual([all.id, inA.id]);
      expect(json(withA)['branchId']).toBe(A);
      const none = await http().get('/v1/store/banners').expect(200);
      expect((json(none).items ?? []).map((i) => i['id'])).toEqual([all.id]);
      const missing = await http().get(`/v1/store/banners?branchId=${MISSING_BRANCH}`).expect(404);
      const inactive = await http()
        .get(`/v1/store/banners?branchId=${INACTIVE_BRANCH}`)
        .expect(404);
      expect(json(missing).code).toBe('BRANCH_NOT_FOUND');
      expect({ ...inactive.body, requestId: 0 }).toEqual({ ...missing.body, requestId: 0 });
      expect(inactive.headers['cache-control'] ?? '').not.toContain('public');
      await http().get('/v1/store/banners?branchId=x').expect(400);
    });

    it('promoción vinculada: vigente sale; vencida/futura/de otra sucursal no; sin filtrar su código', async () => {
      const live = repo.seedPromotion(1);
      const expired = repo.seedPromotion(2, {
        startsAt: new Date(NOW.getTime() - 7_200_000),
        endsAt: new Date(NOW.getTime() - 3_600_000),
      });
      const future = repo.seedPromotion(3, {
        startsAt: new Date(NOW.getTime() + 3_600_000),
        endsAt: new Date(NOW.getTime() + 7_200_000),
      });
      const otherBranch = repo.seedPromotion(4, { branchIds: [B] });
      const ok = repo.seed({ promotionId: live.id });
      for (const p of [expired, future, otherBranch]) repo.seed({ promotionId: p.id });
      const res = await http().get(`/v1/store/banners?branchId=${A}`).expect(200);
      expect((json(res).items ?? []).map((i) => i['id'])).toEqual([ok.id]);
      // el cambio de la promoción futura acota la caché (1 h => tope de 30 s)
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=30');
    });

    it('error de BD de lectura => 503 BANNERS_BUSY sin detalles; inesperado => 500 genérico', async () => {
      repo.failReadWith = Object.assign(new Error('secreto interno: pg timeout'), {
        code: 'P2028',
      });
      const busy = await http().get('/v1/store/banners').expect(503);
      expect(json(busy).code).toBe('BANNERS_BUSY');
      expect(JSON.stringify(busy.body)).not.toContain('secreto');
      repo.failReadWith = new Error('SELECT * FROM app.banners; password=hunter2');
      const boom = await http().get('/v1/store/banners').expect(500);
      expect(JSON.stringify(boom.body)).not.toMatch(/hunter2|SELECT|stack/);
      expect(json(boom).code).toBeUndefined();
    });

    it('límite de tasa propio: 60 por minuto por IP', async () => {
      let last = 200;
      for (let i = 0; i < 61; i += 1) last = (await http().get('/v1/store/banners')).status;
      expect(last).toBe(429);
    });

    it('ignora cabeceras de identidad: la respuesta no depende de Authorization', async () => {
      repo.seed();
      const anon = await http().get('/v1/store/banners').expect(200);
      const authed = await http()
        .get('/v1/store/banners')
        .set('Authorization', await admin())
        .expect(200);
      expect(authed.body).toEqual(anon.body);
    });

    it('el resto de la API conserva su ETag: solo se quita en banners', async () => {
      const health = await http().get('/v1/health').expect(200);
      expect(health.headers['etag']).toBeDefined();
    });
  });

  describe('autenticación y autorización del backoffice', () => {
    const ID = MISSING;
    const OPS: [string, string, Body?][] = [
      ['get', '/v1/admin/banners'],
      ['post', '/v1/admin/banners', validCreate()],
      ['get', `/v1/admin/banners/${ID}`],
      ['patch', `/v1/admin/banners/${ID}`, { expectedVersion: 1, sortOrder: 1 }],
      ['patch', `/v1/admin/banners/${ID}/status`, { active: false }],
      ['put', '/v1/admin/banners/order', { orderedIds: [ID] }],
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
        expect(repo.banners.size).toBe(0);
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
      const readOnly = await asStaff([{ branchId: null, permissions: ['banners.read'] }]);
      await call('get', '/v1/admin/banners', readOnly).expect(200);
      await call('get', `/v1/admin/banners/${seeded.id}`, readOnly).expect(200);
      await call('post', '/v1/admin/banners', readOnly, validCreate()).expect(403);
      await call('patch', `/v1/admin/banners/${seeded.id}`, readOnly, {
        expectedVersion: 1,
        sortOrder: 4,
      }).expect(403);
      await call('patch', `/v1/admin/banners/${seeded.id}/status`, readOnly, {
        active: false,
      }).expect(403);
      await call('put', '/v1/admin/banners/order', readOnly, { orderedIds: [seeded.id] }).expect(
        403,
      );
      const updateOnly = await asStaff([{ branchId: null, permissions: ['banners.update'] }]);
      await call('post', '/v1/admin/banners', updateOnly, validCreate()).expect(403);
      await call('get', '/v1/admin/banners', updateOnly).expect(403);
      await call('patch', `/v1/admin/banners/${seeded.id}`, updateOnly, {
        expectedVersion: 1,
        sortOrder: 4,
      }).expect(200);
      const createOnly = await asStaff([{ branchId: null, permissions: ['banners.create'] }]);
      await call('post', '/v1/admin/banners', createOnly, validCreate()).expect(201);
      expect(repo.banners.get(seeded.id)?.sortOrder).toBe(4);
    });

    it('rol sin permisos de banners (p. ej. manager) => 403', async () => {
      const manager = await asStaff([
        { branchId: A, permissions: ['catalog.read', 'orders.read', 'promotions.read'] },
      ]);
      await call('get', '/v1/admin/banners', manager).expect(403);
    });
  });

  describe('validación de forma (400)', () => {
    const post = async (body: Body) =>
      http()
        .post('/v1/admin/banners')
        .set('Authorization', await admin())
        .send(body);

    it('campos faltantes o desconocidos => 400', async () => {
      for (const body of [
        {},
        validCreate({ code: undefined }),
        validCreate({ imageAssetId: undefined }),
        validCreate({ translations: undefined }),
        validCreate({ cta: undefined }),
        validCreate({ branchScope: undefined }),
        validCreate({ translations: {} }),
        validCreate({ translations: null }),
        validCreate({ translations: { es: null } }),
        validCreate({ translations: { es: { title: 'T', imageAlt: 'A' }, en: 'x' } }),
        validCreate({ translations: 'x' }),
        validCreate({ cta: null }),
        validCreate({ cta: [] }),
        validCreate({ extra: 1 }),
      ])
        await post(body).then((r) =>
          expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]),
        );
      expect(repo.banners.size).toBe(0);
    });

    it('código inválido (formato, longitud) => 400; se normaliza a minúsculas', async () => {
      for (const code of ['ab', 'con espacio', 'ñ-ñ-ñ', 'a'.repeat(65), '-abc'])
        await post(validCreate({ code })).then((r) => expect(r.status).toBe(400));
      const ok = await post(validCreate({ code: ' MiBanner-1 ' }));
      expect(ok.status).toBe(201);
      expect(json(ok)['code']).toBe('mibanner-1');
    });

    it('CTA: EXTERNAL y cualquier tipo desconocido => 400; campos de URL no existen', async () => {
      for (const cta of [
        { type: 'EXTERNAL', url: 'https://x.com' },
        { type: 'EXTERNAL' },
        { type: 'URL' },
        { type: 'MENU', url: 'https://x.com' },
        { type: 'MENU', href: '/menu' },
      ])
        await post(validCreate({ cta })).then((r) => expect(r.status).toBe(400));
    });

    it('CTA PAGE fuera de la lista => 422 (regla de negocio, no de forma); javascript:, data:, //host y rutas de texto', async () => {
      for (const page of [
        'javascript:alert(1)',
        'data:text/html,x',
        '//evil.com',
        '/menu',
        'https://x.com',
      ]) {
        const r = await post(validCreate({ cta: { type: 'PAGE', page } }));
        expect(r.status).toBe(422);
        expect(json(r).code).toBe('BANNER_CTA_INVALID');
      }
      expect(repo.banners.size).toBe(0);
    });

    it('NUL o controles bidi en los textos => 400 (no 500)', async () => {
      for (const title of ['a\u0000b', 'a‮b'])
        await post(validCreate({ translations: { es: { title, imageAlt: 'A' } } })).then((r) =>
          expect(r.status).toBe(400),
        );
    });

    it('longitudes: título 81, subtítulo 161, etiqueta 41, alt 201 => 400', async () => {
      for (const es of [
        { title: 'a'.repeat(81), imageAlt: 'A' },
        { title: 'T', imageAlt: 'A', subtitle: 'a'.repeat(161) },
        { title: 'T', imageAlt: 'A', ctaLabel: 'a'.repeat(41) },
        { title: 'T', imageAlt: 'a'.repeat(201) },
      ])
        await post(validCreate({ translations: { es } })).then((r) => expect(r.status).toBe(400));
    });

    it('fechas sin zona o mal formadas, sortOrder fuera de rango, UUID inválidos, branchIds repetidos => 400', async () => {
      for (const over of [
        { startsAt: '2026-12-01T00:00:00' },
        { endsAt: 'mañana' },
        { sortOrder: -1 },
        { sortOrder: 10000 },
        { sortOrder: 1.5 },
        { imageAssetId: 'x' },
        { branchScope: 'SELECTED', branchIds: ['x'] },
        { branchScope: 'SELECTED', branchIds: [A, A] },
        { branchScope: 'SOME' },
        { active: 'yes' },
        { promotionId: 'x' },
      ])
        await post(validCreate(over)).then((r) => expect(r.status).toBe(400));
    });

    it('__proto__ / constructor en el cuerpo => 400 (middleware existente)', async () => {
      const auth = await admin();
      const res = await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send('{"code":"abc-def","__proto__":{"admin":true}}');
      expect(res.status).toBe(400);
    });

    it('PATCH sin expectedVersion o con code / active / id => 400', async () => {
      const b = repo.seed();
      const auth = await admin();
      for (const body of [
        { sortOrder: 1 },
        { expectedVersion: 0, sortOrder: 1 },
        { expectedVersion: 1, code: 'otro-codigo' },
        { expectedVersion: 1, active: false },
        { expectedVersion: 1, id: b.id },
        { expectedVersion: 1, translations: { fr: { title: 'x' } } },
        { expectedVersion: 1, cta: { type: 'EXTERNAL' } },
        { expectedVersion: 1, cta: null },
        { expectedVersion: 1, translations: null },
        { expectedVersion: 1, translations: { es: null } },
        { expectedVersion: 1, translations: { en: 'x' } },
      ])
        await http()
          .patch(`/v1/admin/banners/${b.id}`)
          .set('Authorization', auth)
          .send(body)
          .then((r) => expect(r.status).toBe(400));
      expect(repo.banners.get(b.id)?.version).toBe(1);
    });

    it('PATCH status: active obligatorio y booleano; reason <= 200', async () => {
      const b = repo.seed();
      const auth = await admin();
      for (const body of [
        {},
        { active: 'si' },
        { active: true, reason: 'a'.repeat(201) },
        { active: true, reason: 'a\u0000b' },
        { active: true, reason: 'a\u202Eb' },
        { active: true, x: 1 },
      ])
        await http()
          .patch(`/v1/admin/banners/${b.id}/status`)
          .set('Authorization', auth)
          .send(body)
          .then((r) => expect(r.status).toBe(400));
    });

    it('PUT order: orderedIds vacío, repetidos, > 100 o no UUID => 400; la ruta order no se confunde con :id', async () => {
      const auth = await admin();
      for (const body of [
        {},
        { orderedIds: [] },
        { orderedIds: [MISSING, MISSING] },
        { orderedIds: ['x'] },
        { orderedIds: Array.from({ length: 101 }, (_, i) => bnid(i)) },
        { orderedIds: [MISSING], extra: 1 },
      ])
        await http()
          .put('/v1/admin/banners/order')
          .set('Authorization', auth)
          .send(body)
          .then((r) => expect(r.status).toBe(400));
      // GET /order no existe como detalle: se interpreta como `:id` y falla por UUID
      await http().get('/v1/admin/banners/order').set('Authorization', auth).expect(400);
    });

    it('listado: parámetros inválidos => 400', async () => {
      const auth = await admin();
      for (const qs of [
        'page=0',
        'pageSize=101',
        'lifecycle=ZOMBIE',
        'sort=code',
        'order=up',
        'branchId=x',
        `q=${'a'.repeat(81)}`,
        'x=1',
      ])
        await http().get(`/v1/admin/banners?${qs}`).set('Authorization', auth).expect(400);
    });
  });

  describe('escrituras', () => {
    it('POST => 201 con el banner, version 1, auditoría sin PII y sin URLs firmadas', async () => {
      repo.seed({ sortOrder: 3 });
      const res = await http()
        .post('/v1/admin/banners')
        .set('Authorization', await admin())
        .send(
          validCreate({
            translations: {
              es: { title: 'Verano', imageAlt: 'Alt' },
              en: { title: 'Summer', imageAlt: 'Alt en' },
            },
          }),
        )
        .expect(201);
      expect(res.body).toMatchObject({
        code: 'verano-2026',
        version: 1,
        sortOrder: 4,
        lifecycle: 'PUBLISHED',
        visibleNow: true,
        hasEnglish: true,
        editable: true,
      });
      expect(repo.audit).toHaveLength(1);
      expect(repo.audit[0]).toMatchObject({
        action: 'banner.created',
        actorId: STAFF_ID,
        branchId: null,
      });
      expect(JSON.stringify(repo.audit)).not.toMatch(/X-Amz|Signature|https?:\/\//i);
    });

    it('422 con su code y violations: imagen, traducción, CTA, periodo, alcance, promoción', async () => {
      const auth = await admin();
      repo.seedAsset(2, { status: 'PENDING' });
      repo.seedAsset(3, { kind: 'PRODUCT_IMAGE', objectKey: 'products/2026/x.png' });
      repo.seedCategory(9, { active: false });
      const cases: [Body, string, string?][] = [
        [{ imageAssetId: assetid(99) }, 'BANNER_IMAGE_INVALID', 'ASSET_UNKNOWN'],
        [{ imageAssetId: assetid(2) }, 'BANNER_IMAGE_INVALID', 'ASSET_NOT_READY'],
        [{ imageAssetId: assetid(3) }, 'BANNER_IMAGE_INVALID', 'ASSET_KIND_MISMATCH'],
        [
          { translations: { es: { title: ' ', imageAlt: 'A' } } },
          'BANNER_TRANSLATION_INVALID',
          'REQUIRED',
        ],
        [
          { cta: { type: 'CATEGORY', categoryId: catid(9) } },
          'BANNER_CTA_INVALID',
          'TARGET_INACTIVE',
        ],
        [
          { cta: { type: 'CATEGORY', categoryId: catid(1), productId: MISSING } },
          'BANNER_CTA_INVALID',
          'FIELD_MISMATCH',
        ],
        [
          { startsAt: '2026-12-02T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' },
          'BANNER_PERIOD_INVALID',
        ],
        [{ branchScope: 'SELECTED' }, 'BANNER_SCOPE_INVALID'],
        [{ branchScope: 'ALL', branchIds: [A] }, 'BANNER_SCOPE_INVALID'],
        [{ promotionId: promoid(77) }, 'BANNER_PROMOTION_INVALID', 'PROMOTION_UNKNOWN'],
      ];
      for (const [over, code, violation] of cases) {
        const res = await http()
          .post('/v1/admin/banners')
          .set('Authorization', auth)
          .send(validCreate(over))
          .expect(422);
        expect(json(res).code).toBe(code);
        if (violation) expect(json(res).violations?.map((v) => v.code)).toContain(violation);
      }
      expect(repo.banners.size).toBe(0);
      expect(repo.audit).toHaveLength(0);
    });

    it('sucursal inexistente => 404 BRANCH_NOT_FOUND', async () => {
      const res = await http()
        .post('/v1/admin/banners')
        .set('Authorization', await admin())
        .send(validCreate({ branchScope: 'SELECTED', branchIds: [MISSING_BRANCH] }))
        .expect(404);
      expect(json(res).code).toBe('BRANCH_NOT_FOUND');
    });

    it('código duplicado => 409 BANNER_CODE_TAKEN (sin distinguir mayúsculas)', async () => {
      const auth = await admin();
      await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .send(validCreate())
        .expect(201);
      const dup = await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .send(validCreate({ code: 'VERANO-2026' }))
        .expect(409);
      expect(json(dup).code).toBe('BANNER_CODE_TAKEN');
      expect(repo.audit).toHaveLength(1);
    });

    it('PATCH: 409 de versión, luego éxito con version+1; el estado es idempotente', async () => {
      const auth = await admin();
      const b = repo.seed({ es: text({ title: 'A', subtitle: 'Sub' }) });
      const stale = await http()
        .patch(`/v1/admin/banners/${b.id}`)
        .set('Authorization', auth)
        .send({ expectedVersion: 5, sortOrder: 9 })
        .expect(409);
      expect(json(stale).code).toBe('BANNER_VERSION_CONFLICT');
      const ok = await http()
        .patch(`/v1/admin/banners/${b.id}`)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, translations: { es: { title: 'Nuevo' } } })
        .expect(200);
      expect(ok.body).toMatchObject({
        version: 2,
        translations: { es: { title: 'Nuevo', subtitle: 'Sub' } },
      });
      const same = await http()
        .patch(`/v1/admin/banners/${b.id}`)
        .set('Authorization', auth)
        .send({ expectedVersion: 2, translations: { es: { title: 'Nuevo' } } })
        .expect(200);
      expect(json(same)['version']).toBe(2);
      expect(repo.audit).toHaveLength(1);
      const off = await http()
        .patch(`/v1/admin/banners/${b.id}/status`)
        .set('Authorization', auth)
        .send({ active: false, reason: 'fin' })
        .expect(200);
      expect(off.body).toMatchObject({ active: false, version: 3, lifecycle: 'INACTIVE' });
      const again = await http()
        .patch(`/v1/admin/banners/${b.id}/status`)
        .set('Authorization', auth)
        .send({ active: false })
        .expect(200);
      expect(json(again)['version']).toBe(3);
      expect(repo.audit.map((a) => a['action'])).toEqual([
        'banner.updated',
        'banner.status_changed',
      ]);
    });

    it('caché: activar y desactivar se reflejan en la lectura pública (≤ 30 s en CDN; el origen responde al instante)', async () => {
      const auth = await admin();
      const created = await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .send(validCreate())
        .expect(201);
      const id = json(created)['id'] as string;
      const live = await http().get('/v1/store/banners').expect(200);
      expect((json(live).items ?? []).map((i) => i['id'])).toEqual([id]);
      await http()
        .patch(`/v1/admin/banners/${id}/status`)
        .set('Authorization', auth)
        .send({ active: false })
        .expect(200);
      expect(json(await http().get('/v1/store/banners').expect(200)).items).toEqual([]);
      await http()
        .patch(`/v1/admin/banners/${id}/status`)
        .set('Authorization', auth)
        .send({ active: true })
        .expect(200);
      expect(json(await http().get('/v1/store/banners').expect(200)).items).toHaveLength(1);
    });

    it('PUT order: reordena, version+1 solo en los que cambian, idempotente; 422 si el conjunto no coincide', async () => {
      const auth = await admin();
      const a = repo.seed({ sortOrder: 0 });
      const b = repo.seed({ sortOrder: 1 });
      const c = repo.seed({ sortOrder: 2 });
      const res = await http()
        .put('/v1/admin/banners/order')
        .set('Authorization', auth)
        .send({ orderedIds: [c.id, b.id, a.id] })
        .expect(200);
      expect(json(res).items).toEqual([
        { id: c.id, sortOrder: 0, version: 2 },
        { id: b.id, sortOrder: 1, version: 1 },
        { id: a.id, sortOrder: 2, version: 2 },
      ]);
      const again = await http()
        .put('/v1/admin/banners/order')
        .set('Authorization', auth)
        .send({ orderedIds: [c.id, b.id, a.id] })
        .expect(200);
      expect(json(again).items).toEqual(json(res).items);
      expect(repo.audit.filter((e) => e['action'] === 'banner.reordered')).toHaveLength(1);
      const bad = await http()
        .put('/v1/admin/banners/order')
        .set('Authorization', auth)
        .send({ orderedIds: [c.id, b.id] })
        .expect(422);
      expect(json(bad).code).toBe('BANNER_REORDER_MISMATCH');
      // el público respeta el nuevo orden
      const store = await http().get('/v1/store/banners').expect(200);
      expect((json(store).items ?? []).map((i) => i['id'])).toEqual([c.id, b.id, a.id]);
    });

    it('PATCH/GET/status sobre inexistente => 404 BANNER_NOT_FOUND', async () => {
      const auth = await admin();
      for (const res of [
        await http().get(`/v1/admin/banners/${MISSING}`).set('Authorization', auth).expect(404),
        await http()
          .patch(`/v1/admin/banners/${MISSING}`)
          .set('Authorization', auth)
          .send({ expectedVersion: 1, sortOrder: 1 })
          .expect(404),
        await http()
          .patch(`/v1/admin/banners/${MISSING}/status`)
          .set('Authorization', auth)
          .send({ active: true })
          .expect(404),
      ])
        expect(json(res).code).toBe('BANNER_NOT_FOUND');
    });

    it('BANNERS_BUSY (503) por timeout de la transacción, sin detalles internos', async () => {
      repo.failTransactionWith = Object.assign(new Error('secreto interno: pg timeout'), {
        code: 'P2028',
      });
      const res = await http()
        .post('/v1/admin/banners')
        .set('Authorization', await admin())
        .send(validCreate())
        .expect(503);
      expect(json(res).code).toBe('BANNERS_BUSY');
      expect(JSON.stringify(res.body)).not.toContain('secreto');
    });

    it('error inesperado => 500 genérico sin traza ni mensaje interno', async () => {
      repo.failTransactionWith = new Error('SELECT * FROM app.banners; password=hunter2');
      const res = await http()
        .post('/v1/admin/banners')
        .set('Authorization', await admin())
        .send(validCreate())
        .expect(500);
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|SELECT|stack/);
      expect(json(res).code).toBeUndefined();
    });

    it('límite de escrituras: 30 por minuto por actor', async () => {
      const auth = await admin();
      const b = repo.seed({});
      let last = 200;
      for (let i = 0; i < 31; i += 1)
        last = (
          await http()
            .patch(`/v1/admin/banners/${b.id}/status`)
            .set('Authorization', auth)
            .send({ active: true })
        ).status;
      expect(last).toBe(429);
    });
  });

  describe('alcance por sucursal (IDOR)', () => {
    const scoped = (...ids: string[]) =>
      asStaff(ids.map((branchId) => ({ branchId, permissions: ALL_PERMS })));

    it('empleado de A: crea para A; ALL => 403 BANNER_SCOPE_FORBIDDEN; B => 404 BRANCH_NOT_FOUND', async () => {
      const auth = await scoped(A);
      await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .send(validCreate({ branchScope: 'SELECTED', branchIds: [A] }))
        .expect(201);
      const all = await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .send(validCreate({ code: 'otro-banner' }))
        .expect(403);
      expect(json(all).code).toBe('BANNER_SCOPE_FORBIDDEN');
      const other = await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .send(validCreate({ code: 'otro-mas', branchScope: 'SELECTED', branchIds: [B] }))
        .expect(404);
      expect(json(other).code).toBe('BRANCH_NOT_FOUND');
    });

    it('banner ajeno => 404 igual que inexistente; ALL o compartido => 403 y no se modifica; reordenar => 403', async () => {
      const auth = await scoped(A);
      const foreign = repo.seed({ branchIds: [B] });
      const all = repo.seed();
      const shared = repo.seed({ branchIds: [A, B] });
      for (const url of [`/v1/admin/banners/${foreign.id}`, `/v1/admin/banners/${MISSING}`])
        expect(json(await http().get(url).set('Authorization', auth).expect(404)).code).toBe(
          'BANNER_NOT_FOUND',
        );
      for (const id of [foreign.id, MISSING])
        expect(
          json(
            await http()
              .patch(`/v1/admin/banners/${id}`)
              .set('Authorization', auth)
              .send({ expectedVersion: 1, sortOrder: 5 })
              .expect(404),
          ).code,
        ).toBe('BANNER_NOT_FOUND');
      for (const id of [all.id, shared.id]) {
        expect(
          json(
            await http()
              .patch(`/v1/admin/banners/${id}`)
              .set('Authorization', auth)
              .send({ expectedVersion: 1, sortOrder: 5 })
              .expect(403),
          ).code,
        ).toBe('BANNER_SCOPE_FORBIDDEN');
        await http()
          .patch(`/v1/admin/banners/${id}/status`)
          .set('Authorization', auth)
          .send({ active: false })
          .expect(403);
      }
      expect(repo.banners.get(shared.id)).toMatchObject({ version: 1, active: true });
      const reorder = await http()
        .put('/v1/admin/banners/order')
        .set('Authorization', auth)
        .send({ orderedIds: [all.id] })
        .expect(403);
      expect(json(reorder).code).toBe('BANNER_SCOPE_FORBIDDEN');
    });

    it('listado acotado: los suyos y los de toda la cadena (solo lectura); filtro de otra sucursal => 404', async () => {
      const auth = await scoped(A);
      const all = repo.seed();
      const mine = repo.seed({ branchIds: [A] });
      repo.seed({ branchIds: [B] });
      const res = await http().get('/v1/admin/banners').set('Authorization', auth).expect(200);
      expect((json(res).items ?? []).map((i) => i['id'])).toEqual([all.id, mine.id]);
      expect(json(res).items?.map((i) => i['editable'])).toEqual([false, true]);
      await http().get(`/v1/admin/banners?branchId=${B}`).set('Authorization', auth).expect(404);
    });

    it('permisos con alcances distintos: update solo en A, read global', async () => {
      db.staffUser.findUnique.mockResolvedValue(
        staffRow([
          { branchId: null, permissions: ['banners.read'] },
          { branchId: A, permissions: ['banners.update'] },
        ]),
      );
      const auth = await bearer(AAL2);
      const inA = repo.seed({ branchIds: [A] });
      const inB = repo.seed({ branchIds: [B] });
      const list = await http().get('/v1/admin/banners').set('Authorization', auth).expect(200);
      expect(
        Object.fromEntries((json(list).items ?? []).map((i) => [i['id'], i['editable']])),
      ).toEqual({ [inA.id]: true, [inB.id]: false });
      await http()
        .patch(`/v1/admin/banners/${inA.id}`)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, sortOrder: 2 })
        .expect(200);
      await http()
        .patch(`/v1/admin/banners/${inB.id}`)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, sortOrder: 2 })
        .expect(404);
    });
  });

  describe('listado y detalle', () => {
    it('paginado con filtros y orden; devuelve el resumen sin traducciones', async () => {
      const auth = await admin();
      repo.seed({ es: text({ title: 'Jalapeño' }), sortOrder: 2 });
      repo.seed({ active: false, sortOrder: 1 });
      repo.seed({ endsAt: new Date(NOW.getTime() - 1_000), sortOrder: 0 });
      const all = await http()
        .get('/v1/admin/banners?pageSize=2&page=2')
        .set('Authorization', auth)
        .expect(200);
      expect(all.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(json(all).items).toHaveLength(1);
      expect(json(all).items?.[0]).not.toHaveProperty('translations');
      for (const [qs, n] of [
        ['lifecycle=INACTIVE', 1],
        ['lifecycle=EXPIRED', 1],
        ['lifecycle=PUBLISHED', 1],
        ['q=JALAPENO', 1],
        ['sort=createdAt&order=desc', 3],
      ] as const) {
        const r = await http()
          .get(`/v1/admin/banners?${qs}`)
          .set('Authorization', auth)
          .expect(200);
        expect(json(r).items).toHaveLength(n);
      }
    });

    it('detalle con ambas traducciones y estado derivado; la referencia de promoción no trae el cupón', async () => {
      const promo = repo.seedPromotion(1, { name: 'Verano', active: false });
      const b = repo.seed({ promotionId: promo.id, en: text({ title: 'Summer' }) });
      const res = await http()
        .get(`/v1/admin/banners/${b.id}`)
        .set('Authorization', await admin())
        .expect(200);
      expect(res.body).toMatchObject({
        hasEnglish: true,
        visibleNow: false,
        hiddenReason: 'PROMOTION_NOT_LIVE',
        promotion: { id: promo.id, name: 'Verano', lifecycle: 'INACTIVE' },
        translations: { es: { title: b.es?.title }, en: { title: 'Summer' } },
      });
      expect(Object.keys(json(res)['promotion'] as object).sort()).toEqual([
        'id',
        'lifecycle',
        'name',
      ]);
    });
  });

  it('los logs de aplicación no incluyen textos ni códigos del banner', async () => {
    await http()
      .post('/v1/admin/banners')
      .set('Authorization', await admin())
      .send(
        validCreate({
          code: 'codigo-privado',
          translations: { es: { title: 'TextoPrivado', imageAlt: 'AltPrivado' } },
        }),
      )
      .expect(201);
    expect(logged.join('\n')).not.toMatch(/TextoPrivado|AltPrivado|codigo-privado/);
  });

  it('se usa local() solo para verificar el reloj de pruebas (sin efecto)', () => {
    expect(local('2026-11-16T16:00:00').getTime()).toBe(NOW.getTime());
  });
});
