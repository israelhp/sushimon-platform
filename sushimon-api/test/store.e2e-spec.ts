import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { local } from './support/promotions-harness.js';
import {
  A,
  B,
  CAT,
  INACTIVE_BRANCH,
  MISSING_BRANCH,
  storeHarness,
} from './support/store-harness.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

type Harness = ReturnType<typeof storeHarness>;
type Body = Record<string, unknown>;
const json = (res: request.Response) => res.body as Body & { items: Body[]; code?: string };

function fakeDb() {
  const db = {
    customer: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
    staffUser: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
    $disconnect: () => Promise.resolve(),
  };
  return db;
}

async function createApp(keys: TestKeys, h: Harness) {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
    RATE_LIMIT_MAX: '1000',
    MEDIA_STORAGE_ADAPTER: 'mock',
  });
  vi.resetModules();
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
  const { CategoriesRepository } = await import('../src/categories/categories.repository.js');
  const { ProductsRepository } = await import('../src/products/products.repository.js');
  const { ModifiersRepository } = await import('../src/modifiers/modifiers.repository.js');
  const { BranchProductsRepository } =
    await import('../src/branch-products/branch-products.repository.js');
  const { PromotionsRepository } = await import('../src/promotions/promotions.repository.js');
  const { BannersReadRepository } = await import('../src/banners/banners-read.repository.js');
  const { StoreCatalogRepository } = await import('../src/store/store-catalog.repository.js');
  const { BranchesQueryService } = await import('../src/branches/branches-query.service.js');
  const { BranchAvailabilityService } =
    await import('../src/branch-schedule/branch-availability.service.js');
  const { CLOCK } = await import('../src/branch-schedule/clock.js');
  const { FakeModifiersRepo } = await import('./support/fake-modifiers-repo.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(fakeDb())
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .overrideProvider(CategoriesRepository)
    .useValue(h.categoriesRepo)
    .overrideProvider(ProductsRepository)
    .useValue(h.productsRepo)
    .overrideProvider(ModifiersRepository)
    .useValue(new FakeModifiersRepo())
    .overrideProvider(BranchProductsRepository)
    .useValue(h.world)
    .overrideProvider(PromotionsRepository)
    .useValue(h.promotionsRepo)
    .overrideProvider(BannersReadRepository)
    .useValue(h.bannersRepo)
    .overrideProvider(StoreCatalogRepository)
    .useValue(h.catalogRepo)
    .overrideProvider(BranchesQueryService)
    .useValue(h.branches)
    .overrideProvider(BranchAvailabilityService)
    .useValue(h.availability.service)
    .overrideProvider(CLOCK)
    .useValue(h.clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

describe('Agregados públicos de la tienda (e2e, F17)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let h: Harness;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    keys = await createTestKeys();
  });

  beforeEach(async () => {
    h = storeHarness();
    h.addProduct(1, {
      name: 'Roll California',
      slug: 'roll-california',
      basePrice: '85.00',
      categoryId: CAT.frios,
      description: 'Cangrejo y aguacate',
      image: { url: 'https://cdn.x.io/1.jpg', alt: 'Roll' },
    });
    h.addProduct(2, {
      name: 'Té frío',
      slug: 'te-frio',
      basePrice: '15.00',
      categoryId: CAT.bebidas,
    });
    h.addProduct(3, { name: 'Oculto', slug: 'oculto', categoryId: CAT.calientes });
    h.addProduct(4, { name: 'Inactivo', slug: 'inactivo', categoryId: CAT.frios, active: false });
    app = await createApp(keys, h);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/store/bootstrap', () => {
    it('sin JWT y sin sucursal: 200, caché pública de 15 s, sin ETag', async () => {
      const res = await http().get('/v1/store/bootstrap').expect(200);
      expect(res.body).toMatchObject({
        branchId: null,
        branch: null,
        availability: null,
        promotions: [],
        featured: [],
        degraded: [],
        productCount: 2,
        banners: [],
      });
      expect(res.body).not.toHaveProperty('locale');
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=15');
      expect(res.headers['etag']).toBeUndefined();
    });

    it('con sucursal: nextChangeAt combinado acota la caché (min de promoción y horario; los banners no intervienen)', async () => {
      h.promotionsRepo.seed({ endsAt: local('2026-11-16T16:00:09') });
      h.bannersRepo.seed();
      h.availability.state.nextTransitionAt = local('2026-11-16T16:00:30').toISOString();
      const res = await http().get(`/v1/store/bootstrap?branchId=${A}`).expect(200);
      expect(res.body).toMatchObject({ branchId: A });
      expect(json(res)['nextChangeAt']).toBe(local('2026-11-16T16:00:09').toISOString());
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=9');
    });

    it('banners: solo activos, máx. 5, en orden de creación y sin ids de asset ni claves de objeto', async () => {
      for (let n = 0; n < 7; n += 1) h.bannersRepo.seed({ active: n !== 1 });
      const res = await http().get('/v1/store/bootstrap').expect(200);
      const banners = json(res)['banners'] as { id: string; alt: string }[];
      expect(banners.map((b) => b.alt)).toEqual(['Alt 1', 'Alt 3', 'Alt 4', 'Alt 5', 'Alt 6']);
      expect(Object.keys(banners[0] as object).sort()).toEqual(['alt', 'id', 'image']);
      expect(JSON.stringify(res.body)).not.toMatch(/objectKey|assetId/);
    });

    it('degraded => 200 con caché acotada (CDN 3 s, navegador 0), no no-store', async () => {
      h.availability.state.fail = true;
      const res = await http().get(`/v1/store/bootstrap?branchId=${A}`).expect(200);
      expect(json(res)['degraded']).toEqual(['availability']);
      expect(res.headers['cache-control']).toBe('public, max-age=0, s-maxage=3');
    });

    it('branchId en mayúsculas es el mismo recurso: se normaliza a minúsculas (clave de caché única)', async () => {
      const lower = await http().get(`/v1/store/bootstrap?branchId=${A}`).expect(200);
      const upper = await http().get(`/v1/store/bootstrap?branchId=${A.toUpperCase()}`).expect(200);
      expect(upper.body).toEqual(lower.body);
      const menu = await http().get(`/v1/store/menu?branchId=${A.toUpperCase()}`).expect(200);
      expect(json(menu)['branchId']).toBe(A);
      const s = await http().get(`/v1/store/search?q=roll&branchId=${A.toUpperCase()}`).expect(200);
      expect(json(s)['branchId']).toBe(A);
      const d = await http()
        .get(`/v1/store/products/roll-california?branchId=${A.toUpperCase()}`)
        .expect(200);
      expect((d.body as { offer: { branchId: string } }).offer.branchId).toBe(A);
    });

    it('cambio de sucursal: otra respuesta; inexistente o inactiva => 404 idéntico y no-store', async () => {
      const a = await http().get(`/v1/store/bootstrap?branchId=${A}`).expect(200);
      const b = await http().get(`/v1/store/bootstrap?branchId=${B}`).expect(200);
      expect((a.body as Body)['branch']).not.toEqual((b.body as Body)['branch']);
      const missing = await http()
        .get(`/v1/store/bootstrap?branchId=${MISSING_BRANCH}`)
        .expect(404);
      const inactive = await http()
        .get(`/v1/store/bootstrap?branchId=${INACTIVE_BRANCH}`)
        .expect(404);
      expect(json(missing).code).toBe('BRANCH_NOT_FOUND');
      expect({ ...inactive.body, requestId: 0 }).toEqual({ ...missing.body, requestId: 0 });
      expect(inactive.headers['cache-control']).toBe('no-store');
    });

    it('parámetros inválidos => 400 sin caché pública', async () => {
      for (const url of [
        '/v1/store/bootstrap?branchId=x',
        '/v1/store/bootstrap?locale=fr',
        '/v1/store/bootstrap?locale=es',
        '/v1/store/bootstrap?foo=1',
      ]) {
        const res = await http().get(url).expect(400);
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });

    it('no depende de Authorization y no expone datos privados ni códigos', async () => {
      h.promotionsRepo.seed({ code: 'SECRETO10', name: 'Cupón' });
      h.promotionsRepo.seed({ name: 'Auto' });
      const anon = await http().get(`/v1/store/bootstrap?branchId=${A}`).expect(200);
      const withAuth = await http()
        .get(`/v1/store/bootstrap?branchId=${A}`)
        .set('Authorization', 'Bearer cualquier-cosa')
        .expect(200);
      expect(withAuth.body).toEqual(anon.body);
      const raw = JSON.stringify(anon.body);
      for (const leak of [
        'SECRETO10',
        '"code":"SECRETO',
        'favorites',
        'customer',
        'staff',
        'sku',
      ]) {
        expect(raw).not.toContain(leak);
      }
    });

    it('fallo reintentable de lectura crítica => 503 STORE_BUSY sin detalles, no-store', async () => {
      h.catalogRepo.failWith = Object.assign(new Error('password=hunter2 host=db.internal'), {
        code: '55P03',
      });
      const res = await http().get('/v1/store/bootstrap').expect(503);
      expect(res.body).toMatchObject({ code: 'STORE_BUSY', statusCode: 503 });
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|db\.internal|stack/);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('límite de tasa: 60/min por IP y 429 con Retry-After y no-store', async () => {
      let last: request.Response | undefined;
      for (let i = 0; i < 61; i += 1) last = await http().get('/v1/store/bootstrap');
      expect(last?.status).toBe(429);
      expect(last?.headers['retry-after']).toBeDefined();
      expect(last?.headers['cache-control']).toBe('no-store');
      expect(json(last!).code).toBe('RATE_LIMITED');
    });
  });

  describe('GET /v1/store/menu', () => {
    it('sin sucursal: tarjetas con precio base y available null; paginación por defecto', async () => {
      const res = await http().get('/v1/store/menu').expect(200);
      expect(res.body).toMatchObject({ branchId: null, page: 1, pageSize: 100, total: 2 });
      expect(json(res).items.map((i) => i['slug'])).toEqual(['roll-california', 'te-frio']);
      expect(json(res).items[0]).toMatchObject({ price: '85.00', available: null, promo: null });
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=15');
      expect(res.headers['etag']).toBeUndefined();
    });

    it('precio y disponibilidad por sucursal; cambio de sucursal cambia la respuesta', async () => {
      const id = [...h.world.products.keys()][0]!;
      h.world.seedRow(A, id, { priceOverride: '70.00' });
      h.world.seedRow(B, id, { priceOverride: '99.00', available: false });
      const a = await http().get(`/v1/store/menu?branchId=${A}`).expect(200);
      const b = await http().get(`/v1/store/menu?branchId=${B}`).expect(200);
      expect(json(a).items[0]).toMatchObject({ price: '70.00', available: true });
      expect(json(b).items[0]).toMatchObject({ price: '99.00', available: false });
      expect(JSON.stringify(a.body)).not.toContain('99.00');
    });

    it('paginación y límites: pageSize ≤ 100, page ≤ 200, valores no numéricos => 400', async () => {
      const p = await http().get('/v1/store/menu?pageSize=1&page=2').expect(200);
      expect([json(p).items.length, json(p)['total']]).toEqual([1, 2]);
      const out = await http().get('/v1/store/menu?pageSize=1&page=50').expect(200);
      expect([json(out).items.length, json(out)['total']]).toEqual([0, 2]);
      for (const q of [
        'pageSize=101',
        'pageSize=0',
        'page=201',
        'page=0',
        'page=1.5',
        'pageSize=x',
        'sort=zzz',
        'order=up',
      ]) {
        await http().get(`/v1/store/menu?${q}`).expect(400);
      }
    });

    it('available=true sin sucursal => 400; con sucursal excluye agotados', async () => {
      await http().get('/v1/store/menu?available=true').expect(400);
      const id = [...h.world.products.keys()][0]!;
      h.world.seedRow(A, id, { available: false });
      const res = await http().get(`/v1/store/menu?branchId=${A}&available=true`).expect(200);
      expect(json(res).items.map((i) => i['slug'])).toEqual(['te-frio']);
    });

    it('404 BRANCH_NOT_FOUND idéntico para inexistente e inactiva; 400 si el UUID está mal formado', async () => {
      const missing = await http().get(`/v1/store/menu?branchId=${MISSING_BRANCH}`).expect(404);
      const inactive = await http().get(`/v1/store/menu?branchId=${INACTIVE_BRANCH}`).expect(404);
      expect(json(missing).code).toBe('BRANCH_NOT_FOUND');
      expect({ ...inactive.body, requestId: 0 }).toEqual({ ...missing.body, requestId: 0 });
      expect(inactive.headers['cache-control']).toBe('no-store');
      await http().get('/v1/store/menu?branchId=x').expect(400);
    });

    it('promo vigente indicativa y nextChangeAt acotan la caché; cupón nunca', async () => {
      h.promotionsRepo.seed({ value: '10.00', endsAt: local('2026-11-16T16:00:04') });
      h.promotionsRepo.seed({ code: 'SECRETO10', value: '90.00' });
      const res = await http().get(`/v1/store/menu?branchId=${A}`).expect(200);
      expect(json(res).items[0]?.['promo']).toMatchObject({ promoPrice: '76.50' });
      expect(res.headers['cache-control']).toBe('public, max-age=4, s-maxage=4');
      expect(JSON.stringify(res.body)).not.toContain('SECRETO10');
    });

    it('límite de tasa propio por ruta: agotar search no consume menu', async () => {
      for (let i = 0; i < 31; i += 1) await http().get('/v1/store/search?q=roll');
      await http().get('/v1/store/menu').expect(200);
    });
  });

  describe('GET /v1/store/search', () => {
    it('encuentra, plega acentos y devuelve la tarjeta; sin resultados = 200 vacío', async () => {
      const res = await http().get('/v1/store/search?q=FRIO').expect(200);
      // «frio»: nombre de Té frío (grupo 1) y categoría «Frios» de Roll California (grupo 2)
      expect(json(res).items.map((i) => i['slug'])).toEqual(['te-frio', 'roll-california']);
      expect(res.body).toMatchObject({ branchId: null, page: 1, pageSize: 20, total: 2 });
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=15');
      const none = await http().get('/v1/store/search?q=zzzz').expect(200);
      expect(none.body).toMatchObject({ items: [], total: 0, nextChangeAt: null });
      const hidden = await http().get('/v1/store/search?q=oculto').expect(200);
      expect(json(hidden).items).toEqual([]);
    });

    it('q hostil o fuera de rango => 400 (sin tocar la BD)', async () => {
      const urls = [
        '/v1/store/search',
        '/v1/store/search?q=a',
        '/v1/store/search?q=%20%20',
        `/v1/store/search?q=${'a'.repeat(81)}`,
        '/v1/store/search?q=ro%00ll',
        '/v1/store/search?q=ro%0Ell',
        '/v1/store/search?q=ro%E2%80%AEll',
        '/v1/store/search?q=ro%E2%80%8Bll',
        '/v1/store/search?q=a&q=b',
        '/v1/store/search?q=roll&page=21',
        '/v1/store/search?q=roll&pageSize=51',
        '/v1/store/search?q=roll&available=true',
        '/v1/store/search?q=roll&locale=es',
      ];
      for (const url of urls) {
        const res = await http().get(url).expect(400);
        expect(res.headers['cache-control']).toBe('no-store');
      }
      expect(h.catalogRepo.count('findCards')).toBe(0);
    });

    it('q visualmente vacía o con selectores/rellenos invisibles => 400', async () => {
      for (const q of ['--', '%E2%A0%80%E2%A0%80', '%E3%85%A4%E3%85%A4', 'ro%EF%B8%8Fll']) {
        await http().get(`/v1/store/search?q=${q}`).expect(400);
      }
    });

    it('comodines literales y plegado; sucursal inexistente => 404', async () => {
      const all = await http().get('/v1/store/search?q=te%25o').expect(200);
      expect(json(all).items).toEqual([]);
      await http().get(`/v1/store/search?q=roll&branchId=${MISSING_BRANCH}`).expect(404);
      const ok = await http().get(`/v1/store/search?q=roll&branchId=${A}`).expect(200);
      expect(ok.body).toMatchObject({ branchId: A });
    });

    it('límite de tasa propio y más estricto: 30/min por IP, 429 con Retry-After', async () => {
      let last: request.Response | undefined;
      for (let i = 0; i < 30; i += 1) {
        expect((await http().get('/v1/store/search?q=roll')).status).toBe(200);
      }
      for (let i = 0; i < 1; i += 1) last = await http().get('/v1/store/search?q=roll');
      expect(last?.status).toBe(429);
      expect(last?.headers['retry-after']).toBeDefined();
    });
  });

  describe('GET /v1/store/products/{slug}', () => {
    it('sin branchId: igual que antes (caché 60 s + revalidación, sin offer)', async () => {
      const res = await http().get('/v1/store/products/roll-california').expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
      for (const k of ['offer', 'promotions', 'generatedAt', 'nextChangeAt']) {
        expect(res.body).not.toHaveProperty(k);
      }
      expect(res.body).toMatchObject({ slug: 'roll-california', modifierGroups: [] });
    });

    it('con branchId: offer, promociones y caché acotada sin ETag', async () => {
      h.promotionsRepo.seed({ value: '20.00', endsAt: local('2026-11-16T16:00:07') });
      const res = await http().get(`/v1/store/products/roll-california?branchId=${A}`).expect(200);
      expect(res.body).toMatchObject({
        offer: { branchId: A, price: '85.00', available: true },
        promotions: [{ promoPrice: '68.00' }],
      });
      expect(res.headers['cache-control']).toBe('public, max-age=5, s-maxage=7');
      expect(res.headers['etag']).toBeUndefined();
    });

    it('404 PRODUCT_NOT_FOUND (oculto/inactivo/inexistente) y BRANCH_NOT_FOUND; 400 por forma', async () => {
      for (const slug of ['oculto', 'inactivo', 'nada']) {
        const res = await http().get(`/v1/store/products/${slug}`).expect(404);
        expect(json(res).code).toBe('PRODUCT_NOT_FOUND');
        expect(res.headers['cache-control']).toBe('no-store');
      }
      const b = await http()
        .get(`/v1/store/products/roll-california?branchId=${MISSING_BRANCH}`)
        .expect(404);
      expect(json(b).code).toBe('BRANCH_NOT_FOUND');
      await http().get('/v1/store/products/Roll_Mal').expect(400);
      await http().get('/v1/store/products/roll-california?branchId=x').expect(400);
    });
  });
});
