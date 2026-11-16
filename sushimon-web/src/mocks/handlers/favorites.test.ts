import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as favorites from '@/services/favorites';
import { createHarness } from '../testing';
import { MAX_FAVORITES } from './favorites';

/** Error de la API (estado + `code` de negocio) o `null` si la promesa resolvió. */
async function failure(p: Promise<unknown>): Promise<{ status: number; code?: string } | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, code: e.businessCode };
    throw e;
  }
  return null;
}

const OTHER = 'invitado.nuevo@ejemplo.com';

function setup(scenario: Parameters<typeof createHarness>[0] = 'default') {
  const h = createHarness(scenario);
  h.asCustomer();
  return h;
}

describe('F06 favoritos · mock que reproduce las reglas del servidor', () => {
  it('sin sesión responde 401 en las tres operaciones', async () => {
    const h = createHarness();
    expect((await failure(favorites.listMyFavoriteIds(h.client)))?.status).toBe(401);
    expect((await failure(favorites.addMyFavorite(h.client, 'dumplings')))?.status).toBe(401);
    expect((await failure(favorites.removeMyFavorite(h.client, 'dumplings')))?.status).toBe(401);
  });

  it('GET: ids completos + página; pageSize=0 no devuelve items y no depende del catálogo', async () => {
    const h = setup();
    const full = await favorites.listMyFavorites(h.client, { page: 1, pageSize: 20 });
    expect(full).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 2,
      limit: MAX_FAVORITES,
      catalogStatus: 'AVAILABLE',
      favoriteProductIds: ['platanito-roll', 'calientito-roll'],
    });
    expect(full.items.map((i) => [i.productId, i.status])).toEqual([
      ['platanito-roll', 'ACTIVE'],
      ['calientito-roll', 'ACTIVE'],
    ]);
    // Resumen mínimo: sin precio ni disponibilidad por sucursal.
    expect(Object.keys(full.items[0]?.product ?? {}).sort()).toEqual(
      ['categoryId', 'id', 'imageUrl', 'name', 'nameEn'].sort(),
    );
    const idsOnly = await favorites.listMyFavoriteIds(h.client);
    expect(idsOnly.items).toEqual([]);
    expect(idsOnly.favoriteProductIds).toEqual(full.favoriteProductIds);
    expect(idsOnly.total).toBe(2);
  });

  it('GET: paginación y validación (400 fuera de rango, decimales o parámetros desconocidos)', async () => {
    const h = setup();
    await favorites.addMyFavorite(h.client, 'dumplings');
    const second = await favorites.listMyFavorites(h.client, { page: 2, pageSize: 1 });
    expect(second.items).toHaveLength(1);
    expect(second.total).toBe(3);
    const beyond = await favorites.listMyFavorites(h.client, { page: 9, pageSize: 1 });
    expect(beyond.items).toEqual([]);
    expect(
      (await failure(favorites.listMyFavorites(h.client, { page: 0, pageSize: 10 })))?.status,
    ).toBe(400);
    expect(
      (await failure(favorites.listMyFavorites(h.client, { page: 1, pageSize: 51 })))?.status,
    ).toBe(400);
    expect(
      (await failure(h.client.get('/v1/me/favorites', { query: { pageSize: '1.5' } })))?.status,
    ).toBe(400);
    expect(
      (await failure(h.client.get('/v1/me/favorites', { query: { customerId: 'x' } })))?.status,
    ).toBe(400);
  });

  it('PUT es idempotente (204 sin duplicar ni mover addedAt) y lo nuevo va primero', async () => {
    const h = setup();
    expect(await favorites.addMyFavorite(h.client, 'dumplings')).toBeUndefined();
    const first = await favorites.listMyFavorites(h.client, { page: 1, pageSize: 20 });
    expect(first.favoriteProductIds[0]).toBe('dumplings');
    const addedAt = first.items.find((i) => i.productId === 'dumplings')?.addedAt;
    h.clock.advance(60_000);
    expect(await favorites.addMyFavorite(h.client, 'dumplings')).toBeUndefined();
    const again = await favorites.listMyFavorites(h.client, { page: 1, pageSize: 20 });
    expect(again.total).toBe(3);
    expect(again.items.find((i) => i.productId === 'dumplings')?.addedAt).toBe(addedAt);
  });

  it('PUT: producto inexistente => 404 PRODUCT_NOT_FOUND; categoría oculta (despublicado) también', async () => {
    const h = setup();
    expect(await failure(favorites.addMyFavorite(h.client, 'no-existe'))).toEqual({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    // F11: un producto inactivo (o con categoría oculta) se despublica.
    const productId = h.store.products[0]?.id as string;
    h.store.products[0]!.active = false;
    expect(await failure(favorites.addMyFavorite(h.client, productId))).toEqual({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('DELETE es idempotente (204 exista o no) y no consulta el catálogo', async () => {
    const h = setup();
    h.store.favoritesCatalog = 'unavailable';
    expect(await favorites.removeMyFavorite(h.client, 'platanito-roll')).toBeUndefined();
    expect(await favorites.removeMyFavorite(h.client, 'platanito-roll')).toBeUndefined();
    expect(await favorites.removeMyFavorite(h.client, 'no-existe')).toBeUndefined();
    expect((await favorites.listMyFavoriteIds(h.client)).favoriteProductIds).toEqual([
      'calientito-roll',
    ]);
  });

  it('tope de 200: producto nuevo => 422 FAVORITES_LIMIT_REACHED; ya favorito => 204; 404 antes que 422', async () => {
    const h = setup();
    const account = h.store.accounts['cliente@ejemplo.com'];
    expect(account).toBeDefined();
    account!.favorites = Array.from({ length: MAX_FAVORITES }, (_, i) => ({
      productId: i === 0 ? 'platanito-roll' : `retirado-${i}`,
      addedAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }));
    expect(await failure(favorites.addMyFavorite(h.client, 'dumplings'))).toEqual({
      status: 422,
      code: 'FAVORITES_LIMIT_REACHED',
    });
    expect(await favorites.addMyFavorite(h.client, 'platanito-roll')).toBeUndefined();
    expect((await failure(favorites.addMyFavorite(h.client, 'no-existe')))?.status).toBe(404);
    const ids = await favorites.listMyFavoriteIds(h.client);
    expect(ids.total).toBe(MAX_FAVORITES);
    // Quitar uno libera un cupo.
    await favorites.removeMyFavorite(h.client, 'retirado-1');
    expect(await favorites.addMyFavorite(h.client, 'dumplings')).toBeUndefined();
  });

  it('aislamiento por cuenta: otra cuenta no ve ni borra los favoritos ajenos', async () => {
    const h = setup();
    h.asCustomer(OTHER);
    expect((await favorites.listMyFavoriteIds(h.client)).favoriteProductIds).toEqual([]);
    await favorites.removeMyFavorite(h.client, 'platanito-roll'); // no es suyo: 204 y sin efecto
    await favorites.addMyFavorite(h.client, 'dumplings');
    h.asCustomer();
    expect((await favorites.listMyFavoriteIds(h.client)).favoriteProductIds).toEqual([
      'platanito-roll',
      'calientito-roll',
    ]);
  });

  it('estados REMOVED, INACTIVE y UNAVAILABLE con su resumen (solo ACTIVE/UNAVAILABLE traen product)', async () => {
    const h = setup();
    const account = h.store.accounts['cliente@ejemplo.com']!;
    const hiddenProduct = h.store.products.find((p) => p.id === 'dumplings')!;
    // Con la categoría oculta (F10) todos los productos de ella son INACTIVE.
    h.store.menuCategories.find((c) => c.id === hiddenProduct.categoryId)!.active = false;
    h.store.products.find((p) => p.id === 'platanito-roll')!.availability = h.store.products
      .find((p) => p.id === 'platanito-roll')!
      .availability.map((a) => ({ ...a, available: false }));
    account.favorites = [
      { productId: 'dumplings', addedAt: '2026-02-04T00:00:00.000Z' },
      { productId: 'fantasma', addedAt: '2026-02-03T00:00:00.000Z' },
      { productId: 'platanito-roll', addedAt: '2026-02-02T00:00:00.000Z' },
    ];
    const page = await favorites.listMyFavorites(h.client, { page: 1, pageSize: 20 });
    const byId = Object.fromEntries(page.items.map((i) => [i.productId, i]));
    expect(byId['dumplings']).toMatchObject({ status: 'INACTIVE', product: null });
    expect(byId['fantasma']).toMatchObject({ status: 'REMOVED', product: null });
    expect(byId['platanito-roll']?.status === 'UNAVAILABLE').toBe(true);
    expect(byId['platanito-roll']?.product?.id).toBe('platanito-roll');
  });

  it('catálogo no disponible: PUT => 503 CATALOG_UNAVAILABLE sin escribir; GET degrada a UNKNOWN con ids reales', async () => {
    const h = setup();
    h.store.favoritesCatalog = 'unavailable';
    expect(await failure(favorites.addMyFavorite(h.client, 'dumplings'))).toEqual({
      status: 503,
      code: 'CATALOG_UNAVAILABLE',
    });
    // 503 antes que 404: no se puede decidir si existe.
    expect((await failure(favorites.addMyFavorite(h.client, 'no-existe')))?.status).toBe(503);
    const page = await favorites.listMyFavorites(h.client, { page: 1, pageSize: 20 });
    expect(page).toMatchObject({ catalogStatus: 'UNAVAILABLE', total: 2 });
    expect(page.items.map((i) => [i.status, i.product])).toEqual([
      ['UNKNOWN', null],
      ['UNKNOWN', null],
    ]);
    expect(page.favoriteProductIds).toEqual(['platanito-roll', 'calientito-roll']);
    // pageSize=0 no consulta el catálogo.
    expect((await favorites.listMyFavoriteIds(h.client)).catalogStatus).toBe('AVAILABLE');
  });

  it('FAVORITES_BUSY: 503 reintentable sin escribir; el siguiente intento funciona', async () => {
    const h = setup();
    h.store.favoritesBusy = 1;
    expect(await failure(favorites.addMyFavorite(h.client, 'dumplings'))).toEqual({
      status: 503,
      code: 'FAVORITES_BUSY',
    });
    expect((await favorites.listMyFavoriteIds(h.client)).total).toBe(2);
    expect(await favorites.addMyFavorite(h.client, 'dumplings')).toBeUndefined();
    expect((await favorites.listMyFavoriteIds(h.client)).total).toBe(3);
  });

  it('escenario empty: la cuenta demo no tiene favoritos', async () => {
    const h = setup('empty');
    const ids = await favorites.listMyFavoriteIds(h.client);
    expect(ids.total).toBe(0);
    expect(ids.favoriteProductIds).toEqual([]);
  });
});
