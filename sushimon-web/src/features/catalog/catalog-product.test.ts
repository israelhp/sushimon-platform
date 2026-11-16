import { describe, expect, it } from 'vitest';
import type { PublicProduct } from '@/lib/data-access/models';
import { withShortcuts } from '@/lib/data-access/types';
import { createHarness } from '@/mocks/testing';
import { loadCatalog, toCatalogProduct } from './catalog-product';

const pub: PublicProduct = {
  id: 'uuid-1',
  slug: 'roll-mon',
  name: 'Roll Mon',
  description: null,
  basePrice: '85.00',
  category: { id: 'c-rolls', slug: 'rolls', name: 'Rolls' },
  media: [{ url: 'https://a.test/x.jpg', altText: 'x' }],
};

describe('toCatalogProduct', () => {
  it('precio numérico desde basePrice, categoría real y valores neutros sin extras (api real)', () => {
    expect(toCatalogProduct(pub)).toMatchObject({
      id: 'uuid-1',
      price: 85,
      basePrice: '85.00',
      categoryId: 'c-rolls',
      description: '',
      illustration: 'roll',
      featured: false,
      food: true,
      available: true,
      availability: [],
      media: pub.media,
    });
  });
  it('la ilustración por defecto sale de la categoría y las bebidas no son «comida»', () => {
    const drink = { ...pub, category: { id: 'c', slug: 'relax', name: 'Relax' } };
    expect(toCatalogProduct(drink)).toMatchObject({ illustration: 'shake', food: false });
  });
  it('con extras simulados los usa (nombre en inglés, disponibilidad)', () => {
    const p = toCatalogProduct(pub, {
      productId: 'uuid-1',
      nameEn: 'Mon Roll',
      illustration: 'pizza',
      featured: true,
      food: true,
      available: false,
      availability: [{ branchId: 's1', available: false }],
    });
    expect(p).toMatchObject({
      nameEn: 'Mon Roll',
      illustration: 'pizza',
      featured: true,
      available: false,
    });
  });
});

describe('loadCatalog', () => {
  it('mock: todas las páginas de F11 + extras simulados por id', async () => {
    const h = createHarness();
    const catalog = await loadCatalog(h.client, { branchId: 'sucursal-3' });
    expect(catalog).toHaveLength(29);
    expect(catalog.find((p) => p.id === 'joselito-roll')).toMatchObject({
      available: false,
      price: 67,
      categoryId: 'cat-rolls',
      nameEn: undefined,
    });
    expect(catalog.find((p) => p.id === 'dumplings')?.descriptionEn).toMatch(/Steamed/);
  });

  it('http: no pide los extras simulados (no existen en la API real) y usa valores neutros', async () => {
    const h = createHarness();
    const paths: string[] = [];
    const http = withShortcuts('http', async (path, options) => {
      paths.push(path);
      return h.client.request(path, options);
    });
    const catalog = await loadCatalog(http);
    expect(paths.every((p) => p.startsWith('/v1/store/products'))).toBe(true);
    expect(catalog.every((p) => p.available && p.availability.length === 0)).toBe(true);
  });

  it('si los extras fallan el catálogo sigue con valores neutros', async () => {
    const h = createHarness();
    const client = withShortcuts('mock', async (path, options) => {
      if (path.startsWith('/v1/demo/')) throw new Error('boom');
      return h.client.request(path, options);
    });
    expect(await loadCatalog(client)).toHaveLength(29);
  });
});
