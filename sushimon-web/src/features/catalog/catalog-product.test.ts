import { describe, expect, it } from 'vitest';
import type { PublicProductDetail, StoreBranchMenuItem } from '@/lib/data-access/models';
import { withShortcuts } from '@/lib/data-access/types';
import { createHarness } from '@/mocks/testing';
import { cardToCatalogProduct, detailToCatalogProduct, loadStoreMenu } from './catalog-product';

const card: StoreBranchMenuItem = {
  productId: 'uuid-1',
  slug: 'roll-mon',
  price: '85.00',
  available: true,
  name: 'Roll Mon',
  summary: 'Roll de la casa',
  image: { url: 'https://a.test/x.jpg', altText: 'x' },
  category: { id: 'c-rolls', slug: 'rolls', name: 'Rolls' },
  promo: null,
};

describe('cardToCatalogProduct (F17)', () => {
  it('precio numérico desde la tarjeta, categoría real y valores neutros sin extras (api real)', () => {
    expect(cardToCatalogProduct(card)).toMatchObject({
      id: 'uuid-1',
      slug: 'roll-mon',
      name: 'Roll Mon',
      price: 85,
      effectivePrice: '85.00',
      categoryId: 'c-rolls',
      description: 'Roll de la casa',
      illustration: 'roll',
      featured: false,
      food: true,
      available: true,
      availability: [],
      media: [card.image],
      promo: null,
    });
  });
  it('available=null (sin sucursal) se trata como disponible; solo false es agotado y se conserva visible', () => {
    expect(cardToCatalogProduct({ ...card, available: null }).available).toBe(true);
    expect(cardToCatalogProduct({ ...card, available: false }).available).toBe(false);
  });
  it('sin imagen no hay media (placeholder) y la promoción de la respuesta se conserva tal cual', () => {
    const promo = {
      promotionId: 'p',
      name: 'Happy',
      isHappyHour: true,
      dineInOnly: false,
      regularPrice: '85.00',
      promoPrice: '68.00',
    };
    expect(cardToCatalogProduct({ ...card, image: null, promo })).toMatchObject({
      media: [],
      promo,
      price: 85,
    });
  });
  it('tolera una tarjeta sin los campos que el esquema no marca como obligatorios', () => {
    const minimal = { productId: 'u', slug: 's', price: '10.00', available: true };
    expect(cardToCatalogProduct(minimal)).toMatchObject({ name: 's', description: '', media: [] });
  });
  it('la ilustración por defecto sale de la categoría y las bebidas no son «comida»', () => {
    const drink = { ...card, category: { id: 'c', slug: 'relax', name: 'Relax' } };
    expect(cardToCatalogProduct(drink)).toMatchObject({ illustration: 'shake', food: false });
  });
  it('con extras simulados los usa (nombre en inglés, ilustración, destacado)', () => {
    const p = cardToCatalogProduct(card, {
      productId: 'uuid-1',
      nameEn: 'Mon Roll',
      illustration: 'pizza',
      featured: true,
      food: true,
    });
    expect(p).toMatchObject({ nameEn: 'Mon Roll', illustration: 'pizza', featured: true });
  });
});

describe('detailToCatalogProduct (F17)', () => {
  const detail: PublicProductDetail = {
    id: 'uuid-1',
    slug: 'roll-mon',
    name: 'Roll Mon',
    description: 'Descripción completa',
    basePrice: '85.00',
    category: { id: 'c-rolls', slug: 'rolls', name: 'Rolls' },
    media: [],
    categoryAncestors: [],
    modifierGroups: [],
  };
  it('sin sucursal: precio base y disponible; conserva la descripción completa', () => {
    expect(detailToCatalogProduct(detail)).toMatchObject({
      price: 85,
      description: 'Descripción completa',
      available: true,
      promo: null,
    });
  });
  it('con sucursal: precio y disponibilidad de la oferta, y la promoción de mayor ahorro', () => {
    const promo = {
      promotionId: 'p',
      name: 'Happy',
      isHappyHour: true,
      dineInOnly: true,
      regularPrice: '86.00',
      promoPrice: '70.00',
    };
    const p = detailToCatalogProduct({
      ...detail,
      offer: { branchId: 'b', price: '86.00', available: false },
      promotions: [promo],
    });
    expect(p).toMatchObject({ price: 86, effectivePrice: '86.00', available: false, promo });
  });
});

describe('loadStoreMenu (F17)', () => {
  it('mock: el menú completo (tarjetas) + extras simulados por id', async () => {
    const h = createHarness();
    const menu = await loadStoreMenu(h.client, { branchId: null });
    expect(menu.items).toHaveLength(29);
    expect(menu.total).toBe(29);
    expect(menu.items.find((p) => p.id === 'joselito-roll')).toMatchObject({
      available: true,
      price: 67,
    });
    expect(menu.items.find((p) => p.id === 'dumplings')?.descriptionEn).toMatch(/Steamed/);
  });

  it('con sucursal usa el precio efectivo de ESA sucursal y marca los agotados', async () => {
    const h = createHarness();
    const s1 = await loadStoreMenu(h.client, { branchId: 'sucursal-1' });
    const s2 = await loadStoreMenu(h.client, { branchId: 'sucursal-2' });
    expect(s1.items.find((p) => p.id === 'dynamita-roll')).toMatchObject({ price: 82 });
    expect(s2.items.find((p) => p.id === 'dynamita-roll')).toMatchObject({
      price: 86,
      effectivePrice: '86.00',
    });
    expect(s2.items.find((p) => p.id === 'gaseosas')?.available).toBe(false);
    expect(s1.items.find((p) => p.id === 'gaseosas')?.available).toBe(true);
  });

  it('http: no pide los extras simulados y solo llama a /v1/store/menu', async () => {
    const h = createHarness();
    const paths: string[] = [];
    const http = withShortcuts('http', async (path, options) => {
      paths.push(path);
      return h.client.request(path, options);
    });
    const menu = await loadStoreMenu(http, { branchId: 'sucursal-1' });
    expect(paths).toEqual(['/v1/store/menu']);
    expect(menu.items.every((p) => p.availability.length === 0)).toBe(true);
  });

  it('si los extras fallan el menú sigue con valores neutros', async () => {
    const h = createHarness();
    const client = withShortcuts('mock', async (path, options) => {
      if (path.startsWith('/v1/demo/')) throw new Error('boom');
      return h.client.request(path, options);
    });
    expect((await loadStoreMenu(client, { branchId: null })).items).toHaveLength(29);
  });

  it('sigue `total` página a página cuando hay más de 100 productos (carga completa, sin duplicados)', async () => {
    const seen: unknown[] = [];
    const big = withShortcuts(
      'http',
      async <T>(_path: string, options?: { query?: Record<string, unknown> }) => {
        seen.push(options?.query?.page ?? 1);
        // 3 páginas simuladas de 100/100/20 con ids distintos.
        const page = Number(options?.query?.page ?? 1);
        const size = page === 3 ? 20 : 100;
        return {
          branchId: null,
          page,
          pageSize: 100,
          total: 220,
          generatedAt: '2026-11-11T20:25:00.000Z',
          nextChangeAt: null,
          items: Array.from({ length: size }, (_, i) => ({
            ...card,
            productId: `p-${page}-${i}`,
            slug: `p-${page}-${i}`,
          })),
        } as T;
      },
    );
    const menu = await loadStoreMenu(big, { branchId: null });
    expect(menu.items).toHaveLength(220);
    expect(new Set(menu.items.map((p) => p.id)).size).toBe(220);
    expect(seen).toEqual([1, 2, 3]);
  });
});
