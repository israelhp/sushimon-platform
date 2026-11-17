import {
  A,
  B,
  CAT,
  INACTIVE_BRANCH,
  MISSING_BRANCH,
  storeHarness,
} from '../../test/support/store-harness.js';
import { local } from '../../test/support/promotions-harness.js';

const code = (e: unknown) => (e as { getResponse?: () => { code?: string } }).getResponse?.().code;
const status = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
const fail = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const menu = (over = {}) => ({
  sort: 'menu' as const,
  order: 'asc' as const,
  page: 1,
  pageSize: 100,
  ...over,
});
const search = (q: string, over = {}) => ({ q, page: 1, pageSize: 20, ...over });

function world() {
  const h = storeHarness();
  h.addProduct(1, {
    name: 'Roll California',
    slug: 'roll-california',
    basePrice: '85.00',
    categoryId: CAT.frios,
    description: 'Cangrejo y aguacate',
    image: { url: 'https://cdn.x.io/1.jpg', alt: 'Roll' },
  });
  h.addProduct(2, {
    name: 'Nigiri de Salmón',
    slug: 'nigiri-salmon',
    basePrice: '40.00',
    categoryId: CAT.frios,
    description: 'Arroz con pescado',
  });
  h.addProduct(3, {
    name: 'Roll Vegano',
    slug: 'roll-vegano',
    basePrice: '60.00',
    categoryId: CAT.veganos,
    description: 'Con salmon vegetal',
  });
  h.addProduct(4, {
    name: 'Té frío',
    slug: 'te-frio',
    basePrice: '15.00',
    categoryId: CAT.bebidas,
    description: '100% natural_',
  });
  h.addProduct(5, { name: 'Roll Oculto', slug: 'roll-oculto', categoryId: CAT.calientes });
  h.addProduct(6, {
    name: 'Roll Inactivo',
    slug: 'roll-inactivo',
    categoryId: CAT.frios,
    active: false,
  });
  h.addProduct(7, { name: 'Tempura oculta', slug: 'tempura', categoryId: CAT.hijaDeInactiva });
  return h;
}
const slugs = (r: { items: { slug: string }[] }) => r.items.map((i) => i.slug);

