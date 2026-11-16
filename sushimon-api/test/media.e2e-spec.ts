import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FakeMediaRepo } from './support/fake-media-repo.js';
import { FakeModifiersRepo } from './support/fake-modifiers-repo.js';
import { FakeProductsRepo } from './support/fake-products-repo.js';
import { JPEG_HEAD, pngBytes, sha256Hex } from './support/media-harness.js';
import { CAT, pid, productRow, seedCategories } from './support/products-harness.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const ALL_PERMS = ['catalog.read', 'catalog.create', 'catalog.update'];
const MISSING = pid(999);
const R2_SECRET = 'SECRETO-R2-DE-PRUEBA-NO-REAL-0123456789';
const R2_ENV = {
  R2_ACCOUNT_ID: 'cuenta0123456789',
  R2_BUCKET: 'bucket-pruebas',
  R2_ACCESS_KEY_ID: 'AKIAPRUEBAPRUEBA01',
  R2_SECRET_ACCESS_KEY: R2_SECRET,
  R2_PUBLIC_BASE_URL: 'https://cdn.pruebas.example.com',
};
const MEDIA_ENV_KEYS = [
  ...Object.keys(R2_ENV),
  'MEDIA_STORAGE_ADAPTER',
  'MEDIA_MAX_BYTES',
  'MEDIA_UPLOAD_TTL_SECONDS',
  'PRODUCT_MEDIA_ALLOWED_HOSTS',
];

type CategoryRowT = ReturnType<typeof seedCategories>[number];

