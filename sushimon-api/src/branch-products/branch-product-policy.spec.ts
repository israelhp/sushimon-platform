import {
  centsToPrice,
  effectivePrice,
  isDefaultRow,
  isUuid,
  normalizePriceOverride,
  parsePriceInput,
  planAvailability,
  planPricing,
  priceAudit,
  stateView,
  toCents,
} from './branch-product-policy.js';

const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { status?: number }).status;
const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};
const row = (over: Partial<{ priceOverride: string | null; available: boolean }> = {}) => ({
  priceOverride: null,
  available: true,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('precio (céntimos enteros)', () => {
  it('convierte sin floats', () => {
    expect(toCents('85.00')).toBe(8500);
    expect(toCents('0.07')).toBe(7);
    expect(toCents('999999.99')).toBe(99_999_999);
    expect(centsToPrice(8500)).toBe('85.00');
    expect(centsToPrice(7)).toBe('0.07');
    expect(centsToPrice(toCents('000085.10'))).toBe('85.10');
  });

  it('forma inválida => 400 (no cadena, sin decimales, > 6 dígitos, negativo, número)', () => {
    for (const bad of [
      85,
      85.5,
      '85',
      '85.5',
      '1000000.00',
      '-1.00',
      '',
      ' 85.00',
      undefined,
      {},
      [],
      true,
    ]) {
      const e = thrown(() => parsePriceInput(bad));
      expect(status(e), JSON.stringify(bad) ?? 'undefined').toBe(400);
    }
  });

  it('null => borrar; "0.00" => 422 BRANCH_PRICE_INVALID con violación priceOverride', () => {
    expect(normalizePriceOverride(parsePriceInput(null))).toBeNull();
    const e = thrown(() => normalizePriceOverride(parsePriceInput('0.00')));
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('BRANCH_PRICE_INVALID');
    expect(
      (e as { response: { violations: { path: string }[] } }).response.violations[0]?.path,
    ).toBe('priceOverride');
  });

  it('normaliza ceros a la izquierda y acepta el tope', () => {
    expect(normalizePriceOverride(parsePriceInput('000085.00'))).toBe('85.00');
    expect(normalizePriceOverride(parsePriceInput('999999.99'))).toBe('999999.99');
    expect(normalizePriceOverride(parsePriceInput('0.01'))).toBe('0.01');
  });

  it('precio efectivo: override o base', () => {
    expect(effectivePrice('50.00', null)).toBe('50.00');
    expect(effectivePrice('50.00', '45.50')).toBe('45.50');
  });
});

describe('planificación idempotente (D2)', () => {
  it('pricing: sin cambio => null; set/clear con valor anterior', () => {
    expect(planPricing(null, null)).toBeNull();
    expect(planPricing(row({ priceOverride: '45.00' }), '45.00')).toBeNull();
    expect(planPricing(null, '45.00')).toEqual({ action: 'price_set', oldPrice: null });
    expect(planPricing(row({ priceOverride: '45.00' }), '40.00')).toEqual({
      action: 'price_set',
      oldPrice: '45.00',
    });
    expect(planPricing(row({ priceOverride: '45.00' }), null)).toEqual({
      action: 'price_cleared',
      oldPrice: '45.00',
    });
  });

  it('availability: ausencia de fila = disponible', () => {
    expect(planAvailability(null, true)).toBeNull();
    expect(planAvailability(null, false)).toEqual({ oldAvailable: true });
    expect(planAvailability(row({ available: false }), false)).toBeNull();
    expect(planAvailability(row({ available: false }), true)).toEqual({ oldAvailable: false });
  });

  it('la fila es "por defecto" solo sin override y disponible', () => {
    expect(isDefaultRow({ priceOverride: null, available: true })).toBe(true);
    expect(isDefaultRow({ priceOverride: '1.00', available: true })).toBe(false);
    expect(isDefaultRow({ priceOverride: null, available: false })).toBe(false);
  });
});

describe('stateView', () => {
  const product = { id: 'p', basePrice: '50.00', active: true, categoryId: 'c' };
  it('sin fila: base, disponible, updatedAt null', () => {
    expect(stateView('b', product, null, true)).toEqual({
      branchId: 'b',
      productId: 'p',
      basePrice: '50.00',
      priceOverride: null,
      effectivePrice: '50.00',
      available: true,
      offered: true,
      updatedAt: null,
    });
  });
  it('offered exige producto activo, categoría visible y disponible', () => {
    expect(stateView('b', product, row({ available: false }), true).offered).toBe(false);
    expect(stateView('b', product, null, false).offered).toBe(false);
    expect(stateView('b', { ...product, active: false }, null, true).offered).toBe(false);
    expect(stateView('b', product, row({ priceOverride: '40.00' }), true)).toMatchObject({
      priceOverride: '40.00',
      effectivePrice: '40.00',
      basePrice: '50.00',
    });
  });
});

describe('auditoría y uuid', () => {
  it('no incluye PII: solo ids y valores', () => {
    expect(priceAudit('b', 'p', null, '40.00')).toEqual({
      oldValues: { branchId: 'b', productId: 'p', oldPrice: null },
      newValues: { branchId: 'b', productId: 'p', newPrice: '40.00' },
    });
  });
  it('isUuid', () => {
    expect(isUuid('00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isUuid('x')).toBe(false);
    expect(isUuid(5)).toBe(false);
  });
});
