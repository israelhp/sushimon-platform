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
const fail = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

function world() {
  const h = storeHarness();
  const p = h.addProduct(1, {
    name: 'Roll California',
    slug: 'roll-california',
    basePrice: '85.00',
    categoryId: CAT.veganos,
    description: 'Con aguacate',
    image: { url: 'https://cdn.x.io/1.jpg', alt: 'Uno' },
  });
  h.addProduct(2, { name: 'Oculto', slug: 'oculto', categoryId: CAT.calientes });
  return { h, p };
}

describe('StoreProductService', () => {
  it('sin branchId: idéntica a F11/F12 (sin offer, promotions, generatedAt ni nextChangeAt)', async () => {
    const { h } = world();
    h.promotionsRepo.seed({});
    h.resetCounts();
    const r = await h.detail.getDetail('roll-california');
    expect(r).toMatchObject({
      slug: 'roll-california',
      basePrice: '85.00',
      category: { slug: 'veganos' },
      categoryAncestors: [{ slug: 'rolls' }, { slug: 'frios' }],
      media: [{ url: 'https://cdn.x.io/1.jpg', altText: 'Uno' }],
      modifierGroups: [],
    });
    for (const k of ['offer', 'promotions', 'generatedAt', 'nextChangeAt'])
      expect(r).not.toHaveProperty(k);
    expect(h.promotionsRepo.count('findCandidates')).toBe(0);
    expect(JSON.stringify(r)).not.toContain('sku');
  });

  it('con branchId: offer de ESA sucursal, promociones ≤ 3 de mayor ahorro, generatedAt y nextChangeAt', async () => {
    const { h, p } = world();
    h.world.seedRow(A, p.id, { priceOverride: '80.00' });
    h.world.seedRow(B, p.id, { priceOverride: '99.00', available: false });
    h.promotionsRepo.seed({ name: 'Q5', kind: 'FIXED_AMOUNT', value: '5.00' });
    h.promotionsRepo.seed({ name: '50%', value: '50.00' });
    h.promotionsRepo.seed({ name: '10%', value: '10.00' });
    h.promotionsRepo.seed({ name: '20%', value: '20.00', endsAt: local('2026-11-16T16:00:12') });
    h.promotionsRepo.seed({ name: 'Cupón', code: 'ABC123', value: '90.00' });
    const r = await h.detail.getDetail('roll-california', A);
    expect(r.offer).toEqual({ branchId: A, price: '80.00', available: true });
    expect(r.promotions?.map((x) => [x.name, x.promoPrice])).toEqual([
      ['50%', '40.00'],
      ['20%', '64.00'],
      ['10%', '72.00'],
    ]);
    expect(r.generatedAt).toBe(local('2026-11-16T16:00:00').toISOString());
    expect(r.nextChangeAt).toBe(local('2026-11-16T16:00:12').toISOString());
    expect(JSON.stringify(r)).not.toContain('ABC123');
    const other = await h.detail.getDetail('roll-california', B);
    expect(other.offer).toEqual({ branchId: B, price: '99.00', available: false });
    expect(other.promotions).toEqual([]);
  });

  it('producto inexistente / inactivo / categoría no visible => PRODUCT_NOT_FOUND; sucursal mala => BRANCH_NOT_FOUND', async () => {
    const { h } = world();
    expect(code(await fail(h.detail.getDetail('oculto')))).toBe('PRODUCT_NOT_FOUND');
    expect(code(await fail(h.detail.getDetail('nada', A)))).toBe('PRODUCT_NOT_FOUND');
    for (const id of [MISSING_BRANCH, INACTIVE_BRANCH]) {
      expect(code(await fail(h.detail.getDetail('roll-california', id)))).toBe('BRANCH_NOT_FOUND');
    }
  });

  it('consultas constantes con branchId: 4 de la ficha + sucursal + oferta + candidatas = 7', async () => {
    const { h } = world();
    h.promotionsRepo.seed({});
    h.resetCounts();
    await h.detail.getDetail('roll-california', A);
    expect(h.queryCount()).toBe(7);
    h.resetCounts();
    await h.detail.getDetail('roll-california');
    expect(h.queryCount()).toBe(4);
  });
});
