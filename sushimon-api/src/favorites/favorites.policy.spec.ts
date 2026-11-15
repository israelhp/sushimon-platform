import { isFavoritable, resolveFavorite } from './favorites.policy.js';
import { product } from '../../test/support/favorites-harness.js';
import { CatalogUnavailableError } from './catalog-products.port.js';
import { UnavailableCatalogAdapter } from './unavailable-catalog.adapter.js';

const P = '11111111-1111-4111-8111-111111111111';

describe('favorites.policy', () => {
  it('isFavoritable: solo ACTIVE y UNAVAILABLE', () => {
    expect(isFavoritable(undefined)).toBe(false);
    expect(isFavoritable(product(P, { status: 'ACTIVE' }))).toBe(true);
    expect(isFavoritable(product(P, { status: 'UNAVAILABLE' }))).toBe(true);
    expect(isFavoritable(product(P, { status: 'INACTIVE' }))).toBe(false);
    expect(isFavoritable(product(P, { status: 'REMOVED' }))).toBe(false);
    expect(isFavoritable(product(P, { status: 'otro' as never }))).toBe(false);
  });

  it('resolveFavorite: mapeo de estados y proyección', () => {
    expect(resolveFavorite(undefined)).toEqual({ status: 'REMOVED', product: null });
    expect(resolveFavorite(product(P, { status: 'INACTIVE' }))).toEqual({
      status: 'INACTIVE',
      product: null,
    });
    expect(resolveFavorite(product(P, { status: 'x' as never }))).toEqual({
      status: 'UNKNOWN',
      product: null,
    });
    const active = resolveFavorite(
      product(P, { name: 'Roll', nameEn: 'Roll EN', imageUrl: 'https://a.test/i.png' }),
    );
    expect(active).toEqual({
      status: 'ACTIVE',
      product: {
        id: P,
        name: 'Roll',
        nameEn: 'Roll EN',
        imageUrl: 'https://a.test/i.png',
        categoryId: null,
      },
    });
  });
});

describe('UnavailableCatalogAdapter', () => {
  it('siempre rechaza con CatalogUnavailableError y sin red', async () => {
    await expect(new UnavailableCatalogAdapter().findPublicSummaries()).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });
});
