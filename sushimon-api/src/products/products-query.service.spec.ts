import { CAT, pid, productRow, productsHarness } from '../../test/support/products-harness.js';
import {
  FakeModifiersRepo,
  G,
  groupRow,
  optionRow,
  OPT,
} from '../../test/support/fake-modifiers-repo.js';
import { ModifiersQueryService } from '../modifiers/modifiers-query.service.js';
import type { ModifiersRepository } from '../modifiers/modifiers.repository.js';
import { ProductsQueryService } from './products-query.service.js';
import type { ProductsRepository } from './products.repository.js';

function setup() {
  const h = productsHarness();
  const mods = new FakeModifiersRepo();
  const service = new ProductsQueryService(
    h.repo as unknown as ProductsRepository,
    h.categoriesQuery,
    new ModifiersQueryService(mods as unknown as ModifiersRepository),
  );
  h.repo.seed(
    productRow(pid(1), {
      name: 'Roll California',
      slug: 'roll-california',
      categoryId: CAT.frios,
      sku: 'RC-1',
      description: 'Con aguacate',
    }),
    [{ url: 'https://cdn.x.io/1.jpg', altText: 'Uno' }, { url: 'https://cdn.x.io/2.jpg' }],
  );
  h.repo.seed(
    productRow(pid(2), { name: 'Roll Vegano', slug: 'roll-vegano', categoryId: CAT.veganos }),
  );
  h.repo.seed(
    productRow(pid(3), {
      name: 'Té frío',
      slug: 'te-frio',
      categoryId: CAT.bebidas,
      description: '100% natural_',
    }),
  );
  h.repo.seed(
    productRow(pid(4), {
      name: 'Inactivo',
      slug: 'inactivo',
      categoryId: CAT.frios,
      active: false,
    }),
  );
  h.repo.seed(
    productRow(pid(5), {
      name: 'En categoría inactiva',
      slug: 'en-inactiva',
      categoryId: CAT.calientes,
    }),
  );
  h.repo.seed(
    productRow(pid(6), {
      name: 'Hija de inactiva',
      slug: 'hija-inactiva',
      categoryId: CAT.hijaDeInactiva,
    }),
  );
  h.repo.calls.length = 0;
  return { service, mods, ...h };
}

const names = (page: { items: { name: string }[] }) => page.items.map((i) => i.name);

