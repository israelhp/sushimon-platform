import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { createHarness } from '@/mocks/testing';
import * as bp from '@/services/branch-products';
import * as products from '@/services/products';
import * as store from '@/services/store';

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, code: e.businessCode };
    throw e;
  }
  throw new Error('se esperaba un error');
}

describe('F17 mock · menú paginado (getStoreBranchMenu)', () => {
  it('tarjetas completas: nombre, resumen ≤ 160, imagen principal, categoría y promo; nunca SKU ni precio base', async () => {
    const h = createHarness();
    const menu = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-1' });
    expect(menu.total).toBe(29);
    expect(menu.page).toBe(1);
    expect(menu.pageSize).toBe(100);
    expect(menu.generatedAt).toBe(h.clock.now().toISOString());
    const card = menu.items.find((i) => i.productId === 'dumplings');
    expect(card).toMatchObject({
      slug: 'dumplings',
      name: 'Dumplings',
      price: '53.00',
      available: true,
      category: { slug: expect.any(String), name: expect.any(String) },
    });
    for (const item of menu.items) {
      expect((item.summary ?? '').length).toBeLessThanOrEqual(160);
      expect(item).not.toHaveProperty('sku');
      expect(item).not.toHaveProperty('basePrice');
      expect(item).not.toHaveProperty('description');
      expect(item).not.toHaveProperty('modifierGroups');
    }
  });

  it('paginación: página final parcial, page fuera de rango = vacía con total, pageSize > 100 → 400', async () => {
    const h = createHarness();
    const p1 = await bp.getStoreBranchMenu(h.client, { pageSize: 10 });
    const p3 = await bp.getStoreBranchMenu(h.client, { pageSize: 10, page: 3 });
    const p4 = await bp.getStoreBranchMenu(h.client, { pageSize: 10, page: 4 });
    expect([p1.items.length, p3.items.length, p4.items.length]).toEqual([10, 9, 0]);
    expect(p4.total).toBe(29);
    const ids = [
      ...p1.items,
      ...(await bp.getStoreBranchMenu(h.client, { pageSize: 10, page: 2 })).items,
      ...p3.items,
    ].map((i) => i.productId);
    expect(new Set(ids).size).toBe(29); // páginas disjuntas y en orden estable
    expect(await failure(bp.getStoreBranchMenu(h.client, { pageSize: 101 }))).toMatchObject({
      status: 400,
    });
    expect(await failure(h.client.get('/v1/store/menu', { query: { page: '0' } }))).toMatchObject({
      status: 400,
    });
    expect(await failure(h.client.get('/v1/store/menu', { query: { page: '201' } }))).toMatchObject(
      { status: 400 },
    );
  });

  it('orden: `name`/`price` con `order`; sort inválido → 400', async () => {
    const h = createHarness();
    const byName = await bp.getStoreBranchMenu(h.client, { sort: 'name' });
    const names = byName.items.map((i) => i.name ?? '');
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    );
    const desc = await bp.getStoreBranchMenu(h.client, { sort: 'price', order: 'desc' });
    const prices = desc.items.map((i) => Number(i.price));
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(await failure(h.client.get('/v1/store/menu', { query: { sort: 'x' } }))).toMatchObject({
      status: 400,
    });
  });

  it('filtros: categoría (desconocida = vacía) y available (true exige sucursal)', async () => {
    const h = createHarness();
    const rolls = await bp.getStoreBranchMenu(h.client, { categorySlug: 'rolls' });
    expect(rolls.total).toBeGreaterThan(0);
    expect(rolls.items.every((i) => i.category?.slug === 'rolls')).toBe(true);
    const none = await bp.getStoreBranchMenu(h.client, { categorySlug: 'no-existe' });
    expect(none).toMatchObject({ total: 0, items: [] });
    expect(await failure(bp.getStoreBranchMenu(h.client, { available: true }))).toMatchObject({
      status: 400,
    });
    const s2 = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-2' });
    const only = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-2', available: true });
    expect(s2.items.find((i) => i.productId === 'gaseosas')?.available).toBe(false); // agotado: visible y marcado
    expect(only.items.find((i) => i.productId === 'gaseosas')).toBeUndefined();
    expect(only.total).toBe((s2.total as number) - s2.items.filter((i) => !i.available).length);
  });

  it('no mezcla precios de sucursales; sin sucursal usa el base con available=null', async () => {
    const h = createHarness();
    const s1 = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-1' });
    const s2 = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-2' });
    const base = await bp.getStoreBranchMenu(h.client);
    const price = (m: typeof s1) => m.items.find((i) => i.productId === 'dynamita-roll')?.price;
    expect([price(s1), price(s2), price(base)]).toEqual(['82.00', '86.00', '82.00']);
    expect(base.items.every((i) => i.available === null && i.promo === null)).toBe(true);
    expect(base.branchId).toBeNull();
  });

  it('503 STORE_BUSY determinista y reintentable; 404 BRANCH_NOT_FOUND', async () => {
    const h = createHarness();
    h.store.storeBusy = 1;
    expect(await failure(bp.getStoreBranchMenu(h.client))).toEqual({
      status: 503,
      code: 'STORE_BUSY',
    });
    expect((await bp.getStoreBranchMenu(h.client)).total).toBe(29);
    expect(await failure(bp.getStoreBranchMenu(h.client, { branchId: 'zzz' }))).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
  });

  it('promo indicativa: solo vigente y automática (nunca cupón ni código); el Happy Hour aparece al empezar y nextChangeAt lo anuncia', async () => {
    const h = createHarness();
    const before = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-1' });
    expect(before.items.find((i) => i.productId === 'gaseosas')?.promo).not.toBeNull();
    expect(JSON.stringify(before)).not.toMatch(/BIENVENIDO10|COMBOMON/);
    expect(before.items.every((i) => i.promo?.isHappyHour !== true)).toBe(true);
    // 14:25 → el Happy Hour empieza a las 15:00: hay `nextChangeAt` medido con la hora del servidor.
    expect(before.nextChangeAt).not.toBeNull();
    expect(Date.parse(before.nextChangeAt as string)).toBeGreaterThan(
      Date.parse(before.generatedAt as string),
    );
    h.clock.advance(36 * 60_000);
    const during = await bp.getStoreBranchMenu(h.client, { branchId: 'sucursal-1' });
    const d = during.items.find((i) => i.productId === 'dumplings');
    expect(d?.promo).toMatchObject({ isHappyHour: true, dineInOnly: true });
    expect(Number(d?.promo?.promoPrice)).toBeLessThan(Number(d?.promo?.regularPrice));
  });
});

