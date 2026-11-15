import { isFavoritable, MAX_IMAGE_URL_LENGTH, resolveFavorite } from './favorites.policy.js';
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

describe('imageUrl (solo https)', () => {
  const url = (imageUrl: string) =>
    resolveFavorite(product(P, { imageUrl })).product?.imageUrl ?? null;

  it('acepta https absoluta', () => {
    expect(url('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
  });

  it.each([
    ['http', 'http://cdn.example/a.jpg'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:image/png;base64,AAAA'],
    ['relativa', '/img/a.jpg'],
    ['sin esquema', '//cdn.example/a.jpg'],
    ['no URL', 'no es una url'],
    ['muy larga', `https://cdn.example/${'a'.repeat(MAX_IMAGE_URL_LENGTH)}`],
  ])('rechaza %s', (_n, value) => {
    expect(url(value)).toBeNull();
  });

  it('no string => null', () => {
    expect(resolveFavorite(product(P, { imageUrl: 42 as never })).product?.imageUrl).toBeNull();
  });
});

describe('UnavailableCatalogAdapter', () => {
  it('siempre rechaza con CatalogUnavailableError y sin red', async () => {
    await expect(new UnavailableCatalogAdapter().findPublicSummaries()).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });
});
