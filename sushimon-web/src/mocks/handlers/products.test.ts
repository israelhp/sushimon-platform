import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as categories from '@/services/categories';
import * as products from '@/services/products';
import { createHarness } from '../testing';

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, code: e.businessCode };
    throw e;
  }
  throw new Error('se esperaba un error');
}

const ok = { name: 'Roll Nuevo', basePrice: '75.00', categoryId: 'cat-rolls' };
const URL1 = 'https://cdn.ejemplo.com/a.jpg';

describe('F11 mock · lectura pública', () => {
  it('lista solo productos activos con categoría visible, sin SKU, orden name,id y paginado', async () => {
    const h = createHarness();
    const page = await products.listStoreProducts(h.client);
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 29 });
    expect(page.items).toHaveLength(20);
    const all = await products.listAllStoreProducts(h.client);
    expect(all).toHaveLength(29);
    const names = all.map((p) => p.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    );
    expect(all.some((p) => p.slug === 'gyoza-vegetal')).toBe(false); // inactivo
    expect(all.some((p) => p.slug === 'roll-edicion-limitada')).toBe(false); // categoría oculta
    expect(Object.keys(all[0]!).sort()).toEqual([
      'basePrice',
      'category',
      'description',
      'id',
      'media',
      'name',
      'slug',
    ]);
    const second = await products.listStoreProducts(h.client, { page: 2 });
    expect(second.items).toHaveLength(9);
    expect(await products.listStoreProducts(h.client, { page: 99 })).toMatchObject({
      items: [],
      total: 29,
    });
  });

  it('visibilidad: desactivar una categoría (o un ancestro) oculta sus productos', async () => {
    const h = createHarness();
    h.asStaff('admin');
    await categories.updateAdminCategory(h.client, 'cat-rolls', { active: false });
    const slugs = (await products.listAllStoreProducts(h.client)).map((p) => p.category.slug);
    expect(slugs).not.toContain('rolls');
    await categories.updateAdminCategory(h.client, 'cat-rolls', { active: true });
    await products.createAdminProduct(h.client, { ...ok, categoryId: 'cat-rolls-frios' });
    await categories.updateAdminCategory(h.client, 'cat-rolls', { active: false });
    expect(
      (await products.listAllStoreProducts(h.client)).some((p) => p.slug === 'roll-nuevo'),
    ).toBe(false);
    expect(await failure(products.getStoreProduct(h.client, 'roll-nuevo'))).toEqual({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('categorySlug incluye descendientes visibles; inexistente u oculto => lista vacía 200', async () => {
    const h = createHarness();
    h.asStaff('admin');
    await products.createAdminProduct(h.client, {
      ...ok,
      name: 'Roll Frío',
      categoryId: 'cat-rolls-frios',
    });
    const rolls = await products.listStoreProducts(h.client, {
      categorySlug: 'rolls',
      pageSize: 100,
    });
    expect(rolls.items.map((p) => p.category.slug)).toContain('rolls-frios');
    expect(rolls.items.map((p) => p.category.slug)).toContain('rolls');
    const frios = await products.listStoreProducts(h.client, { categorySlug: 'rolls-frios' });
    expect(frios.items.map((p) => p.slug)).toEqual(['roll-frio']);
    expect((await products.listStoreProducts(h.client, { categorySlug: 'nada' })).total).toBe(0);
    expect((await products.listStoreProducts(h.client, { categorySlug: 'temporada' })).total).toBe(
      0,
    );
    expect(
      (await products.listStoreProducts(h.client, { categorySlug: 'edicion-limitada' })).total,
    ).toBe(0);
  });

  it('búsqueda q pública: solo nombre y descripción (sin acentos ni mayúsculas); el SKU ni se busca ni se expone', async () => {
    const h = createHarness();
    h.asStaff('admin');
    await products.createAdminProduct(h.client, { ...ok, name: 'Té Verde 100%', sku: 'tv_1' });
    const byAccent = await products.listStoreProducts(h.client, { q: 'TE verde' });
    expect(byAccent.items.map((p) => p.slug)).toContain('te-verde-100');
    expect((await products.listStoreProducts(h.client, { q: 'tv_1' })).total).toBe(0);
    expect((await products.listStoreProducts(h.client, { q: '%' })).total).toBe(1); // solo el «100%»
    expect((await products.listStoreProducts(h.client, { q: '_' })).total).toBe(0);
    expect(
      JSON.stringify(await products.listStoreProducts(h.client, { q: 'verde' })),
    ).not.toContain('TV_1');
    expect((await products.listStoreProducts(h.client, { q: 'camarón' })).total).toBeGreaterThan(0); // descripción
    expect(
      await failure(products.listStoreProducts(h.client, { q: 'a'.repeat(81) })),
    ).toMatchObject({ status: 400 });
    // En admin sí busca SKU y slug.
    expect((await products.listAdminProducts(h.client, { q: 'tv_1' })).total).toBe(1);
    expect((await products.listAdminProducts(h.client, { q: 'te-verde' })).total).toBe(1);
  });

  it('paginación: 400 fuera de rango y total independiente de la página', async () => {
    const h = createHarness();
    for (const bad of [{ pageSize: 101 }, { pageSize: 0 }, { page: 0 }, { page: 201 }]) {
      expect(await failure(products.listStoreProducts(h.client, bad))).toMatchObject({
        status: 400,
      });
    }
    expect(
      await failure(products.listStoreProducts(h.client, { categorySlug: 'A_B' })),
    ).toMatchObject({ status: 400 });
    expect((await products.listStoreProducts(h.client, { pageSize: 5 })).total).toBe(29);
  });

  it('ficha: categoryAncestors raíz→padre, media ordenada, 404 con code y 400 de forma', async () => {
    const h = createHarness();
    h.asStaff('admin');
    await products.createAdminProduct(h.client, {
      ...ok,
      name: 'Roll Frío',
      categoryId: 'cat-rolls-frios',
      media: [{ url: URL1, altText: 'uno' }, { url: 'https://cdn.ejemplo.com/b.jpg' }],
    });
    const detail = await products.getStoreProduct(h.client, 'roll-frio');
    expect(detail.categoryAncestors.map((c) => c.slug)).toEqual(['rolls']);
    expect(detail.media).toEqual([
      { url: URL1, altText: 'uno' },
      { url: 'https://cdn.ejemplo.com/b.jpg', altText: null },
    ]);
    expect((await products.getStoreProduct(h.client, 'dumplings')).categoryAncestors).toEqual([]);
    expect(await failure(products.getStoreProduct(h.client, 'gyoza-vegetal'))).toEqual({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(await failure(products.getStoreProduct(h.client, 'Mala_Forma'))).toMatchObject({
      status: 400,
    });
    expect(JSON.stringify(detail)).not.toContain('"sku"');
  });
});

describe('F11 mock · administración', () => {
  it('401 sin sesión, 403 sin permiso y lectura con cualquier alcance', async () => {
    const h = createHarness();
    expect(await failure(products.listAdminProducts(h.client))).toMatchObject({ status: 401 });
    h.asStaff('kitchen');
    expect(await failure(products.listAdminProducts(h.client))).toMatchObject({ status: 403 });
    h.asStaff('manager'); // catalog.read por sucursal: lee, no escribe
    expect((await products.listAdminProducts(h.client)).total).toBe(31);
    expect(await failure(products.createAdminProduct(h.client, ok))).toMatchObject({ status: 403 });
    expect(
      await failure(products.updateAdminProduct(h.client, 'dumplings', { active: false })),
    ).toMatchObject({ status: 403 });
  });

  it('escritura sin alcance global => 403 aunque tenga el permiso', async () => {
    const h = createHarness();
    const role = h.store.roles.find((r) => r.code === 'manager')!;
    role.permissions.push('catalog.create', 'catalog.update');
    h.asStaff('manager');
    expect(await failure(products.createAdminProduct(h.client, ok))).toMatchObject({ status: 403 });
    expect(
      await failure(products.updateAdminProduct(h.client, 'dumplings', { active: false })),
    ).toMatchObject({ status: 403 });
  });

  it('lista: filtros q/categoryId/active, orden por precio y desempate por id; incluye inactivos con visibilidad', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const inactive = await products.listAdminProducts(h.client, { active: false });
    expect(inactive.items.map((p) => p.slug)).toEqual(['gyoza-vegetal']);
    expect(inactive.items[0]).toMatchObject({ active: false, publiclyVisible: false });
    const hidden = (await products.listAdminProducts(h.client, { q: 'edición' })).items[0]!;
    expect(hidden).toMatchObject({ active: true, publiclyVisible: false });
    expect(hidden.category).toMatchObject({
      slug: 'edicion-limitada',
      active: true,
      effectivelyVisible: false,
    });
    const byCat = await products.listAdminProducts(h.client, {
      categoryId: 'cat-entradas',
      pageSize: 100,
    });
    expect(byCat.items.every((p) => p.categoryId === 'cat-entradas')).toBe(true);
    expect((await products.listAdminProducts(h.client, { categoryId: 'no-existe' })).total).toBe(0);
    const priced = await products.listAdminProducts(h.client, {
      sort: 'basePrice',
      order: 'desc',
      pageSize: 100,
    });
    const cents = priced.items.map((p) => Number(p.basePrice));
    expect(cents).toEqual([...cents].sort((a, b) => b - a));
    expect(
      (await products.listAdminProducts(h.client, { q: 'dumplings' })).items.map((p) => p.slug),
    ).toContain('dumplings');
    expect(
      await failure(products.listAdminProducts(h.client, { sort: 'x' as never })),
    ).toMatchObject({ status: 400 });
  });

  it('alta: slug generado y desambiguado, SKU en mayúsculas, defaults, media con sortOrder', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const a = await products.createAdminProduct(h.client, {
      ...ok,
      name: '  Roll   Ñandú  ',
      sku: 'rn-1',
      description: 'Texto\nplano',
      media: [{ url: URL1, altText: 'a' }, { url: 'https://cdn.ejemplo.com/b.jpg' }],
    });
    expect(a).toMatchObject({
      name: 'Roll Ñandú',
      slug: 'roll-nandu',
      sku: 'RN-1',
      active: true,
      publiclyVisible: true,
      basePrice: '75.00',
      description: 'Texto\nplano',
    });
    expect(a.media.map((m) => m.sortOrder)).toEqual([0, 1]);
    const b = await products.createAdminProduct(h.client, { ...ok, name: 'Roll Ñandú' });
    expect(b.slug).toBe('roll-nandu-2');
    expect(await products.getAdminProduct(h.client, a.id)).toEqual(a);
    expect((await products.getStoreProduct(h.client, 'roll-nandu')).name).toBe('Roll Ñandú');
  });

  it('alta: 400 de forma, 409 slug/SKU, 422 categoría y media', async () => {
    const h = createHarness();
    h.asStaff('admin');
    for (const bad of [
      { ...ok, basePrice: '75' },
      { ...ok, basePrice: '0.00' },
      { ...ok, basePrice: 75 as never },
      { ...ok, name: ' ' },
      { ...ok, slug: 'Mal Slug' },
      { ...ok, sku: '-x' },
      { ...ok, extra: 1 } as never,
      { name: 'x', basePrice: '1.00' } as never,
      { ...ok, description: 'x'.repeat(2001) },
      { ...ok, media: [{ url: URL1, extra: 1 }] as never },
    ]) {
      expect(
        await failure(products.createAdminProduct(h.client, bad)),
        JSON.stringify(bad),
      ).toMatchObject({ status: 400 });
    }
    await products.createAdminProduct(h.client, { ...ok, slug: 'uno', sku: 'a-1' });
    expect(await failure(products.createAdminProduct(h.client, { ...ok, slug: 'uno' }))).toEqual({
      status: 409,
      code: 'PRODUCT_SLUG_TAKEN',
    });
    expect(await failure(products.createAdminProduct(h.client, { ...ok, sku: 'A-1' }))).toEqual({
      status: 409,
      code: 'PRODUCT_SKU_TAKEN',
    });
    for (const categoryId of ['no-existe', 'cat-temporada']) {
      expect(await failure(products.createAdminProduct(h.client, { ...ok, categoryId }))).toEqual({
        status: 422,
        code: 'PRODUCT_CATEGORY_INVALID',
      });
    }
    // Activa pero con ancestro inactivo: se permite (no se exige visibilidad efectiva).
    const hiddenOk = await products.createAdminProduct(h.client, {
      ...ok,
      categoryId: 'cat-temporada-edicion',
    });
    expect(hiddenOk.publiclyVisible).toBe(false);
    const mediaBad = [
      [{ url: 'http://x.com/a.jpg' }],
      [{ url: 'data:image/png;base64,AAAA' }],
      [{ url: 'javascript:alert(1)' }],
      [{ url: '/relativa.jpg' }],
      [{ url: 'https://127.0.0.1/a.jpg' }],
      [{ url: 'https://localhost/a.jpg' }],
      [{ url: 'https://intranet/a.jpg' }],
      [{ url: 'https://user:pw@x.com/a.jpg' }],
      [{ url: `https://x.com/${'a'.repeat(2048)}` }],
      [{ url: URL1, altText: 'a'.repeat(201) }],
      Array.from({ length: 9 }, () => ({ url: URL1 })),
    ];
    for (const media of mediaBad) {
      expect(await failure(products.createAdminProduct(h.client, { ...ok, media }))).toEqual({
        status: 422,
        code: 'PRODUCT_MEDIA_INVALID',
      });
    }
    expect(
      (
        await products.createAdminProduct(h.client, {
          ...ok,
          media: Array.from({ length: 8 }, () => ({ url: URL1 })),
        })
      ).media,
    ).toHaveLength(8);
  });

  it('PATCH: parcial, activar/desactivar, sku/description null, media reemplaza y [] vacía, sin cambios no escribe', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const created = await products.createAdminProduct(h.client, {
      ...ok,
      sku: 'p-1',
      description: 'd',
      media: [{ url: URL1 }],
    });
    const stamp = created.updatedAt;
    h.clock.advance(60_000);
    const same = await products.updateAdminProduct(h.client, created.id, {
      name: created.name,
      basePrice: created.basePrice,
      media: [{ url: URL1, altText: null }],
    });
    expect(same.updatedAt).toBe(stamp);
    const cleared = await products.updateAdminProduct(h.client, created.id, {
      sku: null,
      description: null,
      active: false,
    });
    expect(cleared).toMatchObject({
      sku: null,
      description: null,
      active: false,
      publiclyVisible: false,
    });
    expect(cleared.updatedAt).not.toBe(stamp);
    expect(await failure(products.getStoreProduct(h.client, created.slug))).toMatchObject({
      status: 404,
    });
    const swapped = await products.updateAdminProduct(h.client, created.id, {
      active: true,
      media: [{ url: 'https://cdn.ejemplo.com/z.jpg', altText: 'z' }, { url: URL1 }],
    });
    expect(swapped.media.map((m) => [m.url, m.sortOrder])).toEqual([
      ['https://cdn.ejemplo.com/z.jpg', 0],
      [URL1, 1],
    ]);
    expect((await products.updateAdminProduct(h.client, created.id, { media: [] })).media).toEqual(
      [],
    );
    const untouched = await products.updateAdminProduct(h.client, created.id, {
      name: 'Nuevo nombre',
    });
    expect(untouched.media).toEqual([]);
    expect(await failure(products.updateAdminProduct(h.client, created.id, {}))).toMatchObject({
      status: 400,
    });
    expect(
      await failure(products.updateAdminProduct(h.client, created.id, { foo: 1 } as never)),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(products.updateAdminProduct(h.client, 'no-existe', { name: 'x' })),
    ).toEqual({ status: 404, code: 'PRODUCT_NOT_FOUND' });
  });

  it('PATCH: conflictos 409, categoría 422 solo al cambiarla (editar en categoría inactiva se permite)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    await products.createAdminProduct(h.client, { ...ok, name: 'Otro', slug: 'otro', sku: 'o-1' });
    const p = await products.createAdminProduct(h.client, { ...ok, sku: 'p-1' });
    expect(await failure(products.updateAdminProduct(h.client, p.id, { slug: 'otro' }))).toEqual({
      status: 409,
      code: 'PRODUCT_SLUG_TAKEN',
    });
    expect(await failure(products.updateAdminProduct(h.client, p.id, { sku: 'O-1' }))).toEqual({
      status: 409,
      code: 'PRODUCT_SKU_TAKEN',
    });
    expect(
      (await products.updateAdminProduct(h.client, p.id, { slug: p.slug, sku: 'p-1' })).slug,
    ).toBe(p.slug);
    await categories.updateAdminCategory(h.client, 'cat-rolls', { active: false });
    expect(
      (await products.updateAdminProduct(h.client, p.id, { name: 'Sigue editable' })).name,
    ).toBe('Sigue editable');
    // Reenviar la misma categoría (inactiva) no es un cambio: se permite.
    expect(
      (await products.updateAdminProduct(h.client, p.id, { categoryId: 'cat-rolls' })).categoryId,
    ).toBe('cat-rolls');
    expect(
      await failure(products.updateAdminProduct(h.client, p.id, { categoryId: 'cat-temporada' })),
    ).toEqual({ status: 422, code: 'PRODUCT_CATEGORY_INVALID' });
    expect(
      (await products.updateAdminProduct(h.client, p.id, { categoryId: 'cat-postres' })).category
        .slug,
    ).toBe('postres');
  });

  it('503 PRODUCTS_BUSY determinista: no escribe y la siguiente funciona; sin cambios no cuenta', async () => {
    const h = createHarness();
    h.asStaff('admin');
    h.store.productsBusy = 2;
    const before = h.store.products.length;
    expect(await failure(products.createAdminProduct(h.client, ok))).toEqual({
      status: 503,
      code: 'PRODUCTS_BUSY',
    });
    expect(h.store.products).toHaveLength(before);
    expect(
      (await products.updateAdminProduct(h.client, 'dumplings', { name: 'Dumplings' })).name,
    ).toBe('Dumplings');
    expect(h.store.productsBusy).toBe(1);
    expect(
      await failure(products.updateAdminProduct(h.client, 'dumplings', { active: false })),
    ).toEqual({ status: 503, code: 'PRODUCTS_BUSY' });
    expect(
      (await products.updateAdminProduct(h.client, 'dumplings', { active: false })).active,
    ).toBe(false);
  });
});