describe('F17 mock · búsqueda (searchStoreProducts)', () => {
  it('ignora acentos y mayúsculas; busca en nombre, descripción y NOMBRE de categoría', async () => {
    const h = createHarness();
    expect(
      (await store.searchStoreProducts(h.client, { q: 'CANGREBÚRGER' })).total,
    ).toBeGreaterThan(0);
    const byCategory = await store.searchStoreProducts(h.client, { q: 'entradas' });
    expect(byCategory.items.length).toBeGreaterThan(0);
  });

  it('orden ESTABLE por grupo (prefijo del nombre primero) y determinista entre llamadas', async () => {
    const h = createHarness();
    const page = await store.searchStoreProducts(h.client, { q: 'roll', pageSize: 50 });
    const names = page.items.map((i) => (i.name ?? '').toLowerCase());
    const prefixCount = names.filter((n) => n.startsWith('roll')).length;
    expect(names.slice(0, prefixCount).every((n) => n.startsWith('roll'))).toBe(true);
    expect(names.slice(prefixCount).some((n) => n.startsWith('roll'))).toBe(false);
    const again = await store.searchStoreProducts(h.client, { q: ' ROLL ', pageSize: 50 });
    expect(again.items.map((i) => i.productId)).toEqual(page.items.map((i) => i.productId));
  });

  it('q hostil → 400; comodines y texto raro son literales; sin resultados = 200 vacío', async () => {
    const h = createHarness();
    for (const q of ['', ' ', 'a', ' a ', 'x'.repeat(81), '\u0000\u0001']) {
      expect(
        await failure(store.searchStoreProducts(h.client, { q })),
        JSON.stringify(q),
      ).toMatchObject({ status: 400 });
    }
    expect(await failure(h.client.get('/v1/store/search'))).toMatchObject({ status: 400 });
    for (const q of ['%%', '__', '\\\\', "'; select 1--"]) {
      expect(await store.searchStoreProducts(h.client, { q })).toMatchObject({
        total: 0,
        items: [],
      });
    }
    expect(await store.searchStoreProducts(h.client, { q: 'zzzz-nada' })).toMatchObject({
      total: 0,
      page: 1,
    });
  });

  it('límites: page ≤ 20, pageSize ≤ 50; available=true exige sucursal; sucursal inexistente → 404', async () => {
    const h = createHarness();
    const bad = (query: Record<string, string>) =>
      failure(h.client.get('/v1/store/search', { query: { q: 'ro', ...query } }));
    expect(await bad({ page: '21' })).toMatchObject({ status: 400 });
    expect(await bad({ pageSize: '51' })).toMatchObject({ status: 400 });
    expect(await bad({ available: 'true' })).toMatchObject({ status: 400 });
    expect(await bad({ branchId: 'zzz' })).toEqual({ status: 404, code: 'BRANCH_NOT_FOUND' });
    expect((await store.searchStoreProducts(h.client, { q: 'ro', page: 20 })).page).toBe(20);
  });

  it('por sucursal: precio efectivo y disponibilidad; agotados visibles salvo available=true', async () => {
    const h = createHarness();
    const all = await store.searchStoreProducts(h.client, { q: 'gaseosa', branchId: 'sucursal-2' });
    expect(all.items[0]).toMatchObject({ productId: 'gaseosas', available: false });
    const onlyAvailable = await store.searchStoreProducts(h.client, {
      q: 'gaseosa',
      branchId: 'sucursal-2',
      available: true,
    });
    expect(onlyAvailable.items).toEqual([]);
    const dyn = await store.searchStoreProducts(h.client, {
      q: 'dynamita',
      branchId: 'sucursal-2',
    });
    expect(dyn.items[0]?.price).toBe('86.00');
  });

  it('nunca devuelve productos ocultos o inactivos', async () => {
    const h = createHarness();
    const r = await store.searchStoreProducts(h.client, { q: 'gyoza', pageSize: 50 });
    expect(r.items.map((i) => i.productId)).not.toContain('gyoza-vegetal');
    const e = await store.searchStoreProducts(h.client, { q: 'limitada' });
    expect(e.items).toEqual([]);
  });
});

