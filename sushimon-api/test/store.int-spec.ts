import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { AdminBranchProductsService } from '../src/branch-products/admin-branch-products.service.js';
import { BranchOffersService } from '../src/branch-products/branch-offers.service.js';
import { BranchProductsRepository } from '../src/branch-products/branch-products.repository.js';
import { BannersReadRepository } from '../src/banners/banners-read.repository.js';
import { BannersTimeService } from '../src/banners/banners-time.service.js';
import { PublicBannersReader } from '../src/banners/public-banners.reader.js';
import { BranchAvailabilityService } from '../src/branch-schedule/branch-availability.service.js';
import { BranchScheduleRepository } from '../src/branch-schedule/branch-schedule.repository.js';
import { SystemClock } from '../src/branch-schedule/clock.js';
import { BranchesQueryService } from '../src/branches/branches-query.service.js';
import { BranchesRepository } from '../src/branches/branches.repository.js';
import { AdminCategoriesService } from '../src/categories/admin-categories.service.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import { MediaUrlService } from '../src/media/media-url.service.js';
import { ModifiersQueryService } from '../src/modifiers/modifiers-query.service.js';
import { ModifiersRepository } from '../src/modifiers/modifiers.repository.js';
import { ProductsQueryService } from '../src/products/products-query.service.js';
import { ProductsRepository } from '../src/products/products.repository.js';
import { PromotionTimeService } from '../src/promotions/promotion-time.service.js';
import { PromotionsRepository } from '../src/promotions/promotions.repository.js';
import { PublicPromotionsService } from '../src/promotions/public-promotions.service.js';
import { StoreDbGate } from '../src/store/concurrency.js';
import { StoreBootstrapService } from '../src/store/store-bootstrap.service.js';
import { StoreCatalogRepository } from '../src/store/store-catalog.repository.js';
import { StoreCatalogService } from '../src/store/store-catalog.service.js';
import { StoreProductService } from '../src/store/store-product.service.js';
import { cleanupTestData, TEST_URL, withClient } from './support/db.js';
import { mediaConfig } from './support/media-harness.js';
import { globalStaff } from './support/staff-context.js';

const url = TEST_URL;
const TZ = 'America/Guatemala';