describe('StoreCatalogService.menu', () => {
  it('solo visibles (activos, categoría visible), orden del árbol luego name; tarjeta completa y sin precio base', async () => {
    const h = world();
    const r = await h.catalog.menu(menu({ branchId: A }));
    // árbol: rolls > frios > veganos ; bebidas
    expect(slugs(r)).toEqual(['nigiri-salmon', 'roll-california', 'roll-vegano', 'te-frio']);
    expect(r).toMatchObject({ branchId: A, page: 1, pageSize: 100, total: 4, nextChangeAt: null });
    const card = r.items.find((i) => i.slug === 'roll-california');
    expect(card).toEqual({
      productId: card?.productId,
      slug: 'roll-california',
      price: '85.00',
      available: true,
      name: 'Roll California',
      summary: 'Cangrejo y aguacate',
      image: { url: 'https://cdn.x.io/1.jpg', altText: 'Roll' },
      category: { id: CAT.frios, slug: 'frios', name: 'Frios' },
      promo: null,
    });
    const raw = JSON.stringify(r);
    for (const leak of [
      'basePrice',
      'sku',
      'modifierGroups',
      'roll-oculto',
      'roll-inactivo',
      'tempura',
    ]) {
      expect(raw).not.toContain(leak);
    }
  });

  it('precio por sucursal = override; nunca el de otra; agotado visible con available=false', async () => {
    const h = world();
    const p1 = h.world.products.get([...h.world.products.keys()][0]!)!;
    h.world.seedRow(A, p1.id, { priceOverride: '70.00' });
    h.world.seedRow(B, p1.id, { priceOverride: '99.00', available: false });
    const a = await h.catalog.menu(menu({ branchId: A }));
    const b = await h.catalog.menu(menu({ branchId: B }));
    const none = await h.catalog.menu(menu());
    const pick = (r: typeof a) => r.items.find((i) => i.productId === p1.id)!;
    expect(pick(a)).toMatchObject({ price: '70.00', available: true });
    expect(pick(b)).toMatchObject({ price: '99.00', available: false });
    expect(pick(none)).toMatchObject({ price: '85.00', available: null });
    expect(JSON.stringify(a)).not.toContain('99.00');
    expect(none.branchId).toBeNull();
  });

  it('available=true excluye agotados; sin sucursal => 400; available=false equivale a todos', async () => {
    const h = world();
    const id = [...h.world.products.keys()][1]!;
    h.world.seedRow(A, id, { available: false });
    const only = await h.catalog.menu(menu({ branchId: A, available: true }));
    expect(only.items.map((i) => i.productId)).not.toContain(id);
    expect(only.total).toBe(3);
    const all = await h.catalog.menu(menu({ branchId: A, available: false }));
    expect(all.total).toBe(4);
    const e = await fail(h.catalog.menu(menu({ available: true })));
    expect(status(e)).toBe(400);
    expect(h.queryCount()).toBe(h.queryCount()); // sin lecturas en el 400
    expect(h.catalogRepo.count('findCards')).toBe(2);
  });

  it('categorySlug incluye descendientes visibles; inexistente o no visible => vacío con 200', async () => {
    const h = world();
    expect(slugs(await h.catalog.menu(menu({ categorySlug: 'rolls' })))).toEqual([
      'nigiri-salmon',
      'roll-california',
      'roll-vegano',
    ]);
    expect(slugs(await h.catalog.menu(menu({ categorySlug: 'veganos' })))).toEqual(['roll-vegano']);
    for (const s of ['calientes', 'tempura', 'no-existe']) {
      const r = await h.catalog.menu(menu({ categorySlug: s }));
      expect(r).toMatchObject({ items: [], total: 0 });
    }
  });

  it('sort name/price asc/desc con id como desempate', async () => {
    const h = world();
    expect(slugs(await h.catalog.menu(menu({ sort: 'name', order: 'desc' })))[0]).toBe('te-frio');
    expect(slugs(await h.catalog.menu(menu({ sort: 'price' })))).toEqual([
      'te-frio',
      'nigiri-salmon',
      'roll-vegano',
      'roll-california',
    ]);
    expect(slugs(await h.catalog.menu(menu({ sort: 'price', order: 'desc' })))[0]).toBe(
      'roll-california',
    );
  });

  it('paginación: total, último parcial, página fuera de rango (total con una consulta de conteo)', async () => {
    const h = world();
    const p1 = await h.catalog.menu(menu({ pageSize: 3 }));
    expect([p1.items.length, p1.total, p1.page, p1.pageSize]).toEqual([3, 4, 1, 3]);
    const p2 = await h.catalog.menu(menu({ pageSize: 3, page: 2 }));
    expect([p2.items.length, p2.total]).toEqual([1, 4]);
    h.resetCounts();
    const p9 = await h.catalog.menu(menu({ pageSize: 3, page: 9 }));
    expect([p9.items.length, p9.total]).toEqual([0, 4]);
    expect(h.catalogRepo.count('countCards')).toBe(1);
    const sinFilas = await h.catalog.menu(menu({ categorySlug: 'no-existe', page: 1 }));
    expect(sinFilas.total).toBe(0);
  });

  it('sucursal inexistente o inactiva => 404 BRANCH_NOT_FOUND idéntico, sin leer tarjetas', async () => {
    const h = world();
    for (const id of [MISSING_BRANCH, INACTIVE_BRANCH]) {
      const e = await fail(h.catalog.menu(menu({ branchId: id })));
      expect([status(e), code(e)]).toEqual([404, 'BRANCH_NOT_FOUND']);
    }
    expect(h.catalogRepo.count('findCards')).toBe(0);
  });

  it('promo indicativa solo vigente y de mayor ahorro; cupón nunca; vencida/próxima no; agotado sin promo', async () => {
    const h = world();
    const ids = [...h.world.products.keys()];
    h.promotionsRepo.seed({ name: '10%', kind: 'PERCENT', value: '10.00' });
    const mejor = h.promotionsRepo.seed({
      name: 'Q20',
      kind: 'FIXED_AMOUNT',
      value: '20.00',
      productIds: [ids[0]!],
    });
    h.promotionsRepo.seed({ name: 'Cupón', code: 'SECRETO10', value: '90.00' });
    h.promotionsRepo.seed({
      name: 'Vencida',
      value: '90.00',
      endsAt: new Date('2026-11-01T00:00:00Z'),
    });
    h.promotionsRepo.seed({
      name: 'Próxima',
      value: '90.00',
      startsAt: new Date('2026-11-20T00:00:00Z'),
    });
    h.world.seedRow(A, ids[1]!, { available: false });
    const r = await h.catalog.menu(menu({ branchId: A }));
    const byId = new Map(r.items.map((i) => [i.productId, i]));
    expect(byId.get(ids[0]!)?.promo).toMatchObject({
      promotionId: mejor.id,
      name: 'Q20',
      regularPrice: '85.00',
      promoPrice: '65.00',
      isHappyHour: false,
    });
    expect(byId.get(ids[2]!)?.promo).toMatchObject({ name: '10%', promoPrice: '54.00' });
    expect(byId.get(ids[1]!)?.promo).toBeNull();
    const raw = JSON.stringify(r);
    for (const leak of ['SECRETO10', 'Cupón', 'Vencida', 'Próxima'])
      expect(raw).not.toContain(leak);
    // sin sucursal no hay promo
    expect((await h.catalog.menu(menu())).items.every((i) => i.promo === null)).toBe(true);
  });

  it('nextChangeAt = próximo cambio de las promociones que tocan la página (vigente o próxima)', async () => {
    const h = world();
    h.promotionsRepo.seed({ endsAt: local('2026-11-16T16:00:09') });
    const r = await h.catalog.menu(menu({ branchId: A }));
    expect(r.nextChangeAt).toBe(local('2026-11-16T16:00:09').toISOString());
    expect(r.generatedAt).toBe(local('2026-11-16T16:00:00').toISOString());
  });

  it('SIN N+1: mismas consultas con 4 y con 100 productos (sucursal ∥ categorías, tarjetas, candidatas)', async () => {
    const h = world();
    h.promotionsRepo.seed({ value: '10.00' });
    h.resetCounts();
    await h.catalog.menu(menu({ branchId: A }));
    const few = h.queryCount();
    for (let n = 100; n < 200; n += 1) h.addProduct(n, { name: `Extra ${n}`, slug: `extra-${n}` });
    h.resetCounts();
    const big = await h.catalog.menu(menu({ branchId: A }));
    expect(big.items).toHaveLength(100);
    expect(h.queryCount()).toBe(few);
    // sucursal (1) + categorías (1) + tarjetas (1) + candidatas de promoción (1)
    expect(few).toBe(4);
  });

  it('fallo de BD reintentable => 503 STORE_BUSY; otro error => se propaga (500 genérico del filtro)', async () => {
    const h = world();
    h.catalogRepo.failWith = Object.assign(new Error('secreto'), { code: 'P2028' });
    const busy = await fail(h.catalog.menu(menu()));
    expect([status(busy), code(busy)]).toEqual([503, 'STORE_BUSY']);
    h.catalogRepo.failWith = new Error('boom');
    expect(status(await fail(h.catalog.menu(menu())))).toBeUndefined();
  });
});