describe('F17 mock · ficha con sucursal (getStoreProduct)', () => {
  it('sin branchId es la ficha de F11/F12; con branchId añade oferta, promociones y tiempos', async () => {
    const h = createHarness();
    const plain = await products.getStoreProduct(h.client, 'dynamita-roll');
    expect(plain).not.toHaveProperty('offer');
    expect(plain).not.toHaveProperty('promotions');
    expect(plain).not.toHaveProperty('generatedAt');
    expect(plain).not.toHaveProperty('sku');
    const detail = await products.getStoreProduct(h.client, 'dynamita-roll', 'sucursal-2');
    expect(detail.offer).toEqual({ branchId: 'sucursal-2', price: '86.00', available: true });
    expect(detail.promotions?.length).toBeLessThanOrEqual(3);
    expect(detail.generatedAt).toBe(h.clock.now().toISOString());
    expect(detail.modifierGroups).toBeDefined();
    const gas = await products.getStoreProduct(h.client, 'gaseosas', 'sucursal-2');
    expect(gas.offer?.available).toBe(false);
  });

  it('errores: 404 BRANCH_NOT_FOUND, 404 PRODUCT_NOT_FOUND, 400 de slug', async () => {
    const h = createHarness();
    expect(await failure(products.getStoreProduct(h.client, 'dynamita-roll', 'zzz'))).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
    expect(await failure(products.getStoreProduct(h.client, 'no-existe', 'sucursal-1'))).toEqual({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(await failure(products.getStoreProduct(h.client, 'No Valido'))).toMatchObject({
      status: 400,
    });
  });
});

describe('F17 mock · bootstrap (getStoreBootstrap)', () => {
  it('con sucursal: sucursal, disponibilidad, categorías raíz, promociones sin código/items, banners y contador', async () => {
    const h = createHarness();
    const b = await store.getStoreBootstrap(h.client, { branchId: 'sucursal-1' });
    expect(b.branchId).toBe('sucursal-1');
    expect(b.branch).toMatchObject({ id: 'sucursal-1' });
    expect(b.availability?.branchId).toBe('sucursal-1');
    expect(b.categories.length).toBeGreaterThan(0);
    expect(b.categories.length).toBeLessThanOrEqual(30);
    expect(b.categories.every((c) => typeof c.hasChildren === 'boolean')).toBe(true);
    expect(b.featured).toEqual([]); // P23: sin criterio de destacados
    expect(b.promotions.length).toBeLessThanOrEqual(5);
    for (const p of b.promotions) {
      expect(p).not.toHaveProperty('code');
      expect(p).not.toHaveProperty('items');
    }
    expect(JSON.stringify(b)).not.toMatch(/BIENVENIDO10|COMBOMON/);
    expect(b.banners.length).toBeGreaterThan(0);
    expect(b.banners.length).toBeLessThanOrEqual(5);
    expect(b.productCount).toBe(29);
    expect(b.degraded).toEqual([]);
    expect(b.generatedAt).toBe(h.clock.now().toISOString());
  });

  it('sin sucursal: branch/availability null, sin promociones y los mismos banners', async () => {
    const h = createHarness();
    const b = await store.getStoreBootstrap(h.client);
    expect(b).toMatchObject({ branchId: null, branch: null, availability: null, promotions: [] });
    const withBranch = await store.getStoreBootstrap(h.client, { branchId: 'sucursal-1' });
    expect(b.banners).toEqual(withBranch.banners);
  });

  it('nextChangeAt = el menor entre promociones y próxima transición de horario (los banners ya no dependen del tiempo); posterior a generatedAt', async () => {
    const h = createHarness();
    const b = await store.getStoreBootstrap(h.client, { branchId: 'sucursal-1' });
    expect(b.nextChangeAt).not.toBeNull();
    const query = { branchId: 'sucursal-1' };
    const promos = await h.client.get<{ nextChangeAt: string | null }>('/v1/store/promotions', {
      query,
    });
    const candidates = [promos.nextChangeAt, b.availability?.nextTransitionAt]
      .filter((x): x is string => Boolean(x))
      .map((x) => Date.parse(x));
    expect(Date.parse(b.nextChangeAt as string)).toBe(Math.min(...candidates));
    expect(Date.parse(b.nextChangeAt as string)).toBeGreaterThan(Date.parse(b.generatedAt));
  });

  it('no hay idioma: la respuesta no lleva `locale` y la forma de los banners es {id, image, alt}', async () => {
    const h = createHarness();
    const b = await store.getStoreBootstrap(h.client, { branchId: 'sucursal-1' });
    expect('locale' in b).toBe(false);
    expect(Object.keys(b.banners[0]!).sort()).toEqual(['alt', 'id', 'image']);
  });

  it('secciones no críticas independientes: una caída las deja vacías y la lista en `degraded` (200)', async () => {
    const h = createHarness();
    h.store.storeDegraded = ['banners', 'promotions'];
    const b = await store.getStoreBootstrap(h.client, { branchId: 'sucursal-1' });
    expect(b.banners).toEqual([]);
    expect(b.promotions).toEqual([]);
    expect([...b.degraded].sort()).toEqual(['banners', 'promotions']);
    expect(b.categories.length).toBeGreaterThan(0);
    expect(b.availability).not.toBeNull();
    h.store.storeDegraded = ['availability'];
    const noAvailability = await store.getStoreBootstrap(h.client, { branchId: 'sucursal-1' });
    expect(noAvailability.availability).toBeNull();
    expect(noAvailability.degraded).toEqual(['availability']);
  });

  it('un fallo de lectura de banners (BANNERS_BUSY) degrada solo `banners`', async () => {
    const h = createHarness();
    h.store.bannersBusy = 1;
    const b = await store.getStoreBootstrap(h.client, { branchId: 'sucursal-1' });
    expect(b.degraded).toEqual(['banners']);
    expect(b.banners).toEqual([]);
  });

  it('503 STORE_BUSY (crítica) y 404 BRANCH_NOT_FOUND (inexistente o inactiva)', async () => {
    const h = createHarness();
    h.store.storeBusy = 1;
    expect(await failure(store.getStoreBootstrap(h.client))).toEqual({
      status: 503,
      code: 'STORE_BUSY',
    });
    expect(await failure(store.getStoreBootstrap(h.client, { branchId: 'zzz' }))).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
    expect(await failure(store.getStoreBootstrap(h.client, { branchId: 'sucursal-4' }))).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
  });

  it('una categoría inactiva oculta sus productos en bootstrap, menú, búsqueda y ficha', async () => {
    const h = createHarness();
    const cat = h.store.menuCategories.find((c) => c.slug === 'rolls');
    expect(cat).toBeDefined();
    (cat as NonNullable<typeof cat>).active = false;
    const b = await store.getStoreBootstrap(h.client);
    expect(b.categories.map((c) => c.slug)).not.toContain('rolls');
    expect(b.productCount).toBeLessThan(29);
    const menu = await bp.getStoreBranchMenu(h.client);
    expect(menu.items.map((i) => i.category?.slug)).not.toContain('rolls');
    expect((await store.searchStoreProducts(h.client, { q: 'dynamita' })).total).toBe(0);
    expect(await failure(products.getStoreProduct(h.client, 'dynamita-roll'))).toMatchObject({
      status: 404,
    });
  });
});
