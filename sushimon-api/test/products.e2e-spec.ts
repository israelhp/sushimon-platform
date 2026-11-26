import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FakeModifiersRepo } from './support/fake-modifiers-repo.js';
import { FakeProductsRepo } from './support/fake-products-repo.js';
import { CAT, categoryRow, pid, productRow, seedCategories } from './support/products-harness.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const ALL_PERMS = ['catalog.read', 'catalog.create', 'catalog.update'];
const MISSING = pid(999);
const CAT_MISSING = '00000000-0000-4000-8000-0000000000ff';

type CategoryRowT = ReturnType<typeof categoryRow>;

/** Doble de PrismaService: solo lo que usa el módulo de categorías (F10) y la autenticación. */
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

/** Doble de la liberación de imágenes (F14 `removeUnusedAsset`): registra (asset, tipo) y puede fallar. */
class FakeReleaser {
  released: { assetId: string; kind: string }[] = [];
  failWith: Error | null = null;
  removeUnusedAsset(_staff: unknown, assetId: string, kind: string): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.released.push({ assetId, kind });
    return Promise.resolve();
  }
}

async function createApp(
  keys: TestKeys,
  db: ReturnType<typeof fakeDb>,
  repo: FakeProductsRepo,
  releaser: FakeReleaser,
) {
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
  const { ProductsRepository } = await import('../src/products/products.repository.js');
  const { ModifiersRepository } = await import('../src/modifiers/modifiers.repository.js');
  const { AdminMediaService } = await import('../src/media/admin-media.service.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .overrideProvider(ProductsRepository)
    .useValue(repo)
    .overrideProvider(ModifiersRepository)
    .useValue(new FakeModifiersRepo())
    .overrideProvider(AdminMediaService)
    .useValue(releaser)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

interface PageBody {
  items: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
}

describe('Productos (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  let repo: FakeProductsRepo;
  let releaser: FakeReleaser;
  let categories: CategoryRowT[];
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
  const names = (res: request.Response) =>
    (res.body as PageBody).items.map((i) => i['name'] as string);

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    categories = seedCategories();
    db = fakeDb(categories);
    repo = new FakeProductsRepo();
    for (const c of categories) repo.categories.set(c.id, { id: c.id, active: c.active });
    repo.seed(
      productRow(pid(1), {
        name: 'Roll California',
        slug: 'roll-california',
        sku: 'RC-1',
        description: 'Con aguacate',
        categoryId: CAT.frios,
        basePrice: '85.00',
      }),
      [{ url: 'https://cdn.x.io/1.jpg', altText: 'Uno' }, { url: 'https://cdn.x.io/2.jpg' }],
    );
    repo.seed(
      productRow(pid(2), { name: 'Roll Vegano', slug: 'roll-vegano', categoryId: CAT.veganos }),
    );
    repo.seed(
      productRow(pid(3), {
        name: 'Té frío',
        slug: 'te-frio',
        categoryId: CAT.bebidas,
        description: '100% natural_',
      }),
    );
    repo.seed(productRow(pid(4), { name: 'Inactivo', slug: 'inactivo', active: false }));
    repo.seed(productRow(pid(5), { name: 'Oculto', slug: 'oculto', categoryId: CAT.calientes }));
    releaser = new FakeReleaser();
    app = await createApp(keys, db, repo, releaser);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('público GET /v1/store/products', () => {
    it('sin autenticación: solo visibles, campos públicos, sin sku, con caché pública', async () => {
      const res = await http().get('/v1/store/products').expect(200);
      expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
      expect(names(res)).toEqual(['Roll California', 'Roll Vegano', 'Té frío']);
      expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
      expect((res.body as PageBody).items[0]).toEqual({
        id: pid(1),
        slug: 'roll-california',
        name: 'Roll California',
        description: 'Con aguacate',
        basePrice: '85.00',
        category: { id: CAT.frios, slug: 'frios', name: 'Frios' },
        media: [
          { url: 'https://cdn.x.io/1.jpg', altText: 'Uno' },
          { url: 'https://cdn.x.io/2.jpg', altText: null },
        ],
      });
      const text = JSON.stringify(res.body);
      for (const forbidden of ['RC-1', '"sku"', '"active"', 'createdAt', 'publiclyVisible']) {
        expect(text).not.toContain(forbidden);
      }
      expect(typeof (res.body as PageBody).items[0]?.['basePrice']).toBe('string');
    });

    it('una consulta de categorías + una de productos + una de media (sin N+1)', async () => {
      await http().get('/v1/store/products').expect(200);
      expect(db.category.findMany).toHaveBeenCalledTimes(1);
      expect(repo.count('findPage')).toBe(1);
      expect(repo.count('findMedia')).toBe(1);
    });

    it('una categoría que se oculta oculta sus productos (y reactivarla los republica)', async () => {
      categories.find((c) => c.id === CAT.frios)!.active = false;
      const res = await http().get('/v1/store/products').expect(200);
      expect(names(res)).toEqual(['Té frío']); // Roll Vegano está en veganos, hija de frios
      await http().get('/v1/store/products/roll-california').expect(404);
      categories.find((c) => c.id === CAT.frios)!.active = true;
      await http().get('/v1/store/products/roll-california').expect(200);
    });

    it('categorySlug incluye descendientes; inexistente u oculto => lista vacía 200', async () => {
      expect(names(await http().get('/v1/store/products?categorySlug=rolls').expect(200))).toEqual([
        'Roll California',
        'Roll Vegano',
      ]);
      expect(
        names(await http().get('/v1/store/products?categorySlug=veganos').expect(200)),
      ).toEqual(['Roll Vegano']);
      for (const slug of ['inexistente', 'calientes']) {
        const res = await http().get(`/v1/store/products?categorySlug=${slug}`).expect(200);
        expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
        expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
      }
    });

    it('q: nombre, descripción y sku sin acentos; comodines % _ \\ literales', async () => {
      const find = async (q: string) =>
        names(await http().get('/v1/store/products').query({ q }).expect(200));
      expect(await find('te frio')).toEqual(['Té frío']);
      expect(await find('AGUACATE')).toEqual(['Roll California']);
      expect(await find('rc-1')).toEqual([]); // el SKU NO es buscable públicamente
      expect(await find('RC-1')).toEqual([]);
      expect(await find('\u0000')).toHaveLength(3); // NUL se descarta: sin 500
      expect(await find('%')).toEqual(['Té frío']);
      expect(await find('_')).toEqual(['Té frío']);
      expect(await find('r%l')).toEqual([]);
      expect(await find('r_ll')).toEqual([]);
      expect(await find('\\')).toEqual([]);
      expect(await find('inactivo')).toEqual([]);
      expect(await find('oculto')).toEqual([]);
    });

    it('paginación: pageSize/page respetados; total estable; página fuera de rango vacía', async () => {
      const p1 = await http().get('/v1/store/products?page=1&pageSize=2').expect(200);
      const p2 = await http().get('/v1/store/products?page=2&pageSize=2').expect(200);
      expect([...names(p1), ...names(p2)]).toEqual(['Roll California', 'Roll Vegano', 'Té frío']);
      expect([(p1.body as PageBody).total, (p2.body as PageBody).total]).toEqual([3, 3]);
      const far = await http().get('/v1/store/products?page=50&pageSize=2').expect(200);
      expect(far.body).toEqual({ items: [], page: 50, pageSize: 2, total: 3 });
    });

    it('parámetros inválidos => 400 sin caché pública', async () => {
      for (const qs of [
        'pageSize=101',
        'pageSize=0',
        'page=0',
        'page=10001',
        'page=201',
        'page=1.5',
        'page=abc',
        `q=${'a'.repeat(81)}`,
        'categorySlug=Mal_Slug',
        'categorySlug=a--b',
        'extra=1',
        'sort=name',
      ]) {
        const res = await http().get(`/v1/store/products?${qs}`).expect(400);
        expect(res.headers['cache-control']).not.toContain('public');
      }
    });
  });

  describe('público GET /v1/store/products/{slug}', () => {
    it('ficha con ancestros raíz → padre, media ordenada, caché pública y sin sku', async () => {
      const res = await http().get('/v1/store/products/roll-vegano').expect(200);
      expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
      expect(res.body).toMatchObject({
        id: pid(2),
        slug: 'roll-vegano',
        basePrice: '50.00',
        category: { slug: 'veganos' },
        categoryAncestors: [
          { id: CAT.rolls, slug: 'rolls', name: 'Rolls' },
          { id: CAT.frios, slug: 'frios', name: 'Frios' },
        ],
        media: [],
        modifierGroups: [],
      });
      const detail = await http().get('/v1/store/products/roll-california').expect(200);
      expect((detail.body as { media: unknown[] }).media).toHaveLength(2);
      expect(JSON.stringify(detail.body)).not.toContain('RC-1');
      const root = await http().get('/v1/store/products/te-frio').expect(200);
      expect((root.body as { categoryAncestors: unknown[] }).categoryAncestors).toEqual([]);
    });

    it('inexistente, inactivo o con categoría oculta => 404 PRODUCT_NOT_FOUND sin caché pública', async () => {
      for (const slug of ['nada', 'inactivo', 'oculto']) {
        const res = await http().get(`/v1/store/products/${slug}`).expect(404);
        expect(res.body).toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
        expect(res.headers['cache-control'] ?? '').not.toContain('public');
      }
    });

    it('inactivo, categoría inactiva y ancestro inactivo => 404 idéntico (mismo cuerpo, sin caché pública)', async () => {
      repo.seed(
        productRow(pid(6), {
          name: 'Bajo ancestro',
          slug: 'bajo-ancestro',
          categoryId: CAT.hijaDeInactiva,
        }),
      );
      const bodies: unknown[] = [];
      for (const slug of ['nada', 'inactivo', 'oculto', 'bajo-ancestro']) {
        const res = await http().get(`/v1/store/products/${slug}`).expect(404);
        expect(res.headers['cache-control'] ?? '').not.toContain('public');
        const rest = { ...(res.body as Record<string, unknown>) };
        delete rest['requestId'];
        bodies.push(rest);
      }
      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect(bodies[0]).toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    });

    it('slug con forma inválida => 400', async () => {
      await http().get('/v1/store/products/Roll_Mal').expect(400);
      await http()
        .get(`/v1/store/products/${'a'.repeat(81)}`)
        .expect(400);
    });
  });

  describe('autenticación y autorización admin', () => {
    it('sin JWT o con JWT inválido => 401 en las cuatro operaciones', async () => {
      await http().get('/v1/admin/products').expect(401);
      await http().post('/v1/admin/products').send({}).expect(401);
      await http()
        .get(`/v1/admin/products/${pid(1)}`)
        .expect(401);
      await http()
        .patch(`/v1/admin/products/${pid(1)}`)
        .send({ name: 'x' })
        .expect(401);
      await http()
        .get('/v1/admin/products')
        .set('Authorization', `Bearer ${await keys.signWithForeignKey()}`)
        .expect(401);
    });

    it('cliente (no personal) => 403 genérico', async () => {
      const res = await http()
        .get('/v1/admin/products')
        .set('Authorization', await bearer(AAL2))
        .expect(403);
      expect((res.body as { message: string }).message).toBe('Acceso denegado');
    });

    it('personal con permiso pero sesión aal1 => 403 MFA_REQUIRED sin tocar productos', async () => {
      const auth = await asStaff({}, {});
      const res = await http().get('/v1/admin/products').set('Authorization', auth).expect(403);
      expect((res.body as { message: string }).message).toBe('MFA_REQUIRED');
      await http().post('/v1/admin/products').set('Authorization', auth).send({}).expect(403);
      await http()
        .get(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', auth)
        .expect(403);
      await http()
        .patch(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', auth)
        .send({ name: 'x' })
        .expect(403);
      expect(repo.calls).toEqual([]);
    });

    it('permisos separados: read no escribe; create no lee ni edita; update no crea', async () => {
      const readOnly = await asStaff({ permissions: ['catalog.read'] });
      await http().get('/v1/admin/products').set('Authorization', readOnly).expect(200);
      await http()
        .get(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', readOnly)
        .expect(200);
      await http().post('/v1/admin/products').set('Authorization', readOnly).send({}).expect(403);
      await http()
        .patch(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', readOnly)
        .send({ name: 'x' })
        .expect(403);
      const onlyCreate = await asStaff({ permissions: ['catalog.create'] });
      await http().get('/v1/admin/products').set('Authorization', onlyCreate).expect(403);
      await http()
        .patch(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', onlyCreate)
        .send({ name: 'x' })
        .expect(403);
      const onlyUpdate = await asStaff({ permissions: ['catalog.update'] });
      await http().post('/v1/admin/products').set('Authorization', onlyUpdate).send({}).expect(403);
      expect(repo.count('insert') + repo.count('update')).toBe(0);
    });

    it('alcance por sucursal: la lectura funciona; POST y PATCH => 403 antes de leer o escribir', async () => {
      const auth = await asStaff({ branchId: '00000000-0000-4000-8000-000000000500' });
      await http().get('/v1/admin/products').set('Authorization', auth).expect(200);
      await http()
        .get(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', auth)
        .expect(200);
      repo.calls.length = 0;
      const create = await http()
        .post('/v1/admin/products')
        .set('Authorization', auth)
        .send({ name: 'X', basePrice: '10.00', categoryId: CAT.frios })
        .expect(403);
      expect((create.body as { message: string }).message).toBe('Acceso denegado');
      await http()
        .patch(`/v1/admin/products/${MISSING}`) // 403 antes que 404
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      expect(repo.calls).toEqual([]);
      expect(repo.audit).toEqual([]);
    });
  });

  describe('admin: lectura', () => {
    it('lista todo (activos e inactivos), con publiclyVisible, categoría y no-store', async () => {
      const auth = await asStaff({ permissions: ['catalog.read'] });
      const res = await http().get('/v1/admin/products').set('Authorization', auth).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 5 });
      const byName = new Map((res.body as PageBody).items.map((i) => [i['name'], i]));
      expect(byName.get('Inactivo')).toMatchObject({ active: false, publiclyVisible: false });
      expect(byName.get('Oculto')).toMatchObject({
        active: true,
        publiclyVisible: false,
        category: { slug: 'calientes', active: false, effectivelyVisible: false },
      });
      expect(byName.get('Roll California')).toMatchObject({
        sku: 'RC-1',
        publiclyVisible: true,
        media: [
          { sortOrder: 0, url: 'https://cdn.x.io/1.jpg', altText: 'Uno' },
          { sortOrder: 1, url: 'https://cdn.x.io/2.jpg', altText: null },
        ],
      });
    });

    it('filtros q, categoryId, active, sort/order y paginación; id desempata', async () => {
      const auth = await asStaff();
      const get = async (qs: string) =>
        http().get(`/v1/admin/products?${qs}`).set('Authorization', auth).expect(200);
      expect(names(await get(`categoryId=${CAT.rolls}`))).toEqual([]); // sin descendientes
      expect(names(await get(`categoryId=${CAT.veganos}`))).toEqual(['Roll Vegano']);
      expect(names(await get(`categoryId=${CAT_MISSING}`))).toEqual([]);
      expect(names(await get('active=false'))).toEqual(['Inactivo']);
      expect(names(await get('active=true&q=roll'))).toEqual(['Roll California', 'Roll Vegano']);
      expect(names(await get('q=oculto'))).toEqual(['Oculto']); // slug también
      expect(names(await get('q=rc-1'))).toEqual(['Roll California']); // el SKU sí en admin
      expect(names(await get('sort=name&order=desc&pageSize=2'))).toEqual([
        'Té frío',
        'Roll Vegano',
      ]);
      const byPrice = await get('sort=basePrice&order=desc');
      expect((byPrice.body as PageBody).items[0]?.['basePrice']).toBe('85.00');
      // empates de precio 50.00: el orden de los empatados es por id
      const tied = (byPrice.body as PageBody).items.filter((i) => i['basePrice'] === '50.00');
      expect(tied.map((i) => i['id'])).toEqual([...tied.map((i) => i['id'] as string)].sort());
      const second = await get('pageSize=2&page=2');
      expect(second.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
      expect((second.body as PageBody).items).toHaveLength(2);
    });

    it('parámetros inválidos => 400', async () => {
      const auth = await asStaff();
      for (const qs of [
        'sort=sku',
        'order=up',
        'active=quizas',
        'categoryId=no-es-uuid',
        'pageSize=101',
        `q=${'a'.repeat(81)}`,
        'extra=1',
      ]) {
        await http().get(`/v1/admin/products?${qs}`).set('Authorization', auth).expect(400);
      }
    });

    it('detalle: incluye inactivos y categoría inactiva; 404 PRODUCT_NOT_FOUND; UUID inválido 400; no-store', async () => {
      const auth = await asStaff({ permissions: ['catalog.read'] });
      const res = await http()
        .get(`/v1/admin/products/${pid(5)}`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ id: pid(5), active: true, publiclyVisible: false });
      await http()
        .get(`/v1/admin/products/${pid(4)}`)
        .set('Authorization', auth)
        .expect(200);
      const nf = await http()
        .get(`/v1/admin/products/${MISSING}`)
        .set('Authorization', auth)
        .expect(404);
      expect(nf.body).toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
      expect(nf.headers['cache-control']).toBe('no-store');
      await http().get('/v1/admin/products/no-es-uuid').set('Authorization', auth).expect(400);
    });
  });

  describe('admin: POST /v1/admin/products', () => {
    const body = (over: Record<string, unknown> = {}) => ({
      name: '  Roll   Nuevo ',
      basePrice: '95.50',
      categoryId: CAT.frios,
      ...over,
    });

    it('crea (201) con slug autogenerado, sku en mayúsculas, media ordenada, audita y no-store', async () => {
      const auth = await asStaff();
      const res = await http()
        .post('/v1/admin/products')
        .set('Authorization', auth)
        .send(
          body({
            sku: 'rn-01',
            description: ' Rico ',
            media: [
              { url: 'https://cdn.x.io/a.jpg', altText: 'A' },
              { url: 'https://cdn.x.io/b.jpg' },
            ],
          }),
        )
        .expect(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        slug: 'roll-nuevo',
        name: 'Roll Nuevo',
        sku: 'RN-01',
        description: 'Rico',
        basePrice: '95.50',
        categoryId: CAT.frios,
        active: true,
        publiclyVisible: true,
        category: { slug: 'frios', effectivelyVisible: true },
      });
      expect(
        (res.body as { media: { sortOrder: number }[] }).media.map((m) => m.sortOrder),
      ).toEqual([0, 1]);
      expect(repo.audit).toHaveLength(1);
      expect(repo.audit[0]).toMatchObject({
        action: 'product.created',
        actorId: STAFF_ID,
        entityType: 'product',
      });
      expect(JSON.stringify(repo.audit)).not.toContain('Rico');
      expect(JSON.stringify(repo.audit)).not.toContain('cdn.x.io'); // sin URLs en la auditoría
      expect(JSON.stringify(repo.audit)).not.toContain('description');
      // el producto nuevo ya es visible
      await http().get('/v1/store/products/roll-nuevo').expect(200);
    });

    it('slug duplicado (explícito) => 409 PRODUCT_SLUG_TAKEN; sku duplicado => 409 PRODUCT_SKU_TAKEN', async () => {
      const auth = await asStaff();
      const dupSlug = await http()
        .post('/v1/admin/products')
        .set('Authorization', auth)
        .send(body({ slug: 'roll-california' }))
        .expect(409);
      expect(dupSlug.body).toMatchObject({ statusCode: 409, code: 'PRODUCT_SLUG_TAKEN' });
      const dupSku = await http()
        .post('/v1/admin/products')
        .set('Authorization', auth)
        .send(body({ sku: 'rc-1' }))
        .expect(409);
      expect(dupSku.body).toMatchObject({ code: 'PRODUCT_SKU_TAKEN' });
      expect(repo.audit).toHaveLength(0);
    });

    it('slug autogenerado se desambigua en vez de fallar', async () => {
      const auth = await asStaff();
      const res = await http()
        .post('/v1/admin/products')
        .set('Authorization', auth)
        .send(body({ name: 'Roll California' }))
        .expect(201);
      expect((res.body as { slug: string }).slug).toBe('roll-california-2');
    });

    it('categoría inexistente o inactiva => 422 PRODUCT_CATEGORY_INVALID', async () => {
      const auth = await asStaff();
      for (const categoryId of [CAT_MISSING, CAT.calientes]) {
        const res = await http()
          .post('/v1/admin/products')
          .set('Authorization', auth)
          .send(body({ categoryId }))
          .expect(422);
        expect(res.body).toMatchObject({ statusCode: 422, code: 'PRODUCT_CATEGORY_INVALID' });
      }
    });

    it('media inválida (http, javascript, data, > 8, alt > 200) => 422 PRODUCT_MEDIA_INVALID; no es 400', async () => {
      const auth = await asStaff();
      const nine = Array.from({ length: 9 }, (_, i) => ({ url: `https://x.io/${i}` }));
      for (const media of [
        [{ url: 'http://x.io/a.jpg' }],
        [{ url: 'javascript:alert(1)' }],
        [{ url: 'data:image/png;base64,AAAA' }],
        [{ url: 'https://x.io/a b.jpg' }],
        [{ url: 'https://user:pw@x.io/a.jpg' }],
        [{ url: 'https://10.0.0.5/a.jpg' }],
        [{ url: 'https://169.254.169.254/latest' }],
        [{ url: 'https://[::1]/a.jpg' }],
        [{ url: 'https://localhost/a.jpg' }],
        [{ url: 'https://intranet/a.jpg' }],
        [{ url: `https://x.io/${'a'.repeat(2048)}` }],
        [{ url: 'https://x.io/a.jpg', altText: 'a'.repeat(201) }],
        nine,
      ]) {
        const res = await http()
          .post('/v1/admin/products')
          .set('Authorization', auth)
          .send(body({ media }))
          .expect(422);
        expect(res.body).toMatchObject({ code: 'PRODUCT_MEDIA_INVALID' });
      }
      expect(repo.count('insert')).toBe(0);
    });

    it('forma inválida => 400 (precio, nombre, uuid, slug, sku, tipos, propiedades desconocidas, anidadas)', async () => {
      const auth = await asStaff();
      for (const bad of [
        body({ basePrice: '85' }),
        body({ basePrice: '85.5' }),
        body({ basePrice: '0.00' }),
        body({ basePrice: '1000000.00' }),
        body({ basePrice: 85 }),
        body({ basePrice: '-5.00' }),
        body({ name: '' }),
        body({ name: '   ' }),
        body({ name: 'a'.repeat(121) }),
        body({ categoryId: 'no-es-uuid' }),
        body({ slug: 'Mal Slug' }),
        body({ sku: 'con espacios' }),
        body({ sku: 'a'.repeat(41) }),
        body({ description: 'a'.repeat(2001) }),
        body({ active: 'si' }),
        body({ media: 'x' }),
        body({ media: [{ url: 5 }] }),
        body({ media: [{ url: 'https://x.io/a', extra: 1 }] }),
        body({ id: pid(1) }),
        body({ createdAt: 'x' }),
        { name: 'X', basePrice: '10.00' },
        {},
      ]) {
        await http().post('/v1/admin/products').set('Authorization', auth).send(bad).expect(400);
      }
      expect(repo.count('insert')).toBe(0);
    });

    it('503 PRODUCTS_BUSY con mensaje fijo ante timeout de la transacción; un 500 genérico no expone code', async () => {
      const auth = await asStaff();
      repo.failTransactionWith = Object.assign(
        new Error('Transaction already closed host=db-prod'),
        {
          code: 'P2028',
        },
      );
      const busy = await http()
        .post('/v1/admin/products')
        .set('Authorization', auth)
        .send(body())
        .expect(503);
      expect(busy.body).toMatchObject({ statusCode: 503, code: 'PRODUCTS_BUSY' });
      expect(JSON.stringify(busy.body)).not.toContain('db-prod');
      repo.failTransactionWith = new Error('db exploded: password=x');
      const boom = await http()
        .post('/v1/admin/products')
        .set('Authorization', auth)
        .send(body())
        .expect(500);
      expect(boom.body).not.toHaveProperty('code');
      expect(JSON.stringify(boom.body)).not.toContain('password');
    });

    it('un índice único con otro objetivo se responde 500 genérico (no se disfraza de 409)', async () => {
      const auth = await asStaff();
      repo.failNextWriteWith = { code: 'P2002', meta: { target: ['id'] } };
      const res = await http()
        .post('/v1/admin/products')
        .set('Authorization', auth)
        .send(body())
        .expect(500);
      expect(res.body).not.toHaveProperty('code');
    });
  });

  describe('admin: PATCH /v1/admin/products/{id}', () => {
    const patch = async (id: string, payload: Record<string, unknown>, auth?: string) =>
      http()
        .patch(`/v1/admin/products/${id}`)
        .set('Authorization', auth ?? (await asStaff()))
        .send(payload);

    it('edición parcial 200, no-store, updated con old/new y sin tocar lo no enviado', async () => {
      const res = await patch(pid(1), { name: 'Roll Cali', basePrice: '90.00', sku: null }).then(
        (r) => r,
      );
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        name: 'Roll Cali',
        basePrice: '90.00',
        sku: null,
        slug: 'roll-california',
      });
      expect((res.body as { media: unknown[] }).media).toHaveLength(2);
      expect(repo.audit).toHaveLength(1);
      expect(repo.audit[0]).toMatchObject({
        action: 'product.updated',
        entityId: pid(1),
        oldValues: { name: 'Roll California', basePrice: '85.00', sku: 'RC-1' },
        newValues: { name: 'Roll Cali', basePrice: '90.00', sku: null },
      });
    });

    it('cuerpo vacío o propiedades desconocidas => 400; forma inválida => 400', async () => {
      for (const bad of [
        {},
        { id: pid(2) },
        { createdAt: 'x' },
        { publiclyVisible: true },
        { name: 'ok', extra: 1 },
        { basePrice: '10' },
        { basePrice: '0.00' },
        { categoryId: 'x' },
        { active: 'true' },
        { media: [{ url: 'https://x.io/a', id: 'x' }] },
        { slug: 'MAL' },
      ]) {
        expect((await patch(pid(1), bad)).status).toBe(400);
      }
      expect(repo.audit).toHaveLength(0);
    });

    it('sin cambios reales => 200 sin escribir ni auditar', async () => {
      const res = await patch(pid(1), {
        name: 'Roll California',
        basePrice: '85.00',
        active: true,
      });
      expect(res.status).toBe(200);
      expect(repo.count('update')).toBe(0);
      expect(repo.audit).toHaveLength(0);
    });

    it('activar/desactivar audita product.deactivated/activated y cambia la visibilidad pública', async () => {
      await http().get('/v1/store/products/roll-california').expect(200);
      const off = await patch(pid(1), { active: false });
      expect(off.body).toMatchObject({ active: false, publiclyVisible: false });
      expect(repo.audit.map((a) => a['action'])).toEqual(['product.deactivated']);
      await http().get('/v1/store/products/roll-california').expect(404);
      const on = await patch(pid(1), { active: true });
      expect(on.body).toMatchObject({ active: true, publiclyVisible: true });
      expect(repo.audit.map((a) => a['action'])).toEqual([
        'product.deactivated',
        'product.activated',
      ]);
    });

    it('media enviada REEMPLAZA (orden 0..n-1); [] la vacía; omitirla no la toca', async () => {
      const swapped = await patch(pid(1), {
        media: [{ url: 'https://cdn.x.io/z.jpg', altText: 'Z' }, { url: 'https://cdn.x.io/1.jpg' }],
      });
      expect((swapped.body as { media: unknown[] }).media).toMatchObject([
        { sortOrder: 0, url: 'https://cdn.x.io/z.jpg', altText: 'Z' },
        { sortOrder: 1, url: 'https://cdn.x.io/1.jpg', altText: null },
      ]);
      const emptied = await patch(pid(1), { media: [] });
      expect((emptied.body as { media: unknown[] }).media).toEqual([]);
      const untouched = await patch(pid(1), { name: 'Otro nombre' });
      expect((untouched.body as { media: unknown[] }).media).toEqual([]);
    });

    it('media inválida => 422 y NO se pierden las imágenes existentes (rollback)', async () => {
      const bad = await patch(pid(1), { media: [{ url: 'http://x.io/a.jpg' }] });
      expect(bad.status).toBe(422);
      expect(bad.body).toMatchObject({ code: 'PRODUCT_MEDIA_INVALID' });
      expect(repo.media.get(pid(1))).toHaveLength(2);
    });

    it('slug o sku repetido => 409; mover a categoría inactiva/inexistente => 422; editar sin mover con categoría inactiva OK', async () => {
      expect((await patch(pid(1), { slug: 'roll-vegano' })).body).toMatchObject({
        code: 'PRODUCT_SLUG_TAKEN',
      });
      repo.seed(productRow(pid(6), { slug: 'otro', sku: 'ZZ-9' }));
      const dupSku = await patch(pid(1), { sku: 'zz-9' });
      expect(dupSku.status).toBe(409);
      expect(dupSku.body).toMatchObject({ code: 'PRODUCT_SKU_TAKEN' });
      for (const categoryId of [CAT.calientes, CAT_MISSING]) {
        const res = await patch(pid(1), { categoryId });
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({ code: 'PRODUCT_CATEGORY_INVALID' });
      }
      const edited = await patch(pid(5), { name: 'Oculto editado' }); // sigue en categoría inactiva
      expect(edited.status).toBe(200);
      const moved = await patch(pid(5), { categoryId: CAT.bebidas });
      expect(moved.body).toMatchObject({ publiclyVisible: true, category: { slug: 'bebidas' } });
    });

    it('inexistente => 404 PRODUCT_NOT_FOUND; UUID inválido => 400', async () => {
      const nf = await patch(MISSING, { name: 'x' });
      expect(nf.status).toBe(404);
      expect(nf.body).toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
      expect((await patch('no-es-uuid', { name: 'x' })).status).toBe(400);
    });

    it('503 PRODUCTS_BUSY ante timeout', async () => {
      repo.failTransactionWith = { code: 'P2028' };
      const res = await patch(pid(1), { name: 'x' });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'PRODUCTS_BUSY' });
    });

    it('PUT sigue sin existir (solo PATCH edita; DELETE llegó con ADR-0035)', async () => {
      const auth = await asStaff();
      await http()
        .put(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', auth)
        .send({})
        .expect(404);
    });
  });

  describe('admin: DELETE /v1/admin/products/{id} (ADR-0035)', () => {
    const del = async (id: string, auth?: string) =>
      http()
        .delete(`/v1/admin/products/${id}`)
        .set('Authorization', auth ?? (await asStaff()));

    it('producto libre => 204 sin cuerpo, no-store, borra ofertas de sucursal y producto, audita y libera assets de PRODUCT_IMAGE', async () => {
      repo.seed(productRow(pid(10), { name: 'Libre', slug: 'libre', sku: 'LB-1' }), [
        { url: 'https://cdn.x.io/a.jpg', assetId: 'asset-a' },
        { url: 'https://cdn.x.io/b.jpg', assetId: 'asset-a' },
        { url: 'https://ext.io/c.jpg' },
      ]);
      repo.branchOffers.set(pid(10), [
        { branchId: 'b1', priceOverride: '70.00', available: true },
        { branchId: 'b2', priceOverride: null, available: false },
      ]);
      const res = await del(pid(10));
      expect(res.status).toBe(204);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).toBe('');
      expect(repo.products.has(pid(10))).toBe(false);
      expect(repo.branchOffers.has(pid(10))).toBe(false);
      expect(repo.audit).toHaveLength(1);
      expect(repo.audit[0]).toMatchObject({
        action: 'product.deleted',
        entityType: 'product',
        entityId: pid(10),
        actorId: STAFF_ID,
        oldValues: {
          id: pid(10),
          slug: 'libre',
          sku: 'LB-1',
          name: 'Libre',
          active: true,
          basePrice: '50.00',
          branchOffers: ['b1|70.00|available', 'b2|base|unavailable'],
        },
      });
      expect(releaser.released).toEqual([{ assetId: 'asset-a', kind: 'PRODUCT_IMAGE' }]);
      // Repetir => 404 sin efectos.
      expect((await del(pid(10))).status).toBe(404);
      expect(repo.audit).toHaveLength(1);
    });

    it('con pedidos => 409 PRODUCT_IN_USE con usage, no-store, sin ids ni nombres; no borra ni audita ni libera', async () => {
      repo.usage.set(pid(1), { orders: 3, promotions: 0, banners: 0 });
      const res = await del(pid(1));
      expect(res.status).toBe(409);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        statusCode: 409,
        code: 'PRODUCT_IN_USE',
        usage: { orders: 3, promotions: 0, banners: 0 },
      });
      const body = res.body as { message: string };
      expect(body.message).toContain('3 pedidos');
      expect(body.message).toContain('desactívalo');
      expect(JSON.stringify(res.body)).not.toContain('Roll California');
      expect(repo.products.has(pid(1))).toBe(true);
      expect(repo.audit).toHaveLength(0);
      expect(releaser.released).toEqual([]);
    });

    it('con promociones, con banners y combinados => 409 con los conteos reales', async () => {
      repo.usage.set(pid(1), { orders: 0, promotions: 2, banners: 0 });
      let res = await del(pid(1));
      expect(res.status).toBe(409);
      expect((res.body as { usage: unknown }).usage).toEqual({
        orders: 0,
        promotions: 2,
        banners: 0,
      });
      repo.usage.set(pid(1), { orders: 0, promotions: 0, banners: 1 });
      res = await del(pid(1));
      expect((res.body as { usage: unknown }).usage).toEqual({
        orders: 0,
        promotions: 0,
        banners: 1,
      });
      repo.usage.set(pid(1), { orders: 5, promotions: 1, banners: 1 });
      res = await del(pid(1));
      expect((res.body as { usage: unknown }).usage).toEqual({
        orders: 5,
        promotions: 1,
        banners: 1,
      });
      expect(repo.products.has(pid(1))).toBe(true);
    });

    it('inexistente => 404 PRODUCT_NOT_FOUND; id no UUID => 400', async () => {
      const gone = await del(MISSING);
      expect(gone.status).toBe(404);
      expect(gone.body).toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
      expect((await del('no-es-uuid')).status).toBe(400);
      expect(repo.audit).toHaveLength(0);
    });

    it('sin JWT / JWT ajeno => 401; cliente => 403; aal1 => 403 MFA_REQUIRED; sin catalog.update => 403', async () => {
      await http()
        .delete(`/v1/admin/products/${pid(1)}`)
        .expect(401);
      await http()
        .delete(`/v1/admin/products/${pid(1)}`)
        .set('Authorization', `Bearer ${await keys.signWithForeignKey()}`)
        .expect(401);
      await del(pid(1), await bearer(AAL2)).then((r) => expect(r.status).toBe(403));
      const aal1 = await del(pid(1), await asStaff({}, {}));
      expect(aal1.status).toBe(403);
      expect((aal1.body as { message: string }).message).toBe('MFA_REQUIRED');
      for (const permissions of [
        ['catalog.read'],
        ['catalog.create'],
        ['catalog.read', 'catalog.create'],
      ]) {
        expect((await del(pid(1), await asStaff({ permissions }))).status).toBe(403);
      }
      expect(repo.calls).toEqual([]);
      expect(repo.products.has(pid(1))).toBe(true);
    });

    it('alcance acotado a sucursal => 403 genérico antes de leer (incluso con id inexistente)', async () => {
      const auth = await asStaff({ branchId: '00000000-0000-4000-8000-000000000500' });
      const res = await del(MISSING, auth);
      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toBe('Acceso denegado');
      expect(repo.calls).toEqual([]);
      expect(repo.audit).toEqual([]);
    });

    it('carrera 23503 => 409 con el usage recontado fuera de la transacción; sin uso => 503 PRODUCTS_BUSY', async () => {
      repo.beforeDelete = () => repo.usage.set(pid(1), { orders: 1, promotions: 0, banners: 0 });
      repo.failNextDeleteWith = Object.assign(new Error('fk'), { code: 'P2003' });
      const conflict = await del(pid(1));
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({
        code: 'PRODUCT_IN_USE',
        usage: { orders: 1, promotions: 0, banners: 0 },
      });
      repo.beforeDelete = null;
      repo.usage.clear();
      repo.failNextDeleteWith = { cause: { code: '23503' } };
      const busy = await del(pid(1));
      expect(busy.status).toBe(503);
      expect(busy.body).toMatchObject({ code: 'PRODUCTS_BUSY' });
      expect(busy.body).not.toHaveProperty('usage');
      expect(repo.products.has(pid(1))).toBe(true);
      expect(repo.audit).toHaveLength(0);
    });

    it('lock_timeout (55P03) => 503 PRODUCTS_BUSY reintentable', async () => {
      repo.failTransactionWith = { cause: { code: '55P03' } };
      const res = await del(pid(1));
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'PRODUCTS_BUSY' });
    });

    it('fallo del almacenamiento al liberar assets => igualmente 204; MEDIA_IN_USE (asset compartido) se ignora', async () => {
      repo.seed(productRow(pid(11), { slug: 'con-img' }), [
        { url: 'https://cdn.x.io/a.jpg', assetId: 'asset-x' },
      ]);
      releaser.failWith = Object.assign(new Error('r2 down'), {
        response: { code: 'MEDIA_STORAGE_UNAVAILABLE' },
      });
      expect((await del(pid(11))).status).toBe(204);
      expect(repo.products.has(pid(11))).toBe(false);
      repo.seed(productRow(pid(12), { slug: 'compartida' }), [
        { url: 'https://cdn.x.io/s.jpg', assetId: 'asset-shared' },
      ]);
      releaser.failWith = Object.assign(new Error('in use'), {
        response: { code: 'MEDIA_IN_USE' },
      });
      expect((await del(pid(12))).status).toBe(204);
      expect(releaser.released).toEqual([]);
    });
  });
});