/**
 * Se omite (con aviso) si no hay DATABASE_URL_TEST o si faltan las tablas de F13/F15/F16 (migraciones 0014/0016/0017 sin
 * aplicar). F17 NO tiene migración. NO se ejecuta contra Supabase compartido: usar una BD desechable. Mientras no corra,
 * el SQL de `StoreCatalogRepository` (LEFT JOIN, count OVER, array_position, plegado + LIKE) NO está probado en PostgreSQL real.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['app.products','app.branch_products','app.product_media','app.promotions','app.banners']) t
          WHERE to_regclass(t) IS NOT NULL`,
      );
      return (res.rows[0]?.n ?? 0) === 5;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[store.int-spec] OMITIDA: faltan tablas de F11/F13/F15/F16 en DATABASE_URL_TEST. El SQL de F17 NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)('Agregados públicos de la tienda contra PostgreSQL real', () => {
  const run = randomUUID().slice(0, 8);
  const staff = globalStaff(
    ['catalog.read', 'catalog.create', 'catalog.update', 'catalog.manage_availability'],
    { staffId: randomUUID() },
  );
  let prisma: PrismaService;
  let categories: AdminCategoriesService;
  let branchAdmin: AdminBranchProductsService;
  let catalog: StoreCatalogService;
  let bootstrap: StoreBootstrapService;
  let detail: StoreProductService;
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const branchIds = new Set<string>();
  const promotionIds = new Set<string>();
  const queries = { n: 0 };
  let originalQuery: typeof pg.Client.prototype.query;

  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('faltan tablas de F11/F13/F15/F16');
  };
  const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const newBranch = async (active = true) => {
    const b = await prisma.branch.create({
      data: {
        code: `st-${run}-${randomUUID().slice(0, 6)}`,
        name: `Suc ${run}`,
        address: 'Zona 1',
        active,
      },
    });
    branchIds.add(b.id);
    return b.id;
  };
  const newCategory = async (name: string, parentId: string | null = null, active = true) => {
    const c = await categories.create(staff, { name: `${name} ${run}`, parentId, active });
    categoryIds.add(c.id);
    return c;
  };
  const newProducts = async (
    categoryId: string,
    count: number,
    prefix: string,
    over: { active?: boolean; description?: string | null } = {},
  ) => {
    const data = Array.from({ length: count }, (_, i) => ({
      categoryId,
      slug: `${prefix}-${run}-${i}`,
      name: `${prefix} ${run} ${String(i).padStart(3, '0')}`,
      description: over.description ?? null,
      basePrice: '50.00',
      active: over.active ?? true,
    }));
    const rows = await prisma.product.createManyAndReturn({ data, select: { id: true } });
    for (const r of rows) productIds.add(r.id);
    return rows.map((r) => r.id);
  };
  /** Cuenta las consultas que llegan a PostgreSQL (una por `Client.query`); instrumentación propia, no el evento de Prisma. */
  const measure = async <T>(fn: () => Promise<T>) => {
    queries.n = 0;
    const result = await fn();
    return { result, n: queries.n };
  };

  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalQuery = pg.Client.prototype.query;
    vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      queries.n += 1;
      return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
    });
    prisma = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '8', NODE_ENV: 'test' }),
      ),
    );
    const authorization = new AuthorizationService({} as IdentityService);
    const audit = new AuditService();
    const catRepo = new CategoriesRepository(prisma);
    const catQuery = new CategoriesQueryService(catRepo);
    const bpRepo = new BranchProductsRepository(prisma);
    categories = new AdminCategoriesService(catRepo, audit, authorization);
    branchAdmin = new AdminBranchProductsService(bpRepo, audit, authorization, catQuery);
    const clock = new SystemClock();
    const branches = new BranchesQueryService(new BranchesRepository(prisma), authorization);
    const offers = new BranchOffersService(bpRepo, catQuery);
    const promotions = new PublicPromotionsService(
      new PromotionsRepository(prisma),
      new PromotionTimeService(clock, TZ),
      offers,
      catQuery,
    );
    const storeRepo = new StoreCatalogRepository(prisma);
    catalog = new StoreCatalogService(storeRepo, catQuery, branches, promotions, clock);
    bootstrap = new StoreBootstrapService(
      branches,
      catQuery,
      storeRepo,
      new BranchAvailabilityService(new BranchScheduleRepository(prisma), clock, TZ),
      promotions,
      new PublicBannersReader(
        new BannersReadRepository(prisma),
        new BannersTimeService(clock, TZ),
        new MediaUrlService(mediaConfig()),
      ),
      clock,
      new StoreDbGate(2, 8, 1_500),
    );
    detail = new StoreProductService(
      new ProductsQueryService(
        new ProductsRepository(prisma),
        catQuery,
        new ModifiersQueryService(new ModifiersRepository(prisma)),
      ),
      branches,
      offers,
      promotions,
      clock,
    );
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (promotionIds.size > 0) {
      await prisma.promotion.deleteMany({ where: { id: { in: [...promotionIds] } } });
    }
    await prisma.$disconnect();
    if (ready && url) {
      await cleanupTestData(url, { authUserIds: [], branchIds, productIds, categoryIds });
    }
  });

  const menuInput = (over = {}) => ({
    sort: 'menu' as const,
    order: 'asc' as const,
    page: 1,
    pageSize: 100,
    ...over,
  });

  it('menú: precio por sucursal (override), agotado visible, ocultos/inactivos nunca, categoría inactiva oculta a sus hijas', async (ctx) => {
    skipUnlessReady(ctx);
    const [a, b] = [await newBranch(), await newBranch()];
    const root = await newCategory('Raíz');
    const child = await newCategory('Hija', root.id);
    const off = await newCategory('Apagada', null, false);
    const underOff = await newCategory('BajoApagada', off.id);
    const [p1] = await newProducts(child.id, 1, 'visible', { description: 'Salmón fresco' });
    const [hidden] = await newProducts(underOff.id, 1, 'oculto');
    const [inactive] = await newProducts(child.id, 1, 'inactivo', { active: false });
    await branchAdmin.setPricing(staff, a, p1!, { priceOverride: '45.50' });
    await branchAdmin.setPricing(staff, b, p1!, { priceOverride: '99.00' });
    await branchAdmin.setAvailability(staff, p1!, { branchId: b, available: false });

    const menuA = await catalog.menu(menuInput({ branchId: a, categorySlug: child.slug }));
    expect(menuA.items.map((i) => i.productId)).toEqual([p1]);
    expect(menuA.items[0]).toMatchObject({ price: '45.50', available: true });
    const menuB = await catalog.menu(menuInput({ branchId: b, categorySlug: child.slug }));
    expect(menuB.items[0]).toMatchObject({ price: '99.00', available: false });
    expect(JSON.stringify(menuA)).not.toContain('99.00');
    const none = await catalog.menu(menuInput({ categorySlug: child.slug }));
    expect(none.items[0]).toMatchObject({ price: '50.00', available: null });
    const only = await catalog.menu(
      menuInput({ branchId: b, available: true, categorySlug: child.slug }),
    );
    expect(only).toMatchObject({ items: [], total: 0 });

    const all = await catalog.menu(menuInput({ branchId: a, pageSize: 100 }));
    const ids = all.items.map((i) => i.productId);
    expect(ids).not.toContain(hidden);
    expect(ids).not.toContain(inactive);
    expect(code(await failure(catalog.menu(menuInput({ branchId: randomUUID() }))))).toBe(
      'BRANCH_NOT_FOUND',
    );
    expect(code(await failure(catalog.menu(menuInput({ branchId: await newBranch(false) }))))).toBe(
      'BRANCH_NOT_FOUND',
    );
  });

  it('menú paginado: total estable, último parcial y página fuera de rango', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await newCategory('Paginada');
    await newProducts(cat.id, 7, 'pag');
    const input = (page: number) => menuInput({ categorySlug: cat.slug, pageSize: 3, page });
    const [p1, p2, p3, p4] = [
      await catalog.menu(input(1)),
      await catalog.menu(input(2)),
      await catalog.menu(input(3)),
      await catalog.menu(input(4)),
    ];
    expect([p1.items.length, p2.items.length, p3.items.length, p4.items.length]).toEqual([
      3, 3, 1, 0,
    ]);
    expect([p1.total, p2.total, p3.total, p4.total]).toEqual([7, 7, 7, 7]);
    const names = [...p1.items, ...p2.items, ...p3.items].map((i) => i.name);
    expect(names).toEqual([...names].sort());
  });

  it('búsqueda: nombre, descripción y categoría; acentos; comodines literales; orden por grupo; ocultos nunca', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await newCategory('Salmoneria');
    const other = await newCategory('Otra');
    const prefixId = (
      await prisma.product.create({
        data: {
          categoryId: other.id,
          slug: `a-${run}`,
          name: `Salmón ${run} prefijo`,
          basePrice: '10.00',
        },
      })
    ).id;
    const containsId = (
      await prisma.product.create({
        data: {
          categoryId: other.id,
          slug: `b-${run}`,
          name: `Roll de salmon ${run}`,
          basePrice: '10.00',
        },
      })
    ).id;
    const descId = (
      await prisma.product.create({
        data: {
          categoryId: other.id,
          slug: `c-${run}`,
          name: `Zeta ${run}`,
          description: `con SALMÓN ${run}`,
          basePrice: '10.00',
        },
      })
    ).id;
    const [inCategory] = await newProducts(cat.id, 1, 'cat');
    for (const id of [prefixId, containsId, descId]) productIds.add(id);
    const [hiddenId] = await newProducts(other.id, 1, `salmon-inactivo-${run}`, { active: false });
    const r = await catalog.search({ q: `salmon`, page: 1, pageSize: 50 });
    const ids = r.items.map((i) => i.productId);
    const pos = (id: string | undefined) => ids.indexOf(id!);
    expect(pos(prefixId)).toBeGreaterThanOrEqual(0);
    expect(pos(prefixId)).toBeLessThan(pos(containsId));
    expect(pos(containsId)).toBeLessThan(pos(descId));
    expect(pos(inCategory)).toBeGreaterThan(pos(containsId)); // solo por el nombre de la categoría (grupo 3)
    expect(ids).not.toContain(hiddenId);
    // `%` y `_` son literales: ninguno coincide con todo
    for (const q of ['%%', '__', '\\\\']) {
      const lit = await catalog.search({ q, page: 1, pageSize: 50 });
      expect(
        lit.items.every(
          (i) =>
            `${i.name}${i.summary ?? ''}`.includes(q.slice(0, 1)) ||
            i.category.name.includes(q.slice(0, 1)),
        ),
      ).toBe(true);
    }
    // inyección: texto inerte
    expect(
      (await catalog.search({ q: "'; SELECT pg_sleep(5); --", page: 1, pageSize: 5 })).items,
    ).toEqual([]);
    // orden estable entre llamadas
    const again = await catalog.search({ q: `salmon`, page: 1, pageSize: 50 });
    expect(again.items.map((i) => i.productId)).toEqual(ids);
  });

  it('promoción indicativa solo vigente; cupón nunca; bootstrap la lista sin items ni código', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await newBranch();
    const cat = await newCategory('Promo');
    const [p] = await newProducts(cat.id, 1, 'promo');
    const now = Date.now();
    const mk = async (data: { name: string; code?: string; startsAt: Date; endsAt: Date }) => {
      const row = await prisma.promotion.create({
        data: {
          name: `${data.name} ${run}`,
          code: data.code ?? null,
          kind: 'PERCENT',
          value: '20.00',
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          branches: { create: [{ branchId: a }] },
        },
      });
      promotionIds.add(row.id);
      return row;
    };
    const live = await mk({
      name: 'Vigente',
      startsAt: new Date(now - 3_600_000),
      endsAt: new Date(now + 3_600_000),
    });
    await mk({
      name: 'Vencida',
      startsAt: new Date(now - 7_200_000),
      endsAt: new Date(now - 3_600_000),
    });
    const coupon = `CUPON${run.toUpperCase()}`;
    await mk({
      name: 'Cupon',
      code: coupon,
      startsAt: new Date(now - 3_600_000),
      endsAt: new Date(now + 3_600_000),
    });
    const menu = await catalog.menu(menuInput({ branchId: a, categorySlug: cat.slug }));
    expect(menu.items[0]?.promo).toMatchObject({
      promotionId: live.id,
      regularPrice: '50.00',
      promoPrice: '40.00',
    });
    expect(menu.nextChangeAt).toBe(new Date(now + 3_600_000).toISOString());
    const d = await detail.getDetail(`promo-${run}-0`, a);
    expect(d.offer).toMatchObject({ branchId: a, price: '50.00', available: true });
    expect(d.promotions).toHaveLength(1);
    expect(p).toBeDefined();
    const boot = await bootstrap.getBootstrap({ branchId: a, locale: 'es' });
    expect(boot.promotions.map((x) => x.name)).toEqual(
      expect.arrayContaining([`Vigente ${run}`, `Cupon ${run}`]),
    );
    expect(JSON.stringify(boot)).not.toContain(coupon);
    expect(boot.promotions.every((x) => !('items' in x))).toBe(true);
    expect(boot.degraded).toEqual([]);
  });

  it('SIN N+1: las consultas por solicitud no crecen con 10 → 110 productos (menú, búsqueda, bootstrap, ficha)', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await newBranch();
    const cat = await newCategory('Volumen');
    await newProducts(cat.id, 10, 'vol');
    const run10 = {
      menu: await measure(() => catalog.menu(menuInput({ branchId: a, categorySlug: cat.slug }))),
      search: await measure(() =>
        catalog.search({ q: `vol ${run}`, branchId: a, page: 1, pageSize: 50 }),
      ),
      boot: await measure(() => bootstrap.getBootstrap({ branchId: a, locale: 'es' })),
      detail: await measure(() => detail.getDetail(`vol-${run}-0`, a)),
    };
    await newProducts(cat.id, 100, 'volb');
    await prisma.product.updateMany({
      where: { slug: { startsWith: `volb-${run}` } },
      data: { name: `vol ${run} extra` },
    });
    const run110 = {
      menu: await measure(() => catalog.menu(menuInput({ branchId: a, categorySlug: cat.slug }))),
      search: await measure(() =>
        catalog.search({ q: `vol ${run}`, branchId: a, page: 1, pageSize: 50 }),
      ),
      boot: await measure(() => bootstrap.getBootstrap({ branchId: a, locale: 'es' })),
      detail: await measure(() => detail.getDetail(`vol-${run}-0`, a)),
    };
    expect(run110.menu.result.total).toBe(110);
    for (const k of ['menu', 'search', 'boot', 'detail'] as const) {
      expect(run110[k].n, k).toBe(run10[k].n);
    }
    // Números medidos (se imprimen para la tabla Antes/Después de la spec 018).
    console.info(
      `[store.int-spec] consultas a PostgreSQL por solicitud (10 y 110 productos): ${JSON.stringify(
        Object.fromEntries(
          (['menu', 'search', 'boot', 'detail'] as const).map((k) => [
            k,
            [run10[k].n, run110[k].n],
          ]),
        ),
      )}`,
    );
  });
});