describe('ProductsQueryService.getPublicList', () => {
  it('solo activos con categoría visible (ni inactivos, ni categoría inactiva, ni hija de inactiva)', async () => {
    const { service } = setup();
    const page = await service.getPublicList({ page: 1, pageSize: 20 });
    expect(names(page)).toEqual(['Roll California', 'Roll Vegano', 'Té frío']);
    expect(page.total).toBe(3);
  });

  it('sin N+1: una lectura de categorías, una de productos (página+total) y una de media', async () => {
    const { service, repo, categoriesRepo } = setup();
    await service.getPublicList({ page: 1, pageSize: 20 });
    expect(categoriesRepo.findAllNodes).toHaveBeenCalledTimes(1);
    expect(repo.count('findPage')).toBe(1);
    expect(repo.count('findMedia')).toBe(1);
    expect(repo.calls).not.toContain('findById');
  });

  it('forma de cada elemento: sin sku ni campos internos; media ordenada; categoría referenciada', async () => {
    const { service } = setup();
    const page = await service.getPublicList({ page: 1, pageSize: 20 });
    expect(page.items[0]).toEqual({
      id: pid(1),
      slug: 'roll-california',
      name: 'Roll California',
      description: 'Con aguacate',
      basePrice: '50.00',
      category: { id: CAT.frios, slug: 'frios', name: 'Frios' },
      media: [
        { url: 'https://cdn.x.io/1.jpg', altText: 'Uno' },
        { url: 'https://cdn.x.io/2.jpg', altText: null },
      ],
    });
    const text = JSON.stringify(page);
    for (const forbidden of ['sku', 'RC-1', 'active', 'createdAt', 'updatedAt', 'categoryId']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('categorySlug incluye descendientes visibles; inexistente u oculta => vacío', async () => {
    const { service } = setup();
    expect(
      names(await service.getPublicList({ categorySlug: 'rolls', page: 1, pageSize: 20 })),
    ).toEqual(['Roll California', 'Roll Vegano']);
    expect(
      names(await service.getPublicList({ categorySlug: 'frios', page: 1, pageSize: 20 })),
    ).toEqual(['Roll California', 'Roll Vegano']);
    expect(
      names(await service.getPublicList({ categorySlug: 'veganos', page: 1, pageSize: 20 })),
    ).toEqual(['Roll Vegano']);
    for (const slug of ['nada', 'calientes', 'tempura']) {
      const page = await service.getPublicList({ categorySlug: slug, page: 1, pageSize: 20 });
      expect(page).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    }
  });

  it('q: nombre y descripción (NO sku); sin mayúsculas ni acentos; comodines literales', async () => {
    const { service } = setup();
    const find = async (q: string) =>
      names(await service.getPublicList({ q, page: 1, pageSize: 20 }));
    expect(await find('ROLL')).toEqual(['Roll California', 'Roll Vegano']);
    expect(await find('te frio')).toEqual(['Té frío']);
    expect(await find('aguacate')).toEqual(['Roll California']);
    expect(await find('rc-1')).toEqual([]); // el SKU no es buscable públicamente
    expect(await find('RC')).toEqual([]);
    expect(await find('%')).toEqual(['Té frío']); // solo el literal "100%"
    expect(await find('_')).toEqual(['Té frío']); // solo el literal "natural_"
    expect(await find('100%')).toEqual(['Té frío']);
    expect(await find('\\')).toEqual([]);
    expect(await find('r_ll')).toEqual([]); // `_` no es comodín
    expect(await find('r%l')).toEqual([]);
    expect(await find('   ')).toEqual(['Roll California', 'Roll Vegano', 'Té frío']);
  });

  it('paginación estable: total real, página fuera de rango => vacía con total', async () => {
    const { service } = setup();
    const p1 = await service.getPublicList({ page: 1, pageSize: 2 });
    const p2 = await service.getPublicList({ page: 2, pageSize: 2 });
    expect([...names(p1), ...names(p2)]).toEqual(['Roll California', 'Roll Vegano', 'Té frío']);
    expect([p1.total, p2.total]).toEqual([3, 3]);
    const p9 = await service.getPublicList({ page: 9, pageSize: 2 });
    expect(p9).toMatchObject({ items: [], total: 3, page: 9, pageSize: 2 });
  });

  it('sin categorías visibles => vacío sin consultar productos', async () => {
    const h = productsHarness([]);
    const service = new ProductsQueryService(
      h.repo as unknown as ProductsRepository,
      h.categoriesQuery,
      new ModifiersQueryService(new FakeModifiersRepo() as unknown as ModifiersRepository),
    );
    expect(await service.getPublicList({ page: 1, pageSize: 20 })).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    expect(h.repo.count('findPage')).toBe(0);
  });

  it('q de más de 80 caracteres => 400', async () => {
    const { service } = setup();
    await expect(
      service.getPublicList({ q: 'a'.repeat(81), page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('ProductsQueryService.findVisibleBySlug', () => {
  it('ficha con ancestros (raíz → padre) y media ordenada', async () => {
    const { service } = setup();
    const detail = await service.findVisibleBySlug('roll-vegano');
    expect(detail).toMatchObject({
      id: pid(2),
      category: { slug: 'veganos' },
      categoryAncestors: [
        { id: CAT.rolls, slug: 'rolls', name: 'Rolls' },
        { id: CAT.frios, slug: 'frios', name: 'Frios' },
      ],
      media: [],
    });
    expect((await service.findVisibleBySlug('te-frio'))?.categoryAncestors).toEqual([]);
    expect((await service.findVisibleBySlug('roll-california'))?.media).toHaveLength(2);
  });

  it('inexistente, inactivo o con categoría oculta => null (sin distinguir el motivo)', async () => {
    const { service } = setup();
    for (const slug of ['nada', 'inactivo', 'en-inactiva', 'hija-inactiva']) {
      expect(await service.findVisibleBySlug(slug)).toBeNull();
    }
  });
});

describe('ProductsQueryService.findVisibleSummariesByIds', () => {
  it('solo visibles; primera imagen o null; una consulta por tabla', async () => {
    const { service, repo, categoriesRepo } = setup();
    const out = await service.findVisibleSummariesByIds([
      pid(1),
      pid(2),
      pid(4),
      pid(5),
      pid(6),
      pid(99),
      pid(1),
    ]);
    expect([...out.keys()].sort()).toEqual([pid(1), pid(2)]);
    expect(out.get(pid(1))).toEqual({
      id: pid(1),
      name: 'Roll California',
      imageUrl: 'https://cdn.x.io/1.jpg',
      categoryId: CAT.frios,
    });
    expect(out.get(pid(2))?.imageUrl).toBeNull();
    expect(categoriesRepo.findAllNodes).toHaveBeenCalledTimes(1);
    expect(repo.count('findActiveByIds')).toBe(1);
    expect(repo.count('findMedia')).toBe(1);
  });
  it('lista vacía => mapa vacío sin tocar la base', async () => {
    const { service, repo, categoriesRepo } = setup();
    expect((await service.findVisibleSummariesByIds([])).size).toBe(0);
    expect(repo.calls).toEqual([]);
    expect(categoriesRepo.findAllNodes).not.toHaveBeenCalled();
  });
});

describe('ProductsQueryService admin', () => {
  it('lista todos (activos e inactivos), con publiclyVisible y estado de la categoría', async () => {
    const { service } = setup();
    const page = await service.listAdmin({ sort: 'name', order: 'asc', page: 1, pageSize: 20 });
    expect(page.total).toBe(6);
    const byName = new Map(page.items.map((i) => [i.name, i]));
    expect(byName.get('Inactivo')).toMatchObject({ active: false, publiclyVisible: false });
    expect(byName.get('En categoría inactiva')).toMatchObject({
      active: true,
      publiclyVisible: false,
      category: { slug: 'calientes', active: false, effectivelyVisible: false },
    });
    expect(byName.get('Hija de inactiva')?.category).toMatchObject({
      active: true,
      effectivelyVisible: false,
    });
    expect(byName.get('Roll California')).toMatchObject({ sku: 'RC-1', publiclyVisible: true });
  });

  it('filtros categoryId (exacta, sin descendientes), active, q (incluye slug), sort/order y desempate por id', async () => {
    const { service, repo } = setup();
    const base = { sort: 'name' as const, order: 'asc' as const, page: 1, pageSize: 20 };
    expect((await service.listAdmin({ ...base, categoryId: CAT.rolls })).total).toBe(0);
    expect((await service.listAdmin({ ...base, categoryId: CAT.frios })).total).toBe(2);
    expect((await service.listAdmin({ ...base, active: false })).items.map((i) => i.name)).toEqual([
      'Inactivo',
    ]);
    expect((await service.listAdmin({ ...base, q: 'en-inactiva' })).items).toHaveLength(1);
    // el SKU sí es buscable en admin (y no en la lista pública)
    expect((await service.listAdmin({ ...base, q: 'rc-1' })).items.map((i) => i.name)).toEqual([
      'Roll California',
    ]);
    // empates de precio: id desempata
    repo.seed(productRow(pid(7), { name: 'B', basePrice: '10.00', slug: 'b' }));
    repo.seed(productRow(pid(8), { name: 'A', basePrice: '10.00', slug: 'a' }));
    const byPrice = await service.listAdmin({ ...base, sort: 'basePrice', order: 'asc' });
    expect(byPrice.items.slice(0, 2).map((i) => i.id)).toEqual([pid(7), pid(8)]);
    const desc = await service.listAdmin({
      ...base,
      sort: 'basePrice',
      order: 'desc',
      pageSize: 100,
    });
    expect(desc.items[0]?.basePrice).toBe('50.00');
    expect(desc.items.slice(-2).map((i) => i.id)).toEqual([pid(7), pid(8)]);
  });

  it('sin N+1: categorías (1) + página (1) + media (1)', async () => {
    const { service, repo, categoriesRepo } = setup();
    await service.listAdmin({ sort: 'name', order: 'asc', page: 1, pageSize: 20 });
    expect(categoriesRepo.findAllRows).toHaveBeenCalledTimes(1);
    expect(repo.count('findPage')).toBe(1);
    expect(repo.count('findMedia')).toBe(1);
  });

  it('getAdmin: detalle con media; inexistente => 404 PRODUCT_NOT_FOUND', async () => {
    const { service } = setup();
    expect((await service.getAdmin(pid(1))).media.map((m) => m.sortOrder)).toEqual([0, 1]);
    expect((await service.getAdmin(pid(5))).publiclyVisible).toBe(false);
    await expect(service.getAdmin(pid(99))).rejects.toMatchObject({
      status: 404,
      response: { code: 'PRODUCT_NOT_FOUND' },
    });
  });
});

describe('ProductsQueryService.findVisibleBySlug: modificadores (F12)', () => {
  it('incluye solo grupos ofrecibles con opciones activas y lo obtiene en UNA consulta', async () => {
    const { service, mods } = setup();
    mods.seedGroup(groupRow(G.salsas, { name: 'Salsas', minSelect: 1 }), [
      optionRow(OPT(1), G.salsas, { name: 'Soya', extraPrice: '1.50', sortOrder: 0 }),
      optionRow(OPT(2), G.salsas, { name: 'Vieja', active: false, sortOrder: 1 }),
    ]);
    mods.seedGroup(groupRow(G.extras, { name: 'Extras', active: false }), [
      optionRow(OPT(3), G.extras),
    ]);
    mods.seedProduct(pid(1), [G.salsas, G.extras]);
    const detail = await service.findVisibleBySlug('roll-california');
    expect(detail?.modifierGroups).toEqual([
      {
        id: G.salsas,
        name: 'Salsas',
        minSelect: 1,
        maxSelect: 1,
        required: true,
        options: [{ id: OPT(1), name: 'Soya', extraPrice: '1.50' }],
      },
    ]);
    expect(mods.count('findOffer')).toBe(1);
  });

  it('sin grupos => []; la lista pública no consulta modificadores', async () => {
    const { service, mods } = setup();
    expect((await service.findVisibleBySlug('te-frio'))?.modifierGroups).toEqual([]);
    mods.calls.length = 0;
    await service.getPublicList({ page: 1, pageSize: 20 });
    expect(mods.calls).toEqual([]);
  });
});

describe('ProductsQueryService.findPresentationByIds (F23, solo lectura)', () => {
  it('slug, nombre vigente e imagen principal en 2 consultas; los ausentes faltan; sin árbol de categorías', async () => {
    const { service, repo, categoriesRepo } = setup();
    const out = await service.findPresentationByIds([pid(1), pid(2), pid(99), pid(1)]);
    expect(out.get(pid(1))).toEqual({
      slug: 'roll-california',
      name: 'Roll California',
      imageUrl: 'https://cdn.x.io/1.jpg',
    });
    expect(out.get(pid(2))).toEqual({ slug: 'roll-vegano', name: 'Roll Vegano', imageUrl: null });
    expect(out.has(pid(99))).toBe(false);
    expect(repo.count('findSlugsAndNames')).toBe(1);
    expect(repo.count('findMedia')).toBe(1);
    expect(repo.count('findActiveByIds')).toBe(0);
    expect(categoriesRepo.findAllNodes).not.toHaveBeenCalled();
  });

  it('lista vacía => mapa vacío sin tocar la base', async () => {
    const { service, repo } = setup();
    expect((await service.findPresentationByIds([])).size).toBe(0);
    expect(repo.calls).toEqual([]);
  });

  it('regresión: findVisibleSummariesByIds conserva su comportamiento (visibilidad y consultas)', async () => {
    const { service, repo } = setup();
    const out = await service.findVisibleSummariesByIds([pid(1), pid(4)]);
    expect(out.has(pid(1))).toBe(true);
    expect(out.has(pid(4))).toBe(false);
    expect(repo.count('findActiveByIds')).toBe(1);
  });
});