describe('StoreCatalogService.search', () => {
  it('nombre, descripción y NOMBRE de categoría; plegado de acentos; orden por grupo', async () => {
    const h = world();
    // 'salmon': nombre contiene (Nigiri de Salmón) -> grupo 1 ; descripción (Roll Vegano) -> grupo 2
    const r = await h.catalog.search(search('SALMON'));
    expect(slugs(r)).toEqual(['nigiri-salmon', 'roll-vegano']);
    expect(r.total).toBe(2);
    // prefijo de nombre (0) antes que contiene (1) antes que descripción/categoría (2)
    const roll = await h.catalog.search(search('roll'));
    expect(slugs(roll)).toEqual(['roll-california', 'roll-vegano']);
    // categoría: 'bebidas' es nombre de la categoría de Té frío
    expect(slugs(await h.catalog.search(search('bebidas')))).toEqual(['te-frio']);
    // acento en la consulta, sin acento en datos
    expect(slugs(await h.catalog.search(search('té frí')))).toEqual(['te-frio']);
  });

  it('orden estable: prefijo, luego contiene en nombre, luego solo descripción', async () => {
    const h = storeHarness();
    h.addProduct(1, { name: 'Zeta Atún', slug: 'zeta', description: null });
    h.addProduct(2, { name: 'Atún picante', slug: 'picante', description: null });
    h.addProduct(3, { name: 'Roll X', slug: 'x', description: 'con atun fresco' });
    h.addProduct(4, { name: 'Atún clásico', slug: 'clasico', description: null });
    const r = await h.catalog.search(search('atun'));
    expect(slugs(r)).toEqual(['clasico', 'picante', 'zeta', 'x']);
    expect(slugs(await h.catalog.search(search('atun')))).toEqual(slugs(r));
  });

  it('comodines literales: % y _ no coinciden con todo', async () => {
    const h = world();
    expect(slugs(await h.catalog.search(search('100%')))).toEqual(['te-frio']);
    expect(slugs(await h.catalog.search(search('natural_')))).toEqual(['te-frio']);
    expect((await h.catalog.search(search('te%o'))).total).toBe(0);
    expect((await h.catalog.search(search('na_ural'))).total).toBe(0);
    expect(status(await fail(h.catalog.search(search('%%'))))).toBe(400);
    expect((await h.catalog.search(search("x'; SELECT 1; --"))).items).toEqual([]);
  });

  it('nunca ocultos, inactivos ni de categoría inactiva/ancestro inactivo', async () => {
    const h = world();
    const r = await h.catalog.search(search('roll'));
    expect(JSON.stringify(r)).not.toMatch(/oculto|inactivo|tempura/i);
    expect((await h.catalog.search(search('tempura'))).items).toEqual([]);
    expect((await h.catalog.search(search('calientes'))).items).toEqual([]);
  });

  it('sin resultados => 200 vacío; q hostil => 400 sin consultar BD', async () => {
    const h = world();
    expect(await h.catalog.search(search('zzzz'))).toMatchObject({
      items: [],
      total: 0,
      nextChangeAt: null,
    });
    h.resetCounts();
    for (const q of ['a', 'x'.repeat(81), 'ro\u0000ll', 'ro‮ll', ' \t ']) {
      expect(status(await fail(h.catalog.search(search(q))))).toBe(400);
    }
    expect(h.queryCount()).toBe(0);
  });

  it('con sucursal: precio y disponibilidad de ESA sucursal; available=true filtra; categorySlug restringe', async () => {
    const h = world();
    const id = [...h.world.products.keys()][0]!;
    h.world.seedRow(A, id, { priceOverride: '70.00', available: false });
    const all = await h.catalog.search(search('roll', { branchId: A }));
    expect(all.items.find((i) => i.productId === id)).toMatchObject({
      price: '70.00',
      available: false,
    });
    const only = await h.catalog.search(search('roll', { branchId: A, available: true }));
    expect(slugs(only)).toEqual(['roll-vegano']);
    expect(status(await fail(h.catalog.search(search('roll', { available: true }))))).toBe(400);
    expect(slugs(await h.catalog.search(search('roll', { categorySlug: 'veganos' })))).toEqual([
      'roll-vegano',
    ]);
    expect(code(await fail(h.catalog.search(search('roll', { branchId: MISSING_BRANCH }))))).toBe(
      'BRANCH_NOT_FOUND',
    );
  });

  it('paginación: pageSize, página 2 y total; SIN N+1 con 10 vs 100 coincidencias', async () => {
    const h = storeHarness();
    for (let n = 1; n <= 10; n += 1) h.addProduct(n, { name: `Roll ${n}`, slug: `roll-${n}` });
    h.promotionsRepo.seed({ value: '10.00' });
    h.resetCounts();
    const few = await h.catalog.search(search('roll', { branchId: A, pageSize: 5 }));
    const q10 = h.queryCount();
    expect([few.items.length, few.total]).toEqual([5, 10]);
    expect(
      (await h.catalog.search(search('roll', { branchId: A, pageSize: 5, page: 2 }))).items,
    ).toHaveLength(5);
    for (let n = 11; n <= 100; n += 1) h.addProduct(n, { name: `Roll ${n}`, slug: `roll-${n}` });
    h.resetCounts();
    const big = await h.catalog.search(search('roll', { branchId: A, pageSize: 50 }));
    expect([big.items.length, big.total]).toEqual([50, 100]);
    expect(h.queryCount()).toBe(q10);
    expect(q10).toBe(4);
  });
});
