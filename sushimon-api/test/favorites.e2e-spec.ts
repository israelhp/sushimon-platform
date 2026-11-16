import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  FakeCatalog,
  FakeFavoritesRepo,
  P1,
  P2,
  P3,
  P_MISSING,
  product,
} from './support/favorites-harness.js';
import { createTestKeys, USER_ID, type TestKeys } from './support/tokens.js';

/**
 * F06 · HTTP real de `/v1/me/favorites` con Prisma, repositorio y catálogo simulados (sin PostgreSQL ni red).
 * El SQL real y la concurrencia se prueban en `favorites.int-spec.ts`.
 */
const USER_B = '8c1e2d3f-4a5b-4c6d-8e7f-901234567890';
const STAFF_USER = '5d6e7f80-91a2-4b3c-8d4e-5f60718293a4';
const COLLECTION = '/v1/me/favorites';

function fakeDb() {
  const customers = new Map<
    string,
    {
      id: string;
      authUserId: string;
      fullName: string;
      email: string | null;
      phone: null;
      createdAt: Date;
    }
  >();
  const staffRow = {
    id: 's-1',
    fullName: 'Empleado Prueba',
    active: true,
    assignments: [] as unknown[],
  };
  return {
    customers,
    customer: {
      findUnique: vi.fn(({ where }: { where: { authUserId: string } }) =>
        Promise.resolve(customers.get(where.authUserId) ?? null),
      ),
      create: vi.fn(
        ({ data }: { data: { authUserId: string; fullName: string; email: string | null } }) => {
          const created = { id: randomUUID(), phone: null, createdAt: new Date(), ...data };
          customers.set(data.authUserId, created);
          return Promise.resolve(created);
        },
      ),
      findUniqueOrThrow: vi.fn(),
    },
    staffUser: {
      findUnique: vi.fn(({ where }: { where: { authUserId?: string } }) =>
        Promise.resolve(where.authUserId === STAFF_USER ? staffRow : null),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $disconnect: () => Promise.resolve(),
  };
}

async function createApp(keys: TestKeys, repo: FakeFavoritesRepo, catalog: FakeCatalog) {
  const db = fakeDb();
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
  const { FavoritesRepository } = await import('../src/favorites/favorites.repository.js');
  const { CATALOG_PRODUCTS_PORT } = await import('../src/favorites/catalog-products.port.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .overrideProvider(FavoritesRepository)
    .useValue(repo)
    .overrideProvider(CATALOG_PRODUCTS_PORT)
    .useValue(catalog)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return { app, db };
}

interface FavoritesBody {
  items: { productId: string; status: string; product: Record<string, unknown> | null }[];
  favoriteProductIds: string[];
  total: number;
  page: number;
  pageSize: number;
  limit: number;
  catalogStatus: string;
}

describe('F06 · favoritos del cliente (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  let repo: FakeFavoritesRepo;
  let catalog: FakeCatalog;

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    keys = await createTestKeys();
  });

  beforeEach(async () => {
    repo = new FakeFavoritesRepo();
    catalog = new FakeCatalog([product(P1, { name: 'Roll' }), product(P2), product(P3)]);
    ({ app, db } = await createApp(keys, repo, catalog));
  });

  afterEach(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const as = async (sub: string, claims: Record<string, unknown> = {}) =>
    `Bearer ${await keys.sign({ sub, ...claims })}`;
  const customerIdOf = (sub: string) => db.customers.get(sub)?.id as string;

  describe('autenticación y validación', () => {
    it('sin token => 401 en las tres operaciones', async () => {
      await http().get(COLLECTION).expect(401);
      await http().put(`${COLLECTION}/${P1}`).expect(401);
      await http().delete(`${COLLECTION}/${P1}`).expect(401);
    });

    it('JWT con otra clave => 401 y no escribe', async () => {
      const forged = await keys.signWithForeignKey();
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', `Bearer ${forged}`).expect(401);
      expect(repo.rows).toHaveLength(0);
    });

    it.each(['no-uuid', '123', 'platanito-roll'])(
      'productId %s => 400 en PUT y DELETE antes de tocar nada',
      async (id) => {
        const auth = await as(USER_ID);
        await http().put(`${COLLECTION}/${id}`).set('Authorization', auth).expect(400);
        await http().delete(`${COLLECTION}/${id}`).set('Authorization', auth).expect(400);
        expect(catalog.calls).toHaveLength(0);
        expect(db.customer.findUnique).not.toHaveBeenCalled();
      },
    );

    it.each([
      '?customerId=x',
      '?page=0',
      '?page=abc',
      '?page=1.5',
      '?pageSize=51',
      '?pageSize=-1',
      '?pageSize=',
      '?foo=bar',
    ])('GET %s => 400', async (qs) => {
      await http()
        .get(`${COLLECTION}${qs}`)
        .set('Authorization', await as(USER_ID))
        .expect(400);
    });

    it('PUT/DELETE con parámetros de consulta (p. ej. customerId) => 400 y sin efecto', async () => {
      const auth = await as(USER_ID);
      await http()
        .put(`${COLLECTION}/${P1}?customerId=${randomUUID()}`)
        .set('Authorization', auth)
        .expect(400);
      await http()
        .delete(`${COLLECTION}/${P1}?customerId=${randomUUID()}`)
        .set('Authorization', auth)
        .expect(400);
      expect(repo.rows).toHaveLength(0);
    });

    it('un cuerpo con customerId en PUT se ignora: el propietario sigue siendo el del JWT', async () => {
      const auth = await as(USER_ID);
      const victim = randomUUID();
      await http()
        .put(`${COLLECTION}/${P1}`)
        .set('Authorization', auth)
        .send({ customerId: victim })
        .expect(204);
      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0]?.customerId).toBe(customerIdOf(USER_ID));
      expect(repo.rows[0]?.customerId).not.toBe(victim);
    });
  });

  describe('flujo y cabeceras', () => {
    it('PUT 204 sin cuerpo, Cache-Control private, no-store; GET lo refleja', async () => {
      const auth = await as(USER_ID);
      const put = await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      expect(put.headers['cache-control']).toBe('private, no-store');
      expect(put.text).toBe('');

      const get = await http().get(COLLECTION).set('Authorization', auth).expect(200);
      expect(get.headers['cache-control']).toBe('private, no-store');
      const body = get.body as FavoritesBody;
      expect(body).toMatchObject({
        total: 1,
        page: 1,
        pageSize: 20,
        limit: 200,
        catalogStatus: 'AVAILABLE',
        favoriteProductIds: [P1],
      });
      expect(body.items[0]).toMatchObject({
        productId: P1,
        status: 'ACTIVE',
        product: { id: P1, name: 'Roll' },
      });
      expect(typeof (body.items[0] as unknown as { addedAt: string }).addedAt).toBe('string');
    });

    it('el favorito no guarda precio ni sucursal: solo productId, addedAt, status y el resumen mínimo', async () => {
      const auth = await as(USER_ID);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      const body = (await http().get(COLLECTION).set('Authorization', auth).expect(200))
        .body as FavoritesBody;
      const item = body.items[0] as unknown as Record<string, unknown>;
      expect(Object.keys(item).sort()).toEqual(['addedAt', 'product', 'productId', 'status']);
      const product = item['product'] as Record<string, unknown>;
      for (const forbidden of ['price', 'basePrice', 'branchId', 'currency', 'quantity']) {
        expect(product).not.toHaveProperty(forbidden);
      }
      // Cambiar de sucursal no existe en F06: la colección es la misma (una fila por producto y cliente).
      const again = (await http().get(COLLECTION).set('Authorization', auth).expect(200))
        .body as FavoritesBody;
      expect(again.favoriteProductIds).toEqual(body.favoriteProductIds);
    });

    it('DELETE 204 con private, no-store; los errores salen no-store', async () => {
      const auth = await as(USER_ID);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      const del = await http().delete(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      expect(del.headers['cache-control']).toBe('private, no-store');
      const err = await http()
        .put(`${COLLECTION}/${P_MISSING}`)
        .set('Authorization', auth)
        .expect(404);
      expect(err.headers['cache-control']).toBe('no-store');
      const noAuth = await http().get(COLLECTION).expect(401);
      expect(noAuth.headers['cache-control']).toBe('no-store');
    });

    it('idempotencia: PUT dos veces => 204 y una fila; DELETE dos veces => 204', async () => {
      const auth = await as(USER_ID);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      expect(repo.rows).toHaveLength(1);
      await http().delete(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      await http().delete(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      expect(repo.rows).toHaveLength(0);
    });

    it('pageSize=0: ids sin items y sin consultar el catálogo', async () => {
      const auth = await as(USER_ID);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      const callsBefore = catalog.calls.length;
      const res = await http()
        .get(`${COLLECTION}?pageSize=0`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({
        items: [],
        favoriteProductIds: [P1],
        total: 1,
        pageSize: 0,
      });
      expect(catalog.calls).toHaveLength(callsBefore);
    });

    it('cliente nuevo: GET y DELETE NO crean el perfil; solo PUT lo crea', async () => {
      const auth = await as(USER_B);
      const res = await http().get(COLLECTION).set('Authorization', auth).expect(200);
      expect(res.body).toMatchObject({
        items: [],
        total: 0,
        favoriteProductIds: [],
        catalogStatus: 'AVAILABLE',
      });
      await http().delete(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      expect(db.customer.create).not.toHaveBeenCalled();
      expect(db.customers.size).toBe(0);
      expect(catalog.calls).toHaveLength(0);

      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      expect(db.customer.create).toHaveBeenCalledTimes(1);
      expect(db.customers.size).toBe(1);
    });

    it('PUT con candado agotado => 503 FAVORITES_BUSY con code y sin mensaje interno', async () => {
      vi.spyOn(repo, 'add').mockRejectedValueOnce(
        Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
      );
      const res = await http()
        .put(`${COLLECTION}/${P1}`)
        .set('Authorization', await as(USER_ID))
        .expect(503);
      expect(res.body).toMatchObject({ statusCode: 503, code: 'FAVORITES_BUSY' });
      expect(JSON.stringify(res.body)).not.toContain('lock timeout');
    });
  });

  describe('autorización: sin IDOR', () => {
    it('B no ve ni borra lo de A; el DELETE de B es 204 pero no toca la fila de A', async () => {
      const a = await as(USER_ID);
      const b = await as(USER_B);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', a).expect(204);

      const seenByB = await http().get(COLLECTION).set('Authorization', b).expect(200);
      expect(seenByB.body).toMatchObject({ total: 0, favoriteProductIds: [], items: [] });

      await http().delete(`${COLLECTION}/${P1}`).set('Authorization', b).expect(204);
      const seenByA = await http().get(COLLECTION).set('Authorization', a).expect(200);
      expect((seenByA.body as FavoritesBody).favoriteProductIds).toEqual([P1]);
    });

    it('el mismo producto puede ser favorito de A y de B a la vez (filas distintas)', async () => {
      await http()
        .put(`${COLLECTION}/${P1}`)
        .set('Authorization', await as(USER_ID))
        .expect(204);
      await http()
        .put(`${COLLECTION}/${P1}`)
        .set('Authorization', await as(USER_B))
        .expect(204);
      expect(repo.rows.map((r) => r.customerId)).toHaveLength(2);
      expect(new Set(repo.rows.map((r) => r.customerId)).size).toBe(2);
    });

    it('JWT de cliente (aal1, Google) basta: sin MFA ni rol de personal', async () => {
      await http()
        .put(`${COLLECTION}/${P1}`)
        .set('Authorization', await as(USER_ID, { amr: [{ method: 'oauth', timestamp: 1 }] }))
        .expect(204);
    });

    it('un empleado (personal activo, aal1) usa SUS favoritos como cliente, sin mezclar permisos', async () => {
      const staff = await as(STAFF_USER, { email: 'empleado@sushimon.test' });
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', staff).expect(204);
      await http()
        .put(`${COLLECTION}/${P2}`)
        .set('Authorization', await as(USER_ID))
        .expect(204);
      const res = await http().get(COLLECTION).set('Authorization', staff).expect(200);
      expect((res.body as FavoritesBody).favoriteProductIds).toEqual([P1]);
    });
  });

  describe('catálogo y tope', () => {
    it('producto inexistente, INACTIVE o REMOVED => 404 PRODUCT_NOT_FOUND', async () => {
      catalog.products.set(P2, product(P2, { status: 'INACTIVE' }));
      catalog.products.set(P3, product(P3, { status: 'REMOVED' }));
      const auth = await as(USER_ID);
      for (const id of [P_MISSING, P2, P3]) {
        const res = await http().put(`${COLLECTION}/${id}`).set('Authorization', auth).expect(404);
        expect(res.body).toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
      }
      expect(repo.rows).toHaveLength(0);
    });

    it('catálogo no disponible => 503 con code CATALOG_UNAVAILABLE y sin filtrar la causa; no escribe', async () => {
      catalog.mode = 'throws';
      const res = await http()
        .put(`${COLLECTION}/${P1}`)
        .set('Authorization', await as(USER_ID))
        .expect(503);
      expect(res.body).toMatchObject({ statusCode: 503, code: 'CATALOG_UNAVAILABLE' });
      expect(JSON.stringify(res.body)).not.toContain('secreto');
      expect(repo.rows).toHaveLength(0);
    });

    /** Arranca la app SIN sobrescribir el puerto de catálogo: usa el adaptador real de F11 (`ProductsCatalogAdapter`). */
    async function appWithRealCatalog(db: Record<string, unknown>) {
      await app.close();
      const { AppModule } = await import('../src/app.module.js');
      const { configureApp } = await import('../src/app.setup.js');
      const { PrismaService } = await import('../src/database/prisma.service.js');
      const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
      const { FavoritesRepository } = await import('../src/favorites/favorites.repository.js');
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(db)
        .overrideProvider(JWKS_RESOLVER)
        .useValue(keys.jwks)
        .overrideProvider(FavoritesRepository)
        .useValue(repo)
        .compile();
      app = moduleRef.createNestApplication<NestExpressApplication>();
      configureApp(app, { corsOrigins: [] });
      await app.init();
      return moduleRef;
    }

    it('con el adaptador REAL de F11 y la base fallando => PUT 503 CATALOG_UNAVAILABLE y GET degrada (sin filtrar la causa)', async () => {
      const { ProductsCatalogAdapter } =
        await import('../src/favorites/products-catalog.adapter.js');
      const { CATALOG_PRODUCTS_PORT } = await import('../src/favorites/catalog-products.port.js');
      // fakeDb() no tiene delegados `category`/`product`: toda consulta del catálogo falla.
      const moduleRef = await appWithRealCatalog(fakeDb());
      expect(moduleRef.get(CATALOG_PRODUCTS_PORT)).toBeInstanceOf(ProductsCatalogAdapter);
      const auth = await as(USER_ID);
      const res = await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(503);
      expect(res.body).toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
      expect(JSON.stringify(res.body)).not.toMatch(/product|prisma|undefined/i);
      expect(repo.rows).toHaveLength(0);
      await http().get(COLLECTION).set('Authorization', auth).expect(200);
    });

    it('con el adaptador REAL de F11: PUT de un producto visible => 204; inactivo, inexistente u oculto => 404 PRODUCT_NOT_FOUND', async () => {
      const CAT_OK = '00000000-0000-4000-8000-0000000000a1';
      const CAT_OFF = '00000000-0000-4000-8000-0000000000a2';
      const category = (id: string, slug: string, active: boolean) => ({
        id,
        parentId: null,
        slug,
        name: slug,
        description: null,
        sortOrder: 0,
        active,
      });
      const cats = [category(CAT_OK, 'rolls', true), category(CAT_OFF, 'ocultas', false)];
      const products = [
        { id: P1, name: 'Roll', categoryId: CAT_OK, active: true },
        { id: P2, name: 'Inactivo', categoryId: CAT_OK, active: false },
        { id: P3, name: 'En oculta', categoryId: CAT_OFF, active: true },
      ];
      const db = {
        ...fakeDb(),
        category: { findMany: vi.fn(() => Promise.resolve(cats)) },
        product: {
          findMany: vi.fn(
            (a: {
              where: { id: { in: string[] }; active: boolean; categoryId: { in: string[] } };
            }) =>
              Promise.resolve(
                products.filter(
                  (p) =>
                    a.where.id.in.includes(p.id) &&
                    p.active === a.where.active &&
                    a.where.categoryId.in.includes(p.categoryId),
                ),
              ),
          ),
        },
        productMedia: {
          findMany: vi.fn(() =>
            Promise.resolve([
              {
                id: 'm1',
                productId: P1,
                mediaUrl: 'https://cdn.x.io/roll.jpg',
                altText: null,
                sortOrder: 0,
              },
            ]),
          ),
        },
      };
      await appWithRealCatalog(db);
      const auth = await as(USER_ID);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      for (const id of [P2, P3, P_MISSING]) {
        const res = await http().put(`${COLLECTION}/${id}`).set('Authorization', auth).expect(404);
        expect(res.body).toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
      }
      const list = await http().get(COLLECTION).set('Authorization', auth).expect(200);
      expect(list.body).toMatchObject({
        catalogStatus: 'AVAILABLE',
        favoriteProductIds: [P1],
        items: [
          {
            productId: P1,
            status: 'ACTIVE',
            product: {
              id: P1,
              name: 'Roll',
              nameEn: null,
              imageUrl: 'https://cdn.x.io/roll.jpg',
              categoryId: CAT_OK,
            },
          },
        ],
      });
    });

    it('un 500 genérico NO expone code', async () => {
      vi.spyOn(repo, 'add').mockRejectedValueOnce(new Error('db exploded: password=x'));
      const res = await http()
        .put(`${COLLECTION}/${P1}`)
        .set('Authorization', await as(USER_ID))
        .expect(500);
      expect(res.body).not.toHaveProperty('code');
      expect(JSON.stringify(res.body)).not.toContain('password');
    });

    it('GET con catálogo caído => 200 degradado con datos reales', async () => {
      const auth = await as(USER_ID);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      catalog.mode = 'unavailable';
      const res = await http().get(COLLECTION).set('Authorization', auth).expect(200);
      const body = res.body as FavoritesBody;
      expect(body.catalogStatus).toBe('UNAVAILABLE');
      expect(body.favoriteProductIds).toEqual([P1]);
      expect(body.items).toEqual([
        expect.objectContaining({ productId: P1, status: 'UNKNOWN', product: null }),
      ]);
    });

    it('DELETE funciona con el catálogo caído', async () => {
      const auth = await as(USER_ID);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      catalog.mode = 'unavailable';
      await http().delete(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      expect(repo.rows).toHaveLength(0);
    });

    it('tope: con 200, producto nuevo => 422 FAVORITES_LIMIT_REACHED; ya favorito => 204', async () => {
      const auth = await as(USER_ID);
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      const customerId = customerIdOf(USER_ID);
      for (let i = 0; i < 199; i++)
        repo.seed(customerId, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      expect(repo.rows).toHaveLength(200);
      const res = await http().put(`${COLLECTION}/${P2}`).set('Authorization', auth).expect(422);
      expect(res.body).toMatchObject({ statusCode: 422, code: 'FAVORITES_LIMIT_REACHED' });
      await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      expect(repo.rows).toHaveLength(200);
    });
  });

  describe('rate limit por ruta', () => {
    it('la solicitud 61 de PUT => 429 RATE_LIMITED con no-store y Retry-After; GET y DELETE no comparten contador', async () => {
      const auth = await as(USER_ID);
      for (let i = 0; i < 60; i++)
        await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
      const res = await http().put(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(429);
      expect(res.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['retry-after']).toBeDefined();
      await http().get(COLLECTION).set('Authorization', auth).expect(200);
      await http().delete(`${COLLECTION}/${P1}`).set('Authorization', auth).expect(204);
    });

    it('la solicitud 121 de GET => 429', async () => {
      const auth = await as(USER_ID);
      for (let i = 0; i < 120; i++)
        await http().get(`${COLLECTION}?pageSize=0`).set('Authorization', auth).expect(200);
      await http().get(COLLECTION).set('Authorization', auth).expect(429);
    });
  });
});