function fakeDb(categories: CategoryRowT[]) {
  const category = {
    findMany: vi.fn((a: { select?: Record<string, boolean> }) =>
      Promise.resolve(
        [...categories]
          .sort(
            (x, y) =>
              x.sortOrder - y.sortOrder || x.name.localeCompare(y.name) || x.id.localeCompare(y.id),
          )
          .map((r) =>
            a.select
              ? Object.fromEntries(
                  Object.keys(a.select).map((k) => [k, r[k as keyof CategoryRowT]]),
                )
              : { ...r },
          ),
      ),
    ),
  };
  const db = {
    category,
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

function staffRow(assignments: { branchId: string | null; permissions: string[] }[]) {
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

type Bag = Record<string, unknown>;

describe('Medios en R2 (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  let products: FakeProductsRepo;
  let media: FakeMediaRepo;
  let logged: string[];
  let storage: {
    mode: string;
    objects?: Map<string, unknown>;
    simulateUpload?: (k: string, b: Uint8Array, c: string) => void;
    headObject: (k: string) => Promise<unknown>;
    readRange: (k: string, n: number) => Promise<unknown>;
    deleteObject: (k: string) => Promise<void>;
    presignPut: (...a: unknown[]) => Promise<unknown>;
  };
  const http = () => request(app.getHttpServer());
  const bearer = async (claims?: Parameters<TestKeys['sign']>[0]) =>
    `Bearer ${await keys.sign(claims)}`;
  const asStaff = async (
    over: { permissions?: string[]; branchId?: string | null } = {},
    claims: Record<string, unknown> = AAL2,
  ) => {
    db.staffUser.findUnique.mockResolvedValue(
      staffRow([{ branchId: over.branchId ?? null, permissions: over.permissions ?? ALL_PERMS }]),
    );
    return bearer(claims);
  };

  async function createApp(env: Record<string, string | undefined>) {
    for (const k of MEDIA_ENV_KEYS) delete process.env[k];
    Object.assign(process.env, {
      SUPABASE_URL: 'http://127.0.0.1:54341',
      HEALTH_READY_TOKEN: 'token-e2e-123456789',
      RATE_LIMIT_MAX: '1000',
    });
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    vi.resetModules();
    const { AppModule } = await import('../src/app.module.js');
    const { configureApp } = await import('../src/app.setup.js');
    const { PrismaService } = await import('../src/database/prisma.service.js');
    const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
    const { ProductsRepository } = await import('../src/products/products.repository.js');
    const { ModifiersRepository } = await import('../src/modifiers/modifiers.repository.js');
    const { MediaRepository } = await import('../src/media/media.repository.js');
    const { MEDIA_STORAGE_PORT } = await import('../src/media/media-storage.port.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(JWKS_RESOLVER)
      .useValue(keys.jwks)
      .overrideProvider(ProductsRepository)
      .useValue(products)
      .overrideProvider(ModifiersRepository)
      .useValue(new FakeModifiersRepo())
      .overrideProvider(MediaRepository)
      .useValue(media)
      .compile();
    const instance = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(instance, { corsOrigins: ['http://localhost:3000'] });
    await instance.init();
    storage = instance.get(MEDIA_STORAGE_PORT);
    return instance;
  }

  /** Un intent válido + el PUT simulado del navegador. */
  async function intentFor(auth: string, bytes: Uint8Array, mimeType = 'image/png') {
    const res = await http()
      .post('/v1/admin/media/upload-intents')
      .set('Authorization', auth)
      .send({
        kind: 'PRODUCT_IMAGE',
        mimeType,
        sizeBytes: bytes.length,
        checksumSha256: sha256Hex(bytes),
      });
    return res;
  }
  async function upload(auth: string, bytes = pngBytes(1), mimeType = 'image/png') {
    const res = await intentFor(auth, bytes, mimeType).then((r) => {
      expect(r.status).toBe(201);
      return r;
    });
    const asset = media.assets.get((res.body as Bag)['assetId'] as string);
    storage.simulateUpload?.(asset?.objectKey as string, bytes, mimeType);
    return res.body as Bag;
  }
  const complete = (auth: string, assetId: string) =>
    http().post('/v1/admin/media/complete').set('Authorization', auth).send({ assetId });
  async function ready(auth: string, seed = 1) {
    const intent = await upload(auth, pngBytes(seed));
    await complete(auth, intent['assetId'] as string).expect(200);
    return intent['assetId'] as string;
  }

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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
    products = new FakeProductsRepo();
    for (const c of seedCategories()) products.categories.set(c.id, { id: c.id, active: c.active });
    products.seed(
      productRow(pid(1), {
        name: 'Roll California',
        slug: 'roll-california',
        categoryId: CAT.frios,
      }),
    );
    products.seed(
      productRow(pid(2), { name: 'Roll Vegano', slug: 'roll-vegano', categoryId: CAT.frios }),
    );
    media = new FakeMediaRepo();
    products.assetSource = () => media.assets.values();
    media.usageOf = (assetId) =>
      [...products.media.values()]
        .flat()
        .filter((m) => m.assetId === assetId)
        .map((m) => ({
          productId: m.productId,
          productName: products.products.get(m.productId)?.name ?? '',
          productMediaId: m.id,
        }));
    app = await createApp({ MEDIA_STORAGE_ADAPTER: 'mock' });
  });
  afterEach(async () => {
    await app.close();
    for (const k of MEDIA_ENV_KEYS) delete process.env[k];
    vi.restoreAllMocks();
  });

  describe('autenticación y autorización', () => {
    const routes: [string, string, Bag | undefined][] = [
      ['post', '/v1/admin/media/upload-intents', {}],
      ['post', '/v1/admin/media/complete', {}],
      ['get', '/v1/admin/media', undefined],
      ['get', `/v1/admin/media/${pid(1)}`, undefined],
      ['delete', `/v1/admin/media/${pid(1)}`, undefined],
      ['post', `/v1/admin/products/${pid(1)}/media`, {}],
      ['put', `/v1/admin/products/${pid(1)}/media/order`, { orderedIds: [] }],
      ['patch', `/v1/admin/products/${pid(1)}/media/${pid(5)}`, { altText: 'x' }],
      ['delete', `/v1/admin/products/${pid(1)}/media/${pid(5)}`, undefined],
    ];
    const call = (method: string, path: string, body: Bag | undefined, auth?: string) => {
      let req = (http() as unknown as Record<string, (p: string) => request.Test>)[method]!(path);
      if (auth) req = req.set('Authorization', auth);
      return body === undefined ? req : req.send(body);
    };

    it('sin JWT o con firma ajena => 401 en las 9 operaciones', async () => {
      for (const [m, p, b] of routes) await call(m, p, b).expect(401);
      const foreign = `Bearer ${await keys.signWithForeignKey()}`;
      for (const [m, p, b] of routes) await call(m, p, b, foreign).expect(401);
    });

    it('cliente (no personal) => 403 genérico', async () => {
      for (const [m, p, b] of routes) {
        const res = await call(m, p, b, await bearer(AAL2)).expect(403);
        expect((res.body as Bag)['message']).toBe('Acceso denegado');
      }
    });

    it('personal con permiso pero aal1 => 403 MFA_REQUIRED sin tocar nada', async () => {
      const auth = await asStaff({}, {});
      for (const [m, p, b] of routes) {
        const res = await call(m, p, b, auth).expect(403);
        expect((res.body as Bag)['message']).toBe('MFA_REQUIRED');
      }
      expect(media.calls).toEqual([]);
      expect(products.calls).toEqual([]);
    });

    it('catalog.read basta para leer (lista y detalle) pero no para escribir; catalog.update no lee', async () => {
      const readOnly = await asStaff({ permissions: ['catalog.read'] });
      await call('get', '/v1/admin/media', undefined, readOnly).expect(200);
      await call('get', `/v1/admin/media/${MISSING}`, undefined, readOnly).expect(404);
      for (const [m, p, b] of routes.filter(([m, p]) => !(m === 'get' && p.includes('/media'))))
        await call(m, p, b, readOnly).expect(403);
      const onlyUpdate = await asStaff({ permissions: ['catalog.update'] });
      await call('get', '/v1/admin/media', undefined, onlyUpdate).expect(403);
    });

    it('alcance solo por sucursal: lee, pero TODA escritura => 403 antes de leer o escribir', async () => {
      const auth = await asStaff({ branchId: '00000000-0000-4000-8000-000000000500' });
      await call('get', '/v1/admin/media', undefined, auth).expect(200);
      media.calls.length = 0;
      products.calls.length = 0;
      const writes: [string, string, Bag | undefined][] = [
        [
          'post',
          '/v1/admin/media/upload-intents',
          {
            kind: 'PRODUCT_IMAGE',
            mimeType: 'image/png',
            sizeBytes: 5,
            checksumSha256: 'a'.repeat(64),
          },
        ],
        ['post', '/v1/admin/media/complete', { assetId: MISSING }],
        ['delete', `/v1/admin/media/${MISSING}`, undefined],
        ['post', `/v1/admin/products/${MISSING}/media`, { assetId: MISSING }],
        ['put', `/v1/admin/products/${MISSING}/media/order`, { orderedIds: [] }],
        ['patch', `/v1/admin/products/${MISSING}/media/${MISSING}`, { altText: 'x' }],
        ['delete', `/v1/admin/products/${MISSING}/media/${MISSING}`, undefined],
      ];
      for (const [m, p, b] of writes) {
        const res = await call(m, p, b, auth).expect(403); // 403 antes que 404/422
        expect((res.body as Bag)['message']).toBe('Acceso denegado');
      }
      expect(media.calls).toEqual([]);
      expect(products.calls).toEqual([]);
      expect(media.audit).toEqual([]);
      expect(products.audit).toEqual([]);
    });
  });

  describe('validación de forma (400)', () => {
    it('intent: kind fuera del enum, sizeBytes no entero o < 1, checksum fuera de forma, propiedades desconocidas o faltantes', async () => {
      const auth = await asStaff();
      const ok = {
        kind: 'PRODUCT_IMAGE',
        mimeType: 'image/png',
        sizeBytes: 5,
        checksumSha256: 'a'.repeat(64),
      };
      for (const bad of [
        { ...ok, kind: 'BANNER' },
        { ...ok, sizeBytes: 0 },
        { ...ok, sizeBytes: 1.5 },
        { ...ok, sizeBytes: '5' },
        { ...ok, checksumSha256: 'A'.repeat(64) },
        { ...ok, checksumSha256: 'a'.repeat(63) },
        { ...ok, extra: 1 },
        { ...ok, mimeType: undefined },
        { ...ok, mimeType: 'x'.repeat(101) },
      ]) {
        await http()
          .post('/v1/admin/media/upload-intents')
          .set('Authorization', auth)
          .send(bad)
          .expect(400);
      }
      expect(media.assets.size).toBe(0);
    });

    it('UUID mal formado en rutas y cuerpos, filtros y paginación fuera de rango => 400', async () => {
      const auth = await asStaff();
      await http().get('/v1/admin/media/no-uuid').set('Authorization', auth).expect(400);
      await http().delete('/v1/admin/media/no-uuid').set('Authorization', auth).expect(400);
      await http()
        .post('/v1/admin/media/complete')
        .set('Authorization', auth)
        .send({ assetId: 'x' })
        .expect(400);
      await http()
        .post('/v1/admin/media/complete')
        .set('Authorization', auth)
        .send({ assetId: MISSING, x: 1 })
        .expect(400);
      await http()
        .post(`/v1/admin/products/${pid(1)}/media`)
        .set('Authorization', auth)
        .send({})
        .expect(400);
      await http()
        .patch(`/v1/admin/products/${pid(1)}/media/${pid(5)}`)
        .set('Authorization', auth)
        .send({})
        .expect(400);
      await http()
        .put(`/v1/admin/products/${pid(1)}/media/order`)
        .set('Authorization', auth)
        .send({ orderedIds: Array.from({ length: 9 }, (_, i) => pid(i + 1)) })
        .expect(400);
      await http()
        .put(`/v1/admin/products/${pid(1)}/media/order`)
        .set('Authorization', auth)
        .send({ orderedIds: ['x'] })
        .expect(400);
      for (const q of [
        'kind=X',
        'status=DONE',
        'unreferenced=maybe',
        'page=201',
        'page=0',
        'pageSize=101',
      ])
        await http().get(`/v1/admin/media?${q}`).set('Authorization', auth).expect(400);
    });
  });

  describe('intent de subida', () => {
    it('201: PENDING, clave inmutable, URL/headers firmados, no-store y sin fugas a la BD ni a los logs', async () => {
      const auth = await asStaff();
      const bytes = pngBytes(2);
      const res = await intentFor(auth, bytes).then((r) => r);
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.body as Bag;
      expect(body).toMatchObject({ deduplicated: false, storageMode: 'MOCK' });
      expect(body['headers']).toMatchObject({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      expect(String(body['uploadUrl'])).toContain('.invalid');
      const asset = body['asset'] as Bag;
      expect(asset).toMatchObject({
        status: 'PENDING',
        url: null,
        usageCount: 0,
        mimeType: 'image/png',
      });
      expect(JSON.stringify(body)).not.toMatch(/objectKey|bucket|createdByStaff/);
      const row = media.assets.get(body['assetId'] as string);
      expect(row?.objectKey).toMatch(/^products\/\d{4}\/[0-9a-f-]{36}\.png$/);
      const sink =
        JSON.stringify([...media.assets.values()]) +
        JSON.stringify(media.audit) +
        logged.join('\n');
      expect(sink).not.toContain(body['uploadUrl'] as string);
      expect(media.audit.map((a) => a['action'])).toEqual(['media.upload_intent_created']);
    });

    it('archivo no permitido => 422 MEDIA_TYPE_NOT_ALLOWED (SVG, GIF, HTML) sin crear nada', async () => {
      const auth = await asStaff();
      for (const mimeType of [
        'image/svg+xml',
        'image/gif',
        'text/html',
        'application/octet-stream',
      ]) {
        const res = await intentFor(auth, pngBytes(), mimeType).then((r) => r);
        expect(res.status).toBe(422);
        expect((res.body as Bag)['code']).toBe('MEDIA_TYPE_NOT_ALLOWED');
      }
      expect(media.assets.size).toBe(0);
    });

    it('tamaño excedido => 422 MEDIA_TOO_LARGE (5 MiB + 1); exactamente 5 MiB pasa', async () => {
      const auth = await asStaff();
      const send = (sizeBytes: number) =>
        http()
          .post('/v1/admin/media/upload-intents')
          .set('Authorization', auth)
          .send({
            kind: 'PRODUCT_IMAGE',
            mimeType: 'image/png',
            sizeBytes,
            checksumSha256: 'b'.repeat(64),
          });
      const big = await send(5_242_881);
      expect(big.status).toBe(422);
      expect((big.body as Bag)['code']).toBe('MEDIA_TOO_LARGE');
      expect((await send(5_242_880)).status).toBe(201);
    });

    it('límite de PENDING por empleado => 422 MEDIA_PENDING_LIMIT_REACHED', async () => {
      const auth = await asStaff();
      for (let i = 0; i < 50; i++) {
        media.seed({
          id: `p${i}`,
          status: 'PENDING',
          confirmedAt: null,
          createdByStaffId: STAFF_ID,
          expiresAt: new Date(Date.now() + 60_000),
          checksumSha256: String(i).padStart(64, 'e'),
        });
      }
      const res = await intentFor(auth, pngBytes(5)).then((r) => r);
      expect(res.status).toBe(422);
      expect((res.body as Bag)['code']).toBe('MEDIA_PENDING_LIMIT_REACHED');
    });

    it('dedup: segundo intent con el mismo contenido => 200 deduplicated sin uploadUrl, headers ni expiresAt', async () => {
      const auth = await asStaff();
      const id = await ready(auth, 7);
      const res = await intentFor(auth, pngBytes(7)).then((r) => r);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        assetId: id,
        deduplicated: true,
        uploadUrl: null,
        headers: null,
        expiresAt: null,
        asset: { status: 'READY' },
      });
      expect(media.assets.size).toBe(1);
    });
  });

  describe('confirmación', () => {
    it('200 con url pública estable (nunca firmada); idempotente al repetir', async () => {
      const auth = await asStaff();
      const intent = await upload(auth, pngBytes(3));
      const id = intent['assetId'] as string;
      const res = await complete(auth, id);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.body as Bag;
      expect(body).toMatchObject({ id, status: 'READY', expiresAt: null, storageMode: 'MOCK' });
      expect(body['url']).toBe(`https://media.mock.invalid/${media.assets.get(id)?.objectKey}`);
      expect(String(body['url'])).not.toMatch(/X-Amz|\?/);
      expect(body['confirmedAt']).not.toBeNull();
      const again = await complete(auth, id).expect(200);
      expect(again.body).toEqual(res.body);
      expect(media.audit.filter((a) => a['action'] === 'media.confirmed')).toHaveLength(1);
    });

    it('asset inexistente => 404 MEDIA_NOT_FOUND', async () => {
      const res = await complete(await asStaff(), MISSING).expect(404);
      expect((res.body as Bag)['code']).toBe('MEDIA_NOT_FOUND');
    });

    it('subida incompleta (objeto inexistente) => 422 MEDIA_OBJECT_MISSING y sigue PENDING; tras subir, se confirma', async () => {
      const auth = await asStaff();
      const res = await intentFor(auth, pngBytes(4)).then((r) => r);
      const id = (res.body as Bag)['assetId'] as string;
      const miss = await complete(auth, id).expect(422);
      expect((miss.body as Bag)['code']).toBe('MEDIA_OBJECT_MISSING');
      expect(media.assets.get(id)?.status).toBe('PENDING');
      storage.simulateUpload?.(media.assets.get(id)?.objectKey as string, pngBytes(4), 'image/png');
      await complete(auth, id).expect(200);
    });

    it('intent expirado => 410 MEDIA_UPLOAD_EXPIRED', async () => {
      const auth = await asStaff();
      const intent = await upload(auth, pngBytes(5));
      const id = intent['assetId'] as string;
      const row = media.assets.get(id)!;
      media.assets.set(id, { ...row, expiresAt: new Date(Date.now() - 1000) });
      const res = await complete(auth, id).expect(410);
      expect((res.body as Bag)['code']).toBe('MEDIA_UPLOAD_EXPIRED');
    });

    it('MIME falso: HTML declarado como image/png (tamaño y checksum correctos) => 422 MEDIA_CONTENT_MISMATCH, objeto borrado y asset no confirmable', async () => {
      const auth = await asStaff();
      const html = new TextEncoder().encode('<html><body><script>alert(1)</script></body></html>');
      const intent = await upload(auth, html, 'image/png');
      const id = intent['assetId'] as string;
      const key = media.assets.get(id)?.objectKey as string;
      const res = await complete(auth, id).expect(422);
      expect((res.body as Bag)['code']).toBe('MEDIA_CONTENT_MISMATCH');
      expect(storage.objects?.has(key)).toBe(false);
      expect(media.audit.some((a) => a['action'] === 'media.rejected')).toBe(true);
      // la fila queda PENDING y caducada (la purga la elimina tras el margen): ya no se puede confirmar
      expect(media.assets.get(id)?.status).toBe('PENDING');
      const again = await complete(auth, id).expect(410);
      expect((again.body as Bag)['code']).toBe('MEDIA_UPLOAD_EXPIRED');
    });

    it('JPEG real declarado como image/png => 422 MEDIA_CONTENT_MISMATCH (firma != MIME declarado)', async () => {
      const auth = await asStaff();
      const jpeg = Uint8Array.from([...JPEG_HEAD, ...Array.from({ length: 60 }, (_, i) => i)]);
      const id = (await upload(auth, jpeg, 'image/png'))['assetId'] as string;
      const res = await complete(auth, id).expect(422);
      expect((res.body as Bag)['code']).toBe('MEDIA_CONTENT_MISMATCH');
    });

    it('dos subidas del mismo contenido: la segunda en confirmarse reutiliza el asset READY y se elimina', async () => {
      const auth = await asStaff();
      const a = await upload(auth, pngBytes(8));
      const b = await upload(auth, pngBytes(8)); // ambos PENDING con el mismo checksum
      const first = await complete(auth, a['assetId'] as string).expect(200);
      const second = await complete(auth, b['assetId'] as string).expect(200);
      expect((second.body as Bag)['id']).toBe((first.body as Bag)['id']);
      expect(media.assets.has(b['assetId'] as string)).toBe(false);
      expect(media.assets.size).toBe(1);
    });
  });

  describe('biblioteca (lista y detalle)', () => {
    it('lista paginada con filtros, usageCount agregado en una sola consulta y orden createdAt desc', async () => {
      const auth = await asStaff();
      const a = await ready(auth, 11);
      const b = await ready(auth, 12);
      media.seed({
        id: 'pend',
        status: 'PENDING',
        confirmedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        checksumSha256: 'f'.repeat(64),
      });
      await http()
        .post(`/v1/admin/products/${pid(1)}/media`)
        .set('Authorization', auth)
        .send({ assetId: a })
        .expect(201);
      media.calls.length = 0;
      const all = await http().get('/v1/admin/media').set('Authorization', auth).expect(200);
      expect(all.headers['cache-control']).toBe('no-store');
      expect(media.calls).toEqual(['findPage']); // una sola consulta, sin N+1 ni R2
      const body = all.body as { items: Bag[]; total: number; page: number; pageSize: number };
      expect(body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
      expect(body.items.find((i) => i['id'] === a)?.['usageCount']).toBe(1);
      expect(body.items.find((i) => i['id'] === b)?.['usageCount']).toBe(0);
      const unref = await http()
        .get('/v1/admin/media?unreferenced=true&status=READY')
        .set('Authorization', auth)
        .expect(200);
      expect((unref.body as { items: Bag[] }).items.map((i) => i['id'])).toEqual([b]);
      const used = await http()
        .get('/v1/admin/media?unreferenced=false')
        .set('Authorization', auth)
        .expect(200);
      expect((used.body as { items: Bag[] }).items.map((i) => i['id'])).toEqual([a]);
      const pending = await http()
        .get('/v1/admin/media?status=PENDING')
        .set('Authorization', auth)
        .expect(200);
      expect((pending.body as { items: Bag[] }).items[0]).toMatchObject({ id: 'pend', url: null });
      const paged = await http()
        .get('/v1/admin/media?pageSize=1&page=2')
        .set('Authorization', auth)
        .expect(200);
      expect(paged.body).toMatchObject({ total: 3, page: 2, pageSize: 1 });
      expect((paged.body as { items: Bag[] }).items).toHaveLength(1);
    });

    it('detalle con usos; 404 MEDIA_NOT_FOUND', async () => {
      const auth = await asStaff();
      const a = await ready(auth, 13);
      await http()
        .post(`/v1/admin/products/${pid(1)}/media`)
        .set('Authorization', auth)
        .send({ assetId: a })
        .expect(201);
      await http()
        .post(`/v1/admin/products/${pid(2)}/media`)
        .set('Authorization', auth)
        .send({ assetId: a })
        .expect(201);
      const res = await http().get(`/v1/admin/media/${a}`).set('Authorization', auth).expect(200);
      const body = res.body as { usages: Bag[]; usageCount: number };
      expect(body.usageCount).toBe(2);
      expect(body.usages.map((u) => u['productName']).sort()).toEqual([
        'Roll California',
        'Roll Vegano',
      ]);
      expect(body.usages[0]).toHaveProperty('productMediaId');
      const nf = await http()
        .get(`/v1/admin/media/${MISSING}`)
        .set('Authorization', auth)
        .expect(404);
      expect((nf.body as Bag)['code']).toBe('MEDIA_NOT_FOUND');
    });
  });

  describe('imágenes de producto', () => {
    const base = (p = pid(1)) => `/v1/admin/products/${p}/media`;

    it('adjuntar, reordenar, reemplazar y desvincular el flujo completo (ids, orden y URL públicas)', async () => {
      const auth = await asStaff();
      const [a, b, c] = [await ready(auth, 21), await ready(auth, 22), await ready(auth, 23)];
      const m1 = (
        await http()
          .post(base())
          .set('Authorization', auth)
          .send({ assetId: a, altText: 'Frente' })
          .expect(201)
      ).body as Bag;
      expect(m1).toMatchObject({ sortOrder: 0, assetId: a, altText: 'Frente' });
      expect(String(m1['url'])).toMatch(/^https:\/\/media\.mock\.invalid\/products\//);
      const m2 = (
        await http().post(base()).set('Authorization', auth).send({ assetId: b }).expect(201)
      ).body as Bag;
      const m3 = (
        await http().post(base()).set('Authorization', auth).send({ assetId: c }).expect(201)
      ).body as Bag;
      expect([m2['sortOrder'], m3['sortOrder']]).toEqual([1, 2]);

      const reordered = await http()
        .put(`${base()}/order`)
        .set('Authorization', auth)
        .send({ orderedIds: [m3['id'], m1['id'], m2['id']] })
        .expect(200);
      expect(reordered.headers['cache-control']).toBe('no-store');
      expect(
        (reordered.body as { items: Bag[] }).items.map((i) => [i['id'], i['sortOrder']]),
      ).toEqual([
        [m3['id'], 0],
        [m1['id'], 1],
        [m2['id'], 2],
      ]);
      await http()
        .put(`${base()}/order`)
        .set('Authorization', auth)
        .send({ orderedIds: [m3['id'], m1['id'], m2['id']] })
        .expect(200); // idempotente
      expect(products.audit.filter((x) => x['action'] === 'product.media_reordered')).toHaveLength(
        1,
      );

      const mismatch = await http()
        .put(`${base()}/order`)
        .set('Authorization', auth)
        .send({ orderedIds: [m3['id'], m1['id']] })
        .expect(422);
      expect((mismatch.body as Bag)['code']).toBe('MEDIA_REORDER_MISMATCH');

      const alt = await http()
        .patch(`${base()}/${String(m1['id'])}`)
        .set('Authorization', auth)
        .send({ altText: 'Perfil' })
        .expect(200);
      expect(alt.body).toMatchObject({ id: m1['id'], altText: 'Perfil', sortOrder: 1 });

      // reemplazar: PATCH del producto con la lista (URL públicas de assets READY => se enlazan por asset_id)
      const urlOf = (id: string) => `https://media.mock.invalid/${media.assets.get(id)?.objectKey}`;
      const replaced = await http()
        .patch(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', auth)
        .send({ media: [{ url: urlOf(b), altText: 'B' }, { url: urlOf(a) }] })
        .expect(200);
      expect(
        (replaced.body as { media: Bag[] }).media.map((m) => [m['assetId'], m['sortOrder']]),
      ).toEqual([
        [b, 0],
        [a, 1],
      ]);

      const pm = (replaced.body as { media: Bag[] }).media;
      await http()
        .delete(`${base()}/${String(pm[0]!['id'])}`)
        .set('Authorization', auth)
        .expect(204);
      const left = products.media.get(pid(1)) ?? [];
      expect(left.map((m) => [m.assetId, m.sortOrder])).toEqual([[a, 0]]);
      expect(media.assets.has(b)).toBe(true); // desvincular NO borra el asset
      expect(storage.objects?.size).toBe(3);
      const trail = products.audit.map((x) => x['action']);
      expect(trail).toContain('product.media_attached');
      expect(trail).toContain('product.media_detached');
    });

    it('errores: asset PENDING 422, duplicado 409, inexistentes 404, tope de 8 => 422 PRODUCT_MEDIA_INVALID', async () => {
      const auth = await asStaff();
      const intent = await upload(auth, pngBytes(31));
      const pending = await http()
        .post(base())
        .set('Authorization', auth)
        .send({ assetId: intent['assetId'] })
        .expect(422);
      expect((pending.body as Bag)['code']).toBe('MEDIA_ASSET_NOT_READY');
      const a = await ready(auth, 32);
      await http().post(base()).set('Authorization', auth).send({ assetId: a }).expect(201);
      const dup = await http()
        .post(base())
        .set('Authorization', auth)
        .send({ assetId: a })
        .expect(409);
      expect((dup.body as Bag)['code']).toBe('MEDIA_ALREADY_ATTACHED');
      expect(
        (
          (
            await http()
              .post(base())
              .set('Authorization', auth)
              .send({ assetId: MISSING })
              .expect(404)
          ).body as Bag
        )['code'],
      ).toBe('MEDIA_NOT_FOUND');
      expect(
        (
          (
            await http()
              .post(base(MISSING))
              .set('Authorization', auth)
              .send({ assetId: a })
              .expect(404)
          ).body as Bag
        )['code'],
      ).toBe('PRODUCT_NOT_FOUND');
      expect(
        (
          (
            await http()
              .patch(`${base()}/${MISSING}`)
              .set('Authorization', auth)
              .send({ altText: 'x' })
              .expect(404)
          ).body as Bag
        )['code'],
      ).toBe('PRODUCT_MEDIA_NOT_FOUND');
      expect(
        (
          (await http().delete(`${base()}/${MISSING}`).set('Authorization', auth).expect(404))
            .body as Bag
        )['code'],
      ).toBe('PRODUCT_MEDIA_NOT_FOUND');
      expect(
        (
          (
            await http()
              .put(`${base(MISSING)}/order`)
              .set('Authorization', auth)
              .send({ orderedIds: [] })
              .expect(404)
          ).body as Bag
        )['code'],
      ).toBe('PRODUCT_NOT_FOUND');
      for (let i = 0; i < 7; i++) {
        await http()
          .post(base())
          .set('Authorization', auth)
          .send({ assetId: await ready(auth, 40 + i) })
          .expect(201);
      }
      const ninth = await http()
        .post(base())
        .set('Authorization', auth)
        .send({ assetId: await ready(auth, 60) })
        .expect(422);
      expect((ninth.body as Bag)['code']).toBe('PRODUCT_MEDIA_INVALID');
      const longAlt = await http()
        .patch(`${base()}/${products.media.get(pid(1))![0]!.id}`)
        .set('Authorization', auth)
        .send({ altText: 'x'.repeat(201) })
        .expect(422);
      expect((longAlt.body as Bag)['code']).toBe('PRODUCT_MEDIA_INVALID');
    });

    it('PATCH media con una URL de R2 sin asset READY => 422 PRODUCT_MEDIA_INVALID con path media[i].url', async () => {
      const auth = await asStaff();
      const res = await http()
        .patch(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', auth)
        .send({ media: [{ url: 'https://media.mock.invalid/products/2026/inventada.png' }] })
        .expect(422);
      expect(res.body).toMatchObject({
        code: 'PRODUCT_MEDIA_INVALID',
        violations: [{ path: 'media[0].url' }],
      });
    });

    it('PATCH media con una URL bajo el host de R2 con puerto, query, hash, mayúsculas en la clave o clave inexistente => 422', async () => {
      const auth = await asStaff();
      const a = await ready(auth, 55);
      const key = media.assets.get(a)?.objectKey as string;
      const host = 'https://media.mock.invalid';
      for (const bad of [
        `https://media.mock.invalid:8443/${key}`,
        `${host}/${key}?v=1`,
        `${host}/${key}#x`,
        `${host}/${key.toUpperCase()}`,
        `${host}/${key}/`,
        `${host}/products/2026/../2026/otra-clave.png`,
        `${host}//${key}`,
      ]) {
        const res = await http()
          .patch(`/v1/admin/products/${pid(1)}`)
          .set('Authorization', auth)
          .send({ media: [{ url: bad }] });
        expect([bad, res.status, (res.body as Bag)['code']]).toEqual([
          bad,
          422,
          'PRODUCT_MEDIA_INVALID',
        ]);
      }
      expect(products.media.get(pid(1))).toEqual([]);
      // la URL exacta sí enlaza, y el host en mayúsculas se normaliza a la misma URL pública
      const ok = await http()
        .patch(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', auth)
        .send({ media: [{ url: `https://MEDIA.MOCK.INVALID/${key}` }] })
        .expect(200);
      expect((ok.body as { media: Bag[] }).media[0]).toMatchObject({ assetId: a });
    });

    it('la ficha y la lista públicas de F11 siguen devolviendo media[{url,altText}] con URL de R2', async () => {
      const auth = await asStaff();
      const a = await ready(auth, 71);
      const att = (
        await http()
          .post(base())
          .set('Authorization', auth)
          .send({ assetId: a, altText: 'Roll' })
          .expect(201)
      ).body as Bag;
      const stored = products.media.get(pid(1))?.[0];
      expect(stored?.url).toBe(att['url']);
      expect(stored?.assetId).toBe(a);
      const list = await http().get('/v1/store/products').expect(200);
      const item = (list.body as { items: Bag[] }).items.find((i) => i['id'] === pid(1));
      expect(item?.['media']).toEqual([{ url: att['url'], altText: 'Roll' }]);
      expect(JSON.stringify(list.body)).not.toContain('assetId');
      const detail = await http().get('/v1/store/products/roll-california').expect(200);
      expect((detail.body as Bag)['media']).toEqual([{ url: att['url'], altText: 'Roll' }]);
    });

    it('el detalle admin del producto incluye assetId (null para URL externas)', async () => {
      const auth = await asStaff();
      const a = await ready(auth, 72);
      await http().post(base()).set('Authorization', auth).send({ assetId: a }).expect(201);
      products.media.set(pid(2), [
        {
          id: 'm-ext',
          productId: pid(2),
          url: 'https://otro.ejemplo.org/x.png',
          altText: null,
          sortOrder: 0,
          assetId: null,
        },
      ]);
      const mine = await http()
        .get(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', auth)
        .expect(200);
      expect((mine.body as { media: Bag[] }).media[0]).toMatchObject({ assetId: a, sortOrder: 0 });
      const ext = await http()
        .get(`/v1/admin/products/${pid(2)}`)
        .set('Authorization', auth)
        .expect(200);
      expect((ext.body as { media: Bag[] }).media[0]).toMatchObject({ assetId: null });
    });
  });

  describe('borrado seguro', () => {
    it('204 elimina fila (auditada) y objeto; repetir => 404 sin efectos', async () => {
      const auth = await asStaff();
      const id = await ready(auth, 81);
      const key = media.assets.get(id)?.objectKey as string;
      const res = await http()
        .delete(`/v1/admin/media/${id}`)
        .set('Authorization', auth)
        .expect(204);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(media.assets.has(id)).toBe(false);
      expect(storage.objects?.has(key)).toBe(false);
      expect(media.audit.some((a) => a['action'] === 'media.deleted')).toBe(true);
      const again = await http()
        .delete(`/v1/admin/media/${id}`)
        .set('Authorization', auth)
        .expect(404);
      expect((again.body as Bag)['code']).toBe('MEDIA_NOT_FOUND');
    });

    it('409 MEDIA_IN_USE con un recurso compartido por varios productos; al desvincular todos se puede borrar', async () => {
      const auth = await asStaff();
      const id = await ready(auth, 82);
      const m1 = (
        await http()
          .post(`/v1/admin/products/${pid(1)}/media`)
          .set('Authorization', auth)
          .send({ assetId: id })
          .expect(201)
      ).body as Bag;
      const m2 = (
        await http()
          .post(`/v1/admin/products/${pid(2)}/media`)
          .set('Authorization', auth)
          .send({ assetId: id })
          .expect(201)
      ).body as Bag;
      const key = media.assets.get(id)?.objectKey as string;
      const res = await http()
        .delete(`/v1/admin/media/${id}`)
        .set('Authorization', auth)
        .expect(409);
      expect((res.body as Bag)['code']).toBe('MEDIA_IN_USE');
      expect(storage.objects?.has(key)).toBe(true);
      await http()
        .delete(`/v1/admin/products/${pid(1)}/media/${String(m1['id'])}`)
        .set('Authorization', auth)
        .expect(204);
      await http().delete(`/v1/admin/media/${id}`).set('Authorization', auth).expect(409); // aún lo usa el otro producto
      await http()
        .delete(`/v1/admin/products/${pid(2)}/media/${String(m2['id'])}`)
        .set('Authorization', auth)
        .expect(204);
      await http().delete(`/v1/admin/media/${id}`).set('Authorization', auth).expect(204);
    });

    it('si R2 falla al borrar el objeto: 204 igualmente, la fila no queda y hay un aviso con la clave (sin secretos)', async () => {
      const auth = await asStaff();
      const id = await ready(auth, 83);
      const key = media.assets.get(id)?.objectKey as string;
      vi.spyOn(storage, 'deleteObject').mockRejectedValue(
        Object.assign(new Error(`secreto ${R2_SECRET}`), { name: 'InternalError' }),
      );
      await http().delete(`/v1/admin/media/${id}`).set('Authorization', auth).expect(204);
      expect(media.assets.has(id)).toBe(false);
      const text = logged.join('\n');
      expect(text).toContain(key);
      expect(text).not.toContain(R2_SECRET);
    });
  });

  describe('errores del proveedor y almacenamiento no disponible', () => {
    it('proveedor roto en HeadObject y en firma => 503 MEDIA_STORAGE_UNAVAILABLE sin fugas', async () => {
      const auth = await asStaff();
      const intent = await upload(auth, pngBytes(91));
      const leak = new Error(
        `AccessDenied ${R2_SECRET} https://acct.r2.cloudflarestorage.com/b/k?X-Amz-Signature=zzz`,
      );
      vi.spyOn(storage, 'headObject').mockRejectedValue(leak);
      const res = await complete(auth, intent['assetId'] as string).expect(503);
      expect(res.body).toMatchObject({ statusCode: 503, code: 'MEDIA_STORAGE_UNAVAILABLE' });
      expect(JSON.stringify(res.body)).not.toMatch(/AccessDenied|Signature|secreto|r2\./i);
      vi.spyOn(storage, 'presignPut').mockRejectedValue(leak);
      const sign = await intentFor(auth, pngBytes(92)).then((r) => r);
      expect(sign.status).toBe(503);
      expect((sign.body as Bag)['code']).toBe('MEDIA_STORAGE_UNAVAILABLE');
      const sink = logged.join('\n') + JSON.stringify(media.audit);
      expect(sink).not.toContain(R2_SECRET);
      expect(sink).not.toContain('X-Amz-Signature');
      // ni el bucket, ni la clave del objeto, ni la URL del proveedor aparecen en cuerpos de error ni en logs
      const key = media.assets.get(intent['assetId'] as string)?.objectKey as string;
      expect(JSON.stringify([res.body, sign.body])).not.toContain(key);
      expect(JSON.stringify([res.body, sign.body])).not.toContain('sushimon-media-mock');
      expect(logged.join('\n')).not.toContain('cloudflarestorage');
    });

    it('timeout de BD => 503 MEDIA_BUSY / PRODUCTS_BUSY reintentable', async () => {
      const auth = await asStaff();
      media.failTransactionWith = Object.assign(new Error('x'), { code: 'P2028' });
      const res = await intentFor(auth, pngBytes(93)).then((r) => r);
      expect(res.status).toBe(503);
      expect((res.body as Bag)['code']).toBe('MEDIA_BUSY');
      media.failTransactionWith = null;
      products.failTransactionWith = Object.assign(new Error('x'), { code: 'P2028' });
      const a = await ready(auth, 94);
      const busy = await http()
        .post(`/v1/admin/products/${pid(1)}/media`)
        .set('Authorization', auth)
        .send({ assetId: a })
        .expect(503);
      expect((busy.body as Bag)['code']).toBe('PRODUCTS_BUSY');
    });

    it('sin variables R2 la API arranca con almacenamiento no disponible: subir/confirmar/borrar => 503, leer y desvincular siguen', async () => {
      await app.close();
      app = await createApp({});
      expect(storage.mode).toBe('UNAVAILABLE');
      const auth = await asStaff();
      media.seed({ id: '30000000-0000-4000-8000-000000000001', checksumSha256: 'c'.repeat(64) });
      media.seed({
        id: '30000000-0000-4000-8000-000000000002',
        status: 'PENDING',
        confirmedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        checksumSha256: 'd'.repeat(64),
      });
      const intent = await intentFor(auth, pngBytes(95)).then((r) => r);
      expect(intent.status).toBe(503);
      expect(intent.body).toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE', statusCode: 503 });
      const done = await complete(auth, '30000000-0000-4000-8000-000000000002').expect(503);
      expect((done.body as Bag)['code']).toBe('MEDIA_STORAGE_UNAVAILABLE');
      const del = await http()
        .delete('/v1/admin/media/30000000-0000-4000-8000-000000000001')
        .set('Authorization', auth)
        .expect(503);
      expect((del.body as Bag)['code']).toBe('MEDIA_STORAGE_UNAVAILABLE');
      expect(media.assets.has('30000000-0000-4000-8000-000000000001')).toBe(true);
      // READY es idempotente aun sin almacenamiento; la biblioteca se lee con url null (sin base pública)
      await complete(auth, '30000000-0000-4000-8000-000000000001').expect(200);
      const list = await http().get('/v1/admin/media').set('Authorization', auth).expect(200);
      expect(
        (list.body as { items: Bag[] }).items.find((i) => i['status'] === 'READY'),
      ).toMatchObject({ url: null, storageMode: 'R2' });
      // el resto de la API sigue: PATCH con URL externa funciona como en F11
      await http()
        .patch(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', auth)
        .send({ media: [{ url: 'https://otro.ejemplo.org/x.png' }] })
        .expect(200);
      // adjuntar un asset sin base pública => 503 controlado (no 500)
      const att = await http()
        .post(`/v1/admin/products/${pid(2)}/media`)
        .set('Authorization', auth)
        .send({ assetId: '30000000-0000-4000-8000-000000000001' })
        .expect(503);
      expect((att.body as Bag)['code']).toBe('MEDIA_STORAGE_UNAVAILABLE');
    });
  });

  describe('límite de solicitudes por actor (429)', () => {
    const intentBody = (i: number) => {
      const bytes = pngBytes(1000 + i);
      return {
        kind: 'PRODUCT_IMAGE',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        checksumSha256: sha256Hex(bytes),
      };
    };

    it('upload-intents: 20/min por actor; el 21.º => 429 RATE_LIMITED sin crear nada más', async () => {
      const auth = await asStaff();
      for (let i = 0; i < 20; i++) {
        await http()
          .post('/v1/admin/media/upload-intents')
          .set('Authorization', auth)
          .send(intentBody(i))
          .expect(201);
      }
      const res = await http()
        .post('/v1/admin/media/upload-intents')
        .set('Authorization', auth)
        .send(intentBody(99))
        .expect(429);
      expect(res.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
      expect(media.assets.size).toBe(20);
    });

    it('complete: 60/min por actor; el 61.º => 429', async () => {
      const auth = await asStaff();
      for (let i = 0; i < 60; i++) await complete(auth, MISSING).expect(404);
      await complete(auth, MISSING).expect(429);
    });

    it('DELETE de medios: 30/min por actor; el 31.º => 429', async () => {
      const auth = await asStaff();
      for (let i = 0; i < 30; i++)
        await http().delete(`/v1/admin/media/${MISSING}`).set('Authorization', auth).expect(404);
      const res = await http()
        .delete(`/v1/admin/media/${MISSING}`)
        .set('Authorization', auth)
        .expect(429);
      expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('el límite es por ruta: agotar los intents no bloquea las lecturas ni el complete', async () => {
      const auth = await asStaff();
      for (let i = 0; i < 21; i++)
        await http()
          .post('/v1/admin/media/upload-intents')
          .set('Authorization', auth)
          .send(intentBody(i));
      await http().get('/v1/admin/media').set('Authorization', auth).expect(200);
      await complete(auth, MISSING).expect(404);
    });

    it('las solicitudes sin JWT (401) no consumen el cupo del actor', async () => {
      const auth = await asStaff();
      for (let i = 0; i < 30; i++)
        await http().post('/v1/admin/media/upload-intents').send(intentBody(i)).expect(401);
      await http()
        .post('/v1/admin/media/upload-intents')
        .set('Authorization', auth)
        .send(intentBody(500))
        .expect(201);
    });
  });

  describe('secretos', () => {
    it('con R2 configurado (cliente real SIN red: la firma es local) ninguna respuesta, log ni auditoría contiene el secreto', async () => {
      await app.close();
      app = await createApp(R2_ENV);
      expect(storage.mode).toBe('R2');
      const auth = await asStaff();
      const res = await intentFor(auth, pngBytes(96)).then((r) => r);
      expect(res.status).toBe(201);
      const body = res.body as {
        uploadUrl: string;
        headers: Record<string, string>;
        storageMode: string;
      };
      expect(body.storageMode).toBe('R2');
      const url = new URL(body.uploadUrl);
      expect(url.origin).toBe('https://cuenta0123456789.r2.cloudflarestorage.com');
      expect(url.pathname.startsWith('/bucket-pruebas/products/')).toBe(true);
      expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(300);
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-checksum-sha256');
      const row = [...media.assets.values()][0]!;
      expect(row.bucket).toBe('bucket-pruebas');
      const everything =
        JSON.stringify(res.body) +
        JSON.stringify(res.headers) +
        JSON.stringify([...media.assets.values()]) +
        JSON.stringify(media.audit) +
        logged.join('\n');
      expect(everything).not.toContain(R2_SECRET);
      expect(everything).not.toMatch(/accessKey|secretAccessKey/i);
      // la URL firmada solo está en la respuesta del intent
      const persisted =
        JSON.stringify([...media.assets.values()]) +
        JSON.stringify(media.audit) +
        logged.join('\n');
      expect(persisted).not.toContain('X-Amz-Signature');
    });
  });
});
