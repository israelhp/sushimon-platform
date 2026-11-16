import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { AdminCategoriesService } from '../src/categories/admin-categories.service.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ProductsCatalogAdapter } from '../src/favorites/products-catalog.adapter.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import { AdminProductsService } from '../src/products/admin-products.service.js';
import { ProductsQueryService } from '../src/products/products-query.service.js';
import { ProductsRepository } from '../src/products/products.repository.js';
import { globalStaff } from './support/staff-context.js';
import { cleanupTestData, TEST_URL, withClient } from './support/db.js';

const url = TEST_URL;

/**
 * Se omite (con aviso) si no hay DATABASE_URL_TEST o si la migración 0012 aún no está aplicada (`app.products`
 * ausente). La 0012 requiere aprobación humana y NO se aplica desde aquí: hasta entonces el SQL de F11 (búsqueda con
 * `translate`/`LIKE`, FOR NO KEY UPDATE, DELETE+INSERT de media, índices únicos, trigger de tope) NO está probado contra
 * PostgreSQL real. Ver también `migration-0012.int-spec.ts` (estructura sobre una base desechable).
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ p: string | null; c: string | null }>(
        `SELECT to_regclass('app.products') AS p, to_regclass('app.categories') AS c`,
      );
      return res.rows[0]?.p != null && res.rows[0]?.c != null;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[products.int-spec] OMITIDA: app.products no existe en DATABASE_URL_TEST (migración 0012 sin aplicar). El SQL de F11 NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)('Productos contra PostgreSQL real', () => {
  const run = randomUUID().slice(0, 8);
  const staff = globalStaff(['catalog.read', 'catalog.create', 'catalog.update'], {
    staffId: randomUUID(),
  });
  let prisma: PrismaService;
  let categoriesCmd: AdminCategoriesService;
  let commands: AdminProductsService;
  let queries: ProductsQueryService;
  let adapter: ProductsCatalogAdapter;
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();

  const category = async (name: string, parentId: string | null = null, active = true) => {
    const view = await categoriesCmd.create(staff, { name: `${name} ${run}`, parentId, active });
    categoryIds.add(view.id);
    return view;
  };
  const product = async (
    categoryId: string,
    name: string,
    over: Partial<Parameters<AdminProductsService['create']>[1]> = {},
  ) => {
    const view = await commands.create(staff, {
      name: `${name} ${run}`,
      basePrice: '10.00',
      categoryId,
      ...over,
    });
    productIds.add(view.id);
    return view;
  };
  const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready)
      ctx.skip('app.products no existe en DATABASE_URL_TEST (migración 0012 sin aplicar)');
  };

  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '8', NODE_ENV: 'test' }),
      ),
    );
    const catRepo = new CategoriesRepository(prisma);
    const authorization = new AuthorizationService({} as IdentityService);
    categoriesCmd = new AdminCategoriesService(catRepo, new AuditService(), authorization);
    const catQuery = new CategoriesQueryService(catRepo);
    const repo = new ProductsRepository(prisma);
    commands = new AdminProductsService(repo, new AuditService(), authorization, catQuery, {
      get: () => [],
    } as unknown as ConfigService<Env, true>);
    queries = new ProductsQueryService(repo, catQuery);
    adapter = new ProductsCatalogAdapter(queries);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    if (ready && url) {
      await cleanupTestData(url, { authUserIds: [], branchIds: [], productIds, categoryIds });
    }
  });

  it('crea con precio exacto, slug autogenerado/desambiguado, sku en mayúsculas y media ordenada', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await category('Rolls');
    const a = await product(cat.id, 'Roll Único', {
      basePrice: '0.10',
      sku: `sku-${run}`,
      media: [
        { url: 'https://cdn.example.com/a.jpg', altText: 'A' },
        { url: 'https://cdn.example.com/b.jpg' },
      ],
    });
    expect(a).toMatchObject({ basePrice: '0.10', sku: `SKU-${run}`.toUpperCase(), active: true });
    expect(a.media.map((m) => [m.sortOrder, m.url])).toEqual([
      [0, 'https://cdn.example.com/a.jpg'],
      [1, 'https://cdn.example.com/b.jpg'],
    ]);
    const twin = await product(cat.id, 'Roll Único');
    expect(twin.slug).toBe(`${a.slug}-2`);
    expect((await queries.getAdmin(a.id)).basePrice).toBe('0.10');
  });

  it('índices únicos: slug explícito y sku repetidos => 409 por columna (traducción real del driver)', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await category('Unicos');
    const a = await product(cat.id, 'Uno', { sku: `u-${run}` });
    const dupSlug = await failure(
      commands.create(staff, { name: 'X', basePrice: '1.00', categoryId: cat.id, slug: a.slug }),
    );
    expect(dupSlug).toMatchObject({ status: 409 });
    expect(code(dupSlug)).toBe('PRODUCT_SLUG_TAKEN');
    const dupSku = await failure(
      commands.create(staff, {
        name: `Y ${run}`,
        basePrice: '1.00',
        categoryId: cat.id,
        sku: `U-${run}`,
      }),
    );
    expect(dupSku).toMatchObject({ status: 409 });
    expect(code(dupSku)).toBe('PRODUCT_SKU_TAKEN');
    // carrera: dos altas simultáneas con el mismo slug explícito => exactamente una gana
    const slug = `carrera-${run}`;
    const results = await Promise.allSettled([
      commands.create(staff, { name: `C1 ${run}`, basePrice: '1.00', categoryId: cat.id, slug }),
      commands.create(staff, { name: `C2 ${run}`, basePrice: '1.00', categoryId: cat.id, slug }),
    ]);
    for (const r of results) if (r.status === 'fulfilled') productIds.add(r.value.id);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(code(lost.reason)).toBe('PRODUCT_SLUG_TAKEN');
  });

  it('PATCH reemplaza la media (DELETE+INSERT; sort_order 0..n-1), [] la vacía, y el tope de 8 lo defiende el trigger', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await category('Media');
    const p = await product(cat.id, 'Con media', {
      media: [
        { url: 'https://cdn.example.com/1.jpg' },
        { url: 'https://cdn.example.com/2.jpg' },
        { url: 'https://cdn.example.com/3.jpg' },
      ],
    });
    const swapped = await commands.update(staff, p.id, {
      media: [
        { url: 'https://cdn.example.com/3.jpg' },
        { url: 'https://cdn.example.com/1.jpg', altText: 'Uno' },
      ],
    });
    expect(swapped.media.map((m) => [m.sortOrder, m.url, m.altText])).toEqual([
      [0, 'https://cdn.example.com/3.jpg', null],
      [1, 'https://cdn.example.com/1.jpg', 'Uno'],
    ]);
    const eight = Array.from({ length: 8 }, (_, i) => ({
      url: `https://cdn.example.com/e${i}.jpg`,
    }));
    expect((await commands.update(staff, p.id, { media: eight })).media).toHaveLength(8);
    expect((await commands.update(staff, p.id, { media: [] })).media).toEqual([]);
    // defensa en profundidad: un INSERT directo del noveno viola el trigger (23514 product_media_max_items)
    await commands.update(staff, p.id, { media: eight });
    await expect(
      prisma.productMedia.create({
        data: { productId: p.id, mediaUrl: 'https://cdn.example.com/9.jpg', sortOrder: 8 },
      }),
    ).rejects.toThrow(/product_media_max_items|23514/);
  });

  it('dos reemplazos simultáneos de media del mismo producto se serializan (FOR NO KEY UPDATE): gana uno, sin mezcla ni 500', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await category('Concurrencia');
    const p = await product(cat.id, 'Concurrente', {
      media: [{ url: 'https://cdn.example.com/base.jpg' }],
    });
    const listA = [0, 1, 2].map((i) => ({ url: `https://cdn.example.com/a${i}.jpg` }));
    const listB = [0, 1].map((i) => ({ url: `https://cdn.example.com/b${i}.jpg` }));
    const results = await Promise.allSettled([
      commands.update(staff, p.id, { media: listA }),
      commands.update(staff, p.id, { media: listB }),
    ]);
    const failed = results.filter((r) => r.status === 'rejected');
    for (const r of failed) expect(code(r.reason)).toBe('PRODUCTS_BUSY'); // solo el timeout reintentable es admisible
    const final = (await queries.getAdmin(p.id)).media.map((m) => m.url);
    expect([listA.map((m) => m.url), listB.map((m) => m.url)]).toContainEqual(final);
  });

  it('visibilidad real: inactivo y categoría (o ancestro) inactiva se ocultan; categorySlug incluye descendientes', async (ctx) => {
    skipUnlessReady(ctx);
    const root = await category('Vis Raiz');
    const child = await category('Vis Hija', root.id);
    const a = await product(root.id, 'Visible A');
    const b = await product(child.id, 'Visible B');
    const off = await product(child.id, 'Apagado', { active: false });
    const slugs = async (categorySlug: string) =>
      (await queries.getPublicList({ categorySlug, page: 1, pageSize: 100 })).items
        .map((i) => i.slug)
        .sort();
    expect(await slugs(root.slug)).toEqual([a.slug, b.slug].sort());
    expect(await slugs(child.slug)).toEqual([b.slug]);
    expect(await queries.findVisibleBySlug(off.slug)).toBeNull();
    expect((await queries.findVisibleBySlug(b.slug))?.categoryAncestors.map((x) => x.id)).toEqual([
      root.id,
    ]);
    await categoriesCmd.update(staff, root.id, { active: false });
    expect(await slugs(root.slug)).toEqual([]);
    expect(await queries.findVisibleBySlug(b.slug)).toBeNull();
    expect((await queries.getAdmin(b.id)).publiclyVisible).toBe(false);
    // administrar con categoría inactiva está permitido; mover a una inactiva no
    await expect(commands.update(staff, b.id, { name: `Editado ${run}` })).resolves.toBeDefined();
    expect(code(await failure(commands.update(staff, b.id, { categoryId: root.id })))).toBe(
      'PRODUCT_CATEGORY_INVALID',
    );
    await categoriesCmd.update(staff, root.id, { active: true });
    expect(await slugs(root.slug)).toEqual([a.slug, b.slug].sort());
  });

  it('búsqueda real: sin mayúsculas ni acentos y con % _ \\ literales; nombre, descripción y sku', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await category('Busqueda');
    const tag = `zq${run}`;
    const fria = await product(cat.id, `Té frío ${tag}`, { description: `100% natural_ ${tag}` });
    const sku = await product(cat.id, `Otro ${tag}`, { sku: `SK-${run}` });
    const find = async (q: string) =>
      (
        await queries.getPublicList({ q, categorySlug: cat.slug, page: 1, pageSize: 100 })
      ).items.map((i) => i.id);
    expect(await find(`TE FRIO ${tag}`)).toEqual([fria.id]);
    expect(await find(`100% natural_ ${tag}`)).toEqual([fria.id]);
    expect(await find('%')).toEqual([fria.id]); // solo el literal
    expect(await find('_')).toEqual([fria.id]);
    expect(await find('\\')).toEqual([]);
    expect(await find(`te%${tag}`)).toEqual([]); // `%` no es comodín
    expect(await find(`sk-${run}`)).toEqual([]); // el sku NO se busca en la tienda
    const admin = await queries.listAdmin({
      q: fria.slug,
      sort: 'name',
      order: 'asc',
      page: 1,
      pageSize: 20,
    });
    expect(admin.items.map((i) => i.id)).toEqual([fria.id]);
    const bySku = await queries.listAdmin({
      q: `sk-${run}`,
      sort: 'name',
      order: 'asc',
      page: 1,
      pageSize: 20,
    });
    expect(bySku.items.map((i) => i.id)).toEqual([sku.id]); // en admin sí
  });

  it('paginación y orden estables con empates; total real', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await category('Paginas');
    const made = [];
    for (let i = 0; i < 5; i += 1)
      made.push(await product(cat.id, `Igual ${run}`, { basePrice: '7.00' }));
    const ids = async (page: number) =>
      (
        await queries.listAdmin({
          categoryId: cat.id,
          sort: 'basePrice',
          order: 'desc',
          page,
          pageSize: 2,
        })
      ).items.map((i) => i.id);
    const all = [...(await ids(1)), ...(await ids(2)), ...(await ids(3))];
    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
    expect(all).toEqual([...made.map((m) => m.id)].sort());
    expect(
      await queries.listAdmin({
        categoryId: cat.id,
        sort: 'name',
        order: 'asc',
        page: 9,
        pageSize: 2,
      }),
    ).toMatchObject({ items: [], total: 5 });
  });

  it('CHECK y FK reales: precio fuera de rango no se puede insertar directo; la categoría con productos no se borra (RESTRICT)', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await category('Restrict');
    const p = await product(cat.id, 'Protegido');
    await expect(
      withClient(url as string, (c) =>
        c.query('UPDATE app.products SET base_price = 0 WHERE id = $1', [p.id]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      withClient(url as string, (c) =>
        c.query('DELETE FROM app.categories WHERE id = $1', [cat.id]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('auditoría: una fila por operación real; PATCH sin cambios no audita', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await category('Auditoria');
    const p = await product(cat.id, 'Auditado');
    await commands.update(staff, p.id, { name: `Renombrado ${run}` });
    await commands.update(staff, p.id, { name: `Renombrado ${run}` }); // sin cambios
    await commands.update(staff, p.id, { active: false });
    await commands.update(staff, p.id, { active: true });
    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'product', entityId: p.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual([
      'product.created',
      'product.updated',
      'product.deactivated',
      'product.activated',
    ]);
  });

  it('adaptador de favoritos: solo productos visibles, con primera imagen; ausentes no aparecen', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await category('Fav');
    const hiddenCat = await category('Fav oculta', null, false);
    const ok = await product(cat.id, 'Fav ok', {
      media: [{ url: 'https://cdn.example.com/fav.jpg' }],
    });
    const off = await product(cat.id, 'Fav off', { active: false });
    const hidden = await product(hiddenCat.id, 'Fav oculto').catch(() => null);
    expect(hidden).toBeNull(); // no se puede crear en categoría inactiva
    const out = await adapter.findPublicSummaries([ok.id, off.id, randomUUID()]);
    expect([...out.keys()]).toEqual([ok.id]);
    expect(out.get(ok.id)).toMatchObject({
      status: 'ACTIVE',
      nameEn: null,
      imageUrl: 'https://cdn.example.com/fav.jpg',
      categoryId: cat.id,
    });
  });
});