describe('F11 mock · pedidos, favoritos y extras simulados', () => {
  it('un pedido no acepta productos inactivos o con categoría oculta y usa basePrice', async () => {
    const h = createHarness();
    const order = {
      fulfillment: 'pickup' as const,
      schedule: { kind: 'now' as const },
      customer: { name: 'Ana Prueba', phone: '5555-0000', email: 'ana@ejemplo.com' },
      branchId: 'sucursal-1',
      paymentMethod: 'cash' as const,
    };
    for (const productId of ['gyoza-vegetal', 'roll-edicion-limitada']) {
      const { createOrder } = await import('@/services/orders');
      expect(
        await failure(createOrder(h.client, { ...order, lines: [{ productId, quantity: 1 }] })),
      ).toMatchObject({ status: 422 });
    }
    const { createOrder } = await import('@/services/orders');
    const created = await createOrder(h.client, {
      ...order,
      lines: [{ productId: 'dumplings', quantity: 2 }],
    });
    expect(created.lines[0]).toMatchObject({ unitPrice: 53, subtotal: 106 });
  });

  it('extras simulados: ilustración y destacado; un producto nuevo trae valores por defecto (sin disponibilidad: es F13)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const created = await products.createAdminProduct(h.client, {
      ...ok,
      categoryId: 'cat-postres',
    });
    const extras = (await products.listSimulatedProductExtras(h.client)).items;
    expect(extras.find((e) => e.productId === 'dumplings')).toMatchObject({
      illustration: 'dumpling',
    });
    expect(extras.find((e) => e.productId === created.id)).toMatchObject({
      illustration: 'icecream',
      featured: false,
    });
    expect(extras.find((e) => e.productId === 'dumplings')).not.toHaveProperty('available');
    // F13: la ruta demo de disponibilidad se retiró (la sustituye PATCH /v1/admin/products/:id/availability).
    expect(
      await failure(h.client.patch('/v1/demo/catalog/products/dumplings/availability', {})),
    ).toMatchObject({ status: 404 });
  });
});
