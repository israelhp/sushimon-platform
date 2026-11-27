import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { bannersHarness, type FakeImageReleaser } from './support/banners-harness.js';
import { assetid, FakeBannersRepo } from './support/fake-banners-repo.js';
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
  imageAssetId: assetid(1),
  imageAlt: 'Roll de salmón',
  ...over,
});

const A = '00000000-0000-4000-8000-0000000000a1';
const ITEM_KEYS = ['active', 'createdAt', 'id', 'image', 'imageAlt', 'updatedAt', 'version'];

describe('Banners simplificados (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  let repo: FakeBannersRepo;
  let releaser: FakeImageReleaser;
  let logged: string[];
  const http = () => request(app.getHttpServer());
  const bearer = async (claims?: Parameters<TestKeys['sign']>[0]) =>
    `Bearer ${await keys.sign(claims)}`;
  const asStaff = async (assignments: Assignment[], claims: Record<string, unknown> = AAL2) => {
    db.staffUser.findUnique.mockResolvedValue(staffRow(assignments));
    return bearer(claims);
  };
  const admin = () => asStaff([{ branchId: null, permissions: ALL_PERMS }]);
  const scoped = () => asStaff([{ branchId: A, permissions: ALL_PERMS }]);

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
    const { AdminMediaService } = await import('../src/media/admin-media.service.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(JWKS_RESOLVER)
      .useValue(keys.jwks)
      .overrideProvider(BannersRepository)
      .useValue(repo)
      .overrideProvider(BannersReadRepository)
      .useValue(repo)
      .overrideProvider(AdminMediaService)
      .useValue(releaser)
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
    releaser = h.releaser;
    app = await createApp();
  });
  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/store/banners (público)', () => {
    it('sin JWT: solo activos, en orden de creación, forma {id, image, alt}, sin datos administrativos', async () => {
      const first = repo.seed({ code: 'secreto-interno', imageAlt: 'Primero' });
      repo.seed({ active: false, imageAlt: 'Oculto' });
      const third = repo.seed({ imageAlt: 'Tercero' });
      const res = await http().get('/v1/store/banners').expect(200);
      expect((json(res).items ?? []).map((i) => i['id'])).toEqual([first.id, third.id]);
      expect(Object.keys(res.body as object)).toEqual(['items']);
      expect(json(res).items?.[0]).toEqual({
        id: first.id,
        image: {
          url: 'https://media.mock.invalid/banners/2026/obj-1.webp',
          mimeType: 'image/webp',
        },
        alt: 'Primero',
      });
      const raw = JSON.stringify(res.body);
      for (const leak of [
        'secreto-interno',
        assetid(1),
        'assetId',
        'objectKey',
        'version',
        'createdAt',
        'sortOrder',
        'locale',
        'cta',
        'Oculto',
      ])
        expect(raw).not.toContain(leak);
    });

    it('máximo 5 aunque haya filas históricas de más', async () => {
      for (let n = 0; n < 8; n += 1) repo.seed();
      const res = await http().get('/v1/store/banners').expect(200);
      expect(json(res).items).toHaveLength(5);
    });

    it('Cache-Control fijo public, max-age=15, s-maxage=30; Vary: Accept-Encoding; sin ETag ni stale-while-revalidate', async () => {
      repo.seed();
      for (const seeded of [true, false]) {
        if (!seeded) repo.banners.clear();
        const res = await http().get('/v1/store/banners').expect(200);
        expect(res.headers['cache-control']).toBe('public, max-age=15, s-maxage=30');
        expect(res.headers['cache-control']).not.toContain('stale-while-revalidate');
        expect(res.headers['vary']).toMatch(/Accept-Encoding/i);
        expect(res.headers['etag']).toBeUndefined();
      }
    });

    it('lista vacía: 200 con items []', async () => {
      const res = await http().get('/v1/store/banners').expect(200);
      expect(res.body).toEqual({ items: [] });
    });

    it('no admite parámetros: locale y branchId (retirados) => 400 sin caché pública', async () => {
      for (const q of ['locale=en', `branchId=${A}`, 'foo=1']) {
        const res = await http().get(`/v1/store/banners?${q}`).expect(400);
        expect(res.headers['cache-control'] ?? '').not.toContain('public');
      }
    });

    it('error de BD de lectura => 503 BANNERS_BUSY sin detalles; inesperado => 500 genérico', async () => {
      repo.failReadWith = Object.assign(new Error('secreto interno: pg timeout'), {
        code: 'P2028',
      });
      const busy = await http().get('/v1/store/banners').expect(503);
      expect(json(busy).code).toBe('BANNERS_BUSY');
      expect(JSON.stringify(busy.body)).not.toContain('secreto');
      expect(busy.headers['cache-control'] ?? '').not.toContain('public');
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
    const OPS: [string, string, Body?][] = [
      ['get', '/v1/admin/banners'],
      ['post', '/v1/admin/banners', validCreate()],
      ['get', `/v1/admin/banners/${MISSING}`],
      ['patch', `/v1/admin/banners/${MISSING}`, { expectedVersion: 1, active: false }],
      ['delete', `/v1/admin/banners/${MISSING}?expectedVersion=1`],
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
      'alcance ACOTADO a una sucursal => 403 genérico sin leer ni escribir (%s %s)',
      async (method, url, body) => {
        const res = await call(method, url, await scoped(), body).expect(403);
        expect(json(res).code).toBeUndefined();
        expect(repo.calls).toEqual([]);
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

    it('cada operación exige SU permiso (read no escribe; update edita y elimina pero no crea ni lista)', async () => {
      const seeded = repo.seed();
      const url = `/v1/admin/banners/${seeded.id}`;
      const readOnly = await asStaff([{ branchId: null, permissions: ['banners.read'] }]);
      await call('get', '/v1/admin/banners', readOnly).expect(200);
      await call('get', url, readOnly).expect(200);
      await call('post', '/v1/admin/banners', readOnly, validCreate()).expect(403);
      await call('patch', url, readOnly, { expectedVersion: 1, active: false }).expect(403);
      await call('delete', `${url}?expectedVersion=1`, readOnly).expect(403);
      const updateOnly = await asStaff([{ branchId: null, permissions: ['banners.update'] }]);
      await call('post', '/v1/admin/banners', updateOnly, validCreate()).expect(403);
      await call('get', '/v1/admin/banners', updateOnly).expect(403);
      await call('patch', url, updateOnly, { expectedVersion: 1, active: false }).expect(200);
      await call('delete', `${url}?expectedVersion=2`, updateOnly).expect(204);
      const createOnly = await asStaff([{ branchId: null, permissions: ['banners.create'] }]);
      await call('post', '/v1/admin/banners', createOnly, validCreate()).expect(201);
      await call('get', '/v1/admin/banners', createOnly).expect(403);
    });

    it('rol sin permisos de banners (p. ej. manager) => 403', async () => {
      const manager = await asStaff([
        { branchId: null, permissions: ['catalog.read', 'orders.read', 'promotions.read'] },
      ]);
      await call('get', '/v1/admin/banners', manager).expect(403);
    });

    it('las rutas retiradas ya no existen (reordenar, estado por endpoint)', async () => {
      const auth = await admin();
      const b = repo.seed();
      await call('put', '/v1/admin/banners/order', auth, { orderedIds: [b.id] }).expect(404);
      await call('patch', `/v1/admin/banners/${b.id}/status`, auth, { active: false }).expect(404);
    });
  });

  describe('validación de forma (400)', () => {
    const post = async (body: Body) =>
      http()
        .post('/v1/admin/banners')
        .set('Authorization', await admin())
        .send(body);

    it('campos faltantes, desconocidos o de tipo incorrecto => 400', async () => {
      for (const body of [
        {},
        validCreate({ imageAssetId: undefined }),
        validCreate({ imageAlt: undefined }),
        validCreate({ imageAssetId: 'no-uuid' }),
        validCreate({ imageAlt: 5 }),
        validCreate({ imageAlt: null }),
        validCreate({ active: 'yes' }),
        validCreate({ code: 'x-abc' }),
        validCreate({ translations: { es: { title: 'T', imageAlt: 'A' } } }),
        validCreate({ cta: { type: 'MENU' } }),
        validCreate({ branchScope: 'ALL' }),
        validCreate({ startsAt: '2026-01-01T00:00:00Z' }),
        validCreate({ sortOrder: 1 }),
        validCreate({ extra: 1 }),
      ])
        await post(body).then((r) =>
          expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]),
        );
      expect(repo.banners.size).toBe(0);
    });

    it('imageAlt fuera de 1..120 => 400; 120 pasa; solo espacios => 422 BANNER_ALT_INVALID', async () => {
      await post(validCreate({ imageAlt: '' })).then((r) => expect(r.status).toBe(400));
      await post(validCreate({ imageAlt: 'a'.repeat(121) })).then((r) =>
        expect(r.status).toBe(400),
      );
      await post(validCreate({ imageAlt: 'a'.repeat(120) })).then((r) =>
        expect(r.status).toBe(201),
      );
      const blank = await post(validCreate({ imageAlt: '   ' }));
      expect(blank.status).toBe(422);
      expect(json(blank).code).toBe('BANNER_ALT_INVALID');
    });

    it('NUL o controles bidi en el alt => 400 (no 500)', async () => {
      for (const imageAlt of ['a\u0000b', 'a‮b'])
        await post(validCreate({ imageAlt })).then((r) => expect(r.status).toBe(400));
    });

    it('__proto__ / constructor en el cuerpo => 400 (middleware existente)', async () => {
      const auth = await admin();
      const res = await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send('{"imageAssetId":"' + assetid(1) + '","imageAlt":"x","__proto__":{"x":1}}');
      expect(res.status).toBe(400);
      expect(repo.banners.size).toBe(0);
    });

    it('PATCH sin expectedVersion, con code/id/sortOrder/translations o tipos malos => 400', async () => {
      const auth = await admin();
      const b = repo.seed();
      for (const body of [
        {},
        { active: false },
        { expectedVersion: 0, active: false },
        { expectedVersion: '1', active: false },
        { expectedVersion: 1.5, active: false },
        { expectedVersion: 1, code: 'otro' },
        { expectedVersion: 1, id: b.id },
        { expectedVersion: 1, sortOrder: 3 },
        { expectedVersion: 1, translations: { es: { imageAlt: 'x' } } },
        { expectedVersion: 1, imageAlt: '' },
        { expectedVersion: 1, imageAlt: 'a'.repeat(121) },
        { expectedVersion: 1, imageAssetId: 'x' },
        { expectedVersion: 1, active: 'no' },
      ])
        await http()
          .patch(`/v1/admin/banners/${b.id}`)
          .set('Authorization', auth)
          .send(body)
          .then((r) =>
            expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]),
          );
      expect(repo.banners.get(b.id)?.version).toBe(1);
    });

    it('DELETE: expectedVersion ausente, no entero o < 1 => 400; UUID mal formado => 400', async () => {
      const auth = await admin();
      const b = repo.seed();
      for (const q of [
        '',
        '?expectedVersion=',
        '?expectedVersion=x',
        '?expectedVersion=0',
        '?expectedVersion=1.5',
        '?expectedVersion=1&extra=1',
      ])
        await http()
          .delete(`/v1/admin/banners/${b.id}${q}`)
          .set('Authorization', auth)
          .then((r) => expect([q, r.status]).toEqual([q, 400]));
      await http()
        .delete('/v1/admin/banners/no-uuid?expectedVersion=1')
        .set('Authorization', auth)
        .expect(400);
      expect(repo.banners.has(b.id)).toBe(true);
    });

    it('GET/PATCH con UUID inválido => 400; el listado no admite parámetros', async () => {
      const auth = await admin();
      await http().get('/v1/admin/banners/no-uuid').set('Authorization', auth).expect(400);
      await http()
        .patch('/v1/admin/banners/no-uuid')
        .set('Authorization', auth)
        .send({ expectedVersion: 1, active: false })
        .expect(400);
      await http().get('/v1/admin/banners?page=1').set('Authorization', auth).expect(400);
    });
  });

  describe('listado y detalle', () => {
    it('lista todos (activos e inactivos) en orden de creación con limit 5; sin campos retirados', async () => {
      const a = repo.seed({ imageAlt: 'Uno' });
      const b = repo.seed({ imageAlt: 'Dos', active: false });
      const res = await http()
        .get('/v1/admin/banners')
        .set('Authorization', await admin())
        .expect(200);
      expect(json(res)['limit']).toBe(5);
      expect((json(res).items ?? []).map((i) => i['id'])).toEqual([a.id, b.id]);
      expect(Object.keys(json(res).items?.[0] ?? {}).sort()).toEqual(ITEM_KEYS);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('detalle y 404 BANNER_NOT_FOUND', async () => {
      const a = repo.seed({ imageAlt: 'Uno' });
      const auth = await admin();
      const res = await http()
        .get(`/v1/admin/banners/${a.id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({ id: a.id, imageAlt: 'Uno', active: true, version: 1 });
      expect((res.body as Body)['image']).toMatchObject({ assetId: assetid(1) });
      const missing = await http()
        .get(`/v1/admin/banners/${MISSING}`)
        .set('Authorization', auth)
        .expect(404);
      expect(json(missing).code).toBe('BANNER_NOT_FOUND');
    });
  });

  describe('escrituras', () => {
    it('POST => 201 con el banner, version 1, auditoría sin PII ni URLs firmadas', async () => {
      const res = await http()
        .post('/v1/admin/banners')
        .set('Authorization', await admin())
        .send(validCreate())
        .expect(201);
      expect(res.body).toMatchObject({ version: 1, active: true, imageAlt: 'Roll de salmón' });
      expect(Object.keys(res.body as object).sort()).toEqual(ITEM_KEYS);
      expect(repo.audit).toHaveLength(1);
      expect(repo.audit[0]).toMatchObject({
        action: 'banner.created',
        actorId: STAFF_ID,
        branchId: null,
      });
      expect(JSON.stringify(repo.audit)).not.toMatch(/X-Amz|Signature|https?:\/\/|Roll de salmón/i);
    });

    it('tope de 5: el 6.º => 409 BANNER_LIMIT_REACHED sin escribir; tras borrar uno se puede crear', async () => {
      const auth = await admin();
      for (let n = 0; n < 5; n += 1)
        await http()
          .post('/v1/admin/banners')
          .set('Authorization', auth)
          .send(validCreate())
          .expect(201);
      const sixth = await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .send(validCreate())
        .expect(409);
      expect(json(sixth).code).toBe('BANNER_LIMIT_REACHED');
      expect(repo.banners.size).toBe(5);
      expect(repo.audit).toHaveLength(5);
      const [first] = [...repo.banners.values()];
      await http()
        .delete(`/v1/admin/banners/${first?.id}?expectedVersion=1`)
        .set('Authorization', auth)
        .expect(204);
      await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .send(validCreate())
        .expect(201);
      expect(repo.banners.size).toBe(5);
    });

    it('tope de 5 en BD (trigger) ante una carrera => 409 BANNER_LIMIT_REACHED', async () => {
      for (let n = 0; n < 5; n += 1) repo.seed();
      repo.countOverride = 4;
      repo.emulateTrigger = true;
      const res = await http()
        .post('/v1/admin/banners')
        .set('Authorization', await admin())
        .send(validCreate())
        .expect(409);
      expect(json(res).code).toBe('BANNER_LIMIT_REACHED');
      expect(repo.banners.size).toBe(5);
    });

    it('422 imagen inválida con las 3 violations; 422 alt en blanco', async () => {
      const auth = await admin();
      repo.seedAsset(2, { status: 'PENDING' });
      repo.seedAsset(3, { kind: 'PRODUCT_IMAGE' });
      const cases: [string, string][] = [
        [assetid(99), 'ASSET_UNKNOWN'],
        [assetid(2), 'ASSET_NOT_READY'],
        [assetid(3), 'ASSET_KIND_MISMATCH'],
      ];
      for (const [imageAssetId, reason] of cases) {
        const res = await http()
          .post('/v1/admin/banners')
          .set('Authorization', auth)
          .send(validCreate({ imageAssetId }))
          .expect(422);
        expect(json(res).code).toBe('BANNER_IMAGE_INVALID');
        expect(json(res).violations).toEqual([
          expect.objectContaining({ path: 'imageAssetId', code: reason }),
        ]);
      }
      const alt = await http()
        .post('/v1/admin/banners')
        .set('Authorization', auth)
        .send(validCreate({ imageAlt: ' \t ' }))
        .expect(422);
      expect(json(alt).code).toBe('BANNER_ALT_INVALID');
      expect(repo.banners.size).toBe(0);
    });

    it('PATCH: edita imagen/alt/activo, version+1; idempotente sin cambios (200, misma versión)', async () => {
      const auth = await admin();
      repo.seedAsset(2);
      const b = repo.seed({ imageAlt: 'Viejo' });
      const url = `/v1/admin/banners/${b.id}`;
      const edited = await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, imageAssetId: assetid(2), imageAlt: 'Nuevo', active: false })
        .expect(200);
      expect(edited.body).toMatchObject({ version: 2, imageAlt: 'Nuevo', active: false });
      expect((edited.body as Body)['image']).toMatchObject({ assetId: assetid(2) });
      expect(repo.audit).toHaveLength(1);
      const same = await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ expectedVersion: 2, imageAlt: 'Nuevo', active: false })
        .expect(200);
      expect(json(same)['version']).toBe(2);
      expect(repo.audit).toHaveLength(1);
      expect(releaser.released).toEqual([]);
    });

    it('PATCH: concurrencia optimista (409 BANNER_VERSION_CONFLICT) sin guardar', async () => {
      const auth = await admin();
      const b = repo.seed();
      const url = `/v1/admin/banners/${b.id}`;
      await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, active: false })
        .expect(200);
      const stale = await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, active: true })
        .expect(409);
      expect(json(stale).code).toBe('BANNER_VERSION_CONFLICT');
      expect(repo.banners.get(b.id)).toMatchObject({ active: false, version: 2 });
    });

    it('PATCH 422 imagen/alt inválidos; 404 inexistente', async () => {
      const auth = await admin();
      repo.seedAsset(2, { kind: 'PRODUCT_IMAGE' });
      const b = repo.seed();
      const url = `/v1/admin/banners/${b.id}`;
      const img = await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, imageAssetId: assetid(2) })
        .expect(422);
      expect(json(img).code).toBe('BANNER_IMAGE_INVALID');
      const alt = await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, imageAlt: '   ' })
        .expect(422);
      expect(json(alt).code).toBe('BANNER_ALT_INVALID');
      const missing = await http()
        .patch(`/v1/admin/banners/${MISSING}`)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, active: false })
        .expect(404);
      expect(json(missing).code).toBe('BANNER_NOT_FOUND');
      expect(repo.banners.get(b.id)?.version).toBe(1);
    });

    it('activar y desactivar se refleja al instante en la lectura pública del origen', async () => {
      const auth = await admin();
      const b = repo.seed();
      const url = `/v1/admin/banners/${b.id}`;
      expect(json(await http().get('/v1/store/banners')).items).toHaveLength(1);
      await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, active: false })
        .expect(200);
      expect(json(await http().get('/v1/store/banners')).items).toEqual([]);
      await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ expectedVersion: 2, active: true })
        .expect(200);
      expect(json(await http().get('/v1/store/banners')).items).toHaveLength(1);
    });

    it('DELETE => 204 sin cuerpo, borrado físico, auditado, y libera la imagen', async () => {
      const auth = await admin();
      const b = repo.seed();
      const res = await http()
        .delete(`/v1/admin/banners/${b.id}?expectedVersion=1`)
        .set('Authorization', auth)
        .expect(204);
      expect(res.text).toBe('');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(repo.banners.has(b.id)).toBe(false);
      expect(repo.audit[0]).toMatchObject({ action: 'banner.deleted', entityId: b.id });
      expect(releaser.released).toEqual([assetid(1)]);
      await http().get(`/v1/admin/banners/${b.id}`).set('Authorization', auth).expect(404);
      expect(json(await http().get('/v1/store/banners')).items).toEqual([]);
    });

    it('DELETE: versión vieja => 409 BANNER_VERSION_CONFLICT sin borrar; repetir tras éxito => 404', async () => {
      const auth = await admin();
      const b = repo.seed();
      const url = `/v1/admin/banners/${b.id}`;
      await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ expectedVersion: 1, active: false })
        .expect(200);
      const stale = await http()
        .delete(`${url}?expectedVersion=1`)
        .set('Authorization', auth)
        .expect(409);
      expect(json(stale).code).toBe('BANNER_VERSION_CONFLICT');
      expect(repo.banners.has(b.id)).toBe(true);
      expect(releaser.released).toEqual([]);
      await http().delete(`${url}?expectedVersion=2`).set('Authorization', auth).expect(204);
      const again = await http()
        .delete(`${url}?expectedVersion=2`)
        .set('Authorization', auth)
        .expect(404);
      expect(json(again).code).toBe('BANNER_NOT_FOUND');
    });

    it('DELETE: si falla el almacenamiento al liberar la imagen responde 204 igual y deja un warning sin datos sensibles', async () => {
      const auth = await admin();
      const b = repo.seed();
      releaser.failWith = Object.assign(new Error('secret-key https://r2.example/bucket'), {
        name: 'S3ServiceException',
        httpStatus: 503,
      });
      await http()
        .delete(`/v1/admin/banners/${b.id}?expectedVersion=1`)
        .set('Authorization', auth)
        .expect(204);
      expect(repo.banners.has(b.id)).toBe(false);
      const log = logged.join('\n');
      expect(log).toContain('no liberada');
      expect(log).not.toMatch(/secret-key|r2\.example/);
    });

    it('BANNERS_BUSY (503) por timeout de la transacción, sin detalles internos', async () => {
      repo.failTransactionWith = Object.assign(new Error('secreto interno: pg timeout'), {
        code: 'P2028',
      });
      const auth = await admin();
      const b = repo.seed();
      for (const res of [
        await http()
          .post('/v1/admin/banners')
          .set('Authorization', auth)
          .send(validCreate())
          .expect(503),
        await http()
          .delete(`/v1/admin/banners/${b.id}?expectedVersion=1`)
          .set('Authorization', auth)
          .expect(503),
      ]) {
        expect(json(res).code).toBe('BANNERS_BUSY');
        expect(JSON.stringify(res.body)).not.toContain('secreto');
      }
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
      const b = repo.seed();
      let last = 200;
      for (let i = 0; i < 31; i += 1)
        last = (
          await http()
            .patch(`/v1/admin/banners/${b.id}`)
            .set('Authorization', auth)
            .send({ expectedVersion: 1, active: true })
        ).status;
      expect(last).toBe(429);
    });
  });

  it('los logs de aplicación no incluyen el texto alternativo del banner', async () => {
    await http()
      .post('/v1/admin/banners')
      .set('Authorization', await admin())
      .send(validCreate({ imageAlt: 'AltPrivado' }))
      .expect(201);
    expect(logged.join('\n')).not.toMatch(/AltPrivado/);
  });
});
