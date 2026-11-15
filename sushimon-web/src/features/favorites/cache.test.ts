import { describe, expect, it } from 'vitest';
import type { CustomerFavorites } from '@/lib/data-access/models';
import { applyToggle, removeFromPage, rollbackToggle } from './cache';

const data = (ids: string[]): CustomerFavorites => ({
  items: [],
  page: 1,
  pageSize: 0,
  total: ids.length,
  favoriteProductIds: ids,
  limit: 200,
  catalogStatus: 'AVAILABLE',
});

describe('transformaciones puras de la caché de favoritos', () => {
  it('alta al inicio (sin duplicar) y baja; el total acompaña', () => {
    expect(applyToggle(data(['a', 'b']), 'c', true)).toMatchObject({
      favoriteProductIds: ['c', 'a', 'b'],
      total: 3,
    });
    expect(applyToggle(data(['a', 'b']), 'b', true)).toMatchObject({
      favoriteProductIds: ['b', 'a'],
      total: 2,
    });
    expect(applyToggle(data(['a', 'b']), 'a', false)).toMatchObject({
      favoriteProductIds: ['b'],
      total: 1,
    });
    expect(applyToggle(data(['a']), 'z', false)).toMatchObject({
      favoriteProductIds: ['a'],
      total: 1,
    });
  });

  it('rollback de una alta fallida: solo quita ese producto', () => {
    const optimistic = applyToggle(data(['a', 'b']), 'c', true);
    const withOther = applyToggle(optimistic, 'd', true); // otra mutación en vuelo
    expect(
      rollbackToggle(withOther, 'c', { favorite: false, index: -1 }).favoriteProductIds,
    ).toEqual(['d', 'a', 'b']);
  });

  it('rollback de una baja fallida: devuelve el producto a su posición (acotada) sin tocar el resto', () => {
    const removed = applyToggle(data(['a', 'b', 'c']), 'b', false);
    expect(rollbackToggle(removed, 'b', { favorite: true, index: 1 })).toMatchObject({
      favoriteProductIds: ['a', 'b', 'c'],
      total: 3,
    });
    expect(
      rollbackToggle(data(['a']), 'z', { favorite: true, index: 9 }).favoriteProductIds,
    ).toEqual(['a', 'z']);
  });

  it('removeFromPage quita el item de la página y de los ids; sin el item no cambia nada', () => {
    const page: CustomerFavorites = {
      ...data(['a', 'b']),
      items: [
        { productId: 'a', addedAt: '2026-01-01T00:00:00.000Z', status: 'ACTIVE', product: null },
        { productId: 'b', addedAt: '2026-01-01T00:00:00.000Z', status: 'ACTIVE', product: null },
      ],
    };
    const next = removeFromPage(page, 'a');
    expect(next.items.map((i) => i.productId)).toEqual(['b']);
    expect(next).toMatchObject({ favoriteProductIds: ['b'], total: 1 });
    expect(removeFromPage(page, 'zzz')).toBe(page);
  });
});
