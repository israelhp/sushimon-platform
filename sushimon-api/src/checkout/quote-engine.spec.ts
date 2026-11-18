import { PromotionEvaluator, type EvaluatorPromotion } from '../promotions/promotion-evaluator.js';
import type { EngineLine } from './quote-engine.js';
import { evaluateDiscounts, priceQuote } from './quote-engine.js';

const BRANCH = '00000000-0000-4000-8000-000000007001';
const AT = new Date('2026-11-16T22:00:00Z'); // lunes 16:00 en Guatemala
const evaluator = new PromotionEvaluator('America/Guatemala');

const promo = (over: Partial<EvaluatorPromotion> = {}): EvaluatorPromotion => ({
  id: '00000000-0000-4000-8000-00000000f001',
  code: null,
  kind: 'PERCENT',
  value: '10.00',
  startsAt: new Date('2026-01-01T00:00:00Z'),
  endsAt: new Date('2027-01-01T00:00:00Z'),
  dineInOnly: false,
  active: true,
  branchIds: 'ALL',
  productIds: 'ALL',
  schedule: [],
  ...over,
});

const line = (
  index: number,
  unitCents: number,
  quantity: number,
  extrasPerUnitCents = 0,
  over: Partial<EngineLine> = {},
): EngineLine => ({
  index,
  productId: `00000000-0000-4000-8000-0000000080${String(index).padStart(2, '0')}`,
  quantity,
  status: 'OK',
  unitCents,
  extrasPerUnitCents,
  modifiers: [],
  previousUnitPrice: null,
  ...over,
});

const run = (
  lines: EngineLine[],
  promotions: EvaluatorPromotion[] = [],
  fee: number | null = 0,
  couponCode: string | null = null,
) => {
  const ev = evaluateDiscounts(evaluator, {
    at: AT,
    branchId: BRANCH,
    mode: 'pickup',
    couponCode,
    promotions,
    lines,
  });
  return { ev, amounts: priceQuote(lines, ev.discounts, fee) };
};

describe('quote-engine (F19, filas 12, 15 y 16)', () => {
  it('suma exacta con centavos (sin errores de coma flotante)', () => {
    const { amounts } = run([line(0, 1010, 3), line(1, 5, 7), line(2, 1, 1)]);
    // 0.10 + 0.20 con flotantes daría 0.30000000000000004: aquí 3030 + 35 + 1 = 3066
    expect(amounts.subtotal).toBe('30.66');
    expect(amounts.total).toBe('30.66');
  });

  it('99 × 9999.99 sin pérdida de precisión', () => {
    const { amounts } = run([line(0, 999_999, 99)]);
    expect(amounts.subtotal).toBe('989999.01');
    expect(amounts.total).toBe('989999.01');
    const withFee = run([line(0, 999_999, 99)], [], 1550);
    expect(withFee.amounts.total).toBe('990014.51');
  });

  it('PERCENT: medio hacia arriba sobre el total de la línea y tope en la base', () => {
    // 15 % de 0.30 = 4.5 centavos -> 5
    expect(run([line(0, 10, 3)], [promo({ value: '15.00' })]).amounts.lines[0]?.discount).toBe(
      '0.05',
    );
    // 12.5 % de 0.04 = 0.5 -> 1 (medio hacia arriba)
    expect(run([line(0, 4, 1)], [promo({ value: '12.50' })]).amounts.lines[0]?.discount).toBe(
      '0.01',
    );
    expect(run([line(0, 8500, 2)], [promo({ value: '100.00' })]).amounts.total).toBe('0.00');
  });

  it('FIXED_AMOUNT por unidad con tope en la base', () => {
    const r = run([line(0, 500, 2)], [promo({ kind: 'FIXED_AMOUNT', value: '3.00' })]);
    expect(r.amounts.lines[0]?.discount).toBe('6.00');
    const capped = run([line(0, 500, 2)], [promo({ kind: 'FIXED_AMOUNT', value: '30.00' })]);
    expect(capped.amounts.lines[0]).toMatchObject({ discount: '10.00', lineTotal: '0.00' });
  });

  it('los extras no se descuentan ni cuentan para el tope', () => {
    const r = run([line(0, 1000, 2, 300)], [promo({ kind: 'FIXED_AMOUNT', value: '50.00' })]);
    expect(r.amounts.lines[0]).toMatchObject({
      lineSubtotal: '26.00',
      discount: '20.00',
      lineTotal: '6.00',
    });
    expect(r.amounts.extrasTotal).toBe('6.00');
  });

  it('una promoción por línea: la de mayor ahorro; id menor desempata; sin apilar', () => {
    const a = promo({ id: '00000000-0000-4000-8000-00000000f00a', value: '10.00' });
    const b = promo({ id: '00000000-0000-4000-8000-00000000f00b', value: '25.00' });
    const c = promo({
      id: '00000000-0000-4000-8000-00000000f00c',
      kind: 'FIXED_AMOUNT',
      value: '5.00',
    });
    const r = run([line(0, 10_000, 1)], [a, b, c]);
    expect(r.amounts.lines[0]).toMatchObject({ promotionId: b.id, discount: '25.00' });
    expect(r.amounts.discountTotal).toBe('25.00');
    const tie = run([line(0, 10_000, 1)], [b, { ...a, value: '25.00' }]);
    expect(tie.amounts.lines[0]?.promotionId).toBe(a.id);
  });

  it('promociones por producto: solo la línea en alcance', () => {
    const l0 = line(0, 1000, 1);
    const l1 = line(1, 1000, 1);
    const r = run([l0, l1], [promo({ productIds: [l1.productId], value: '50.00' })]);
    expect(r.amounts.lines.map((l) => l.discount)).toEqual(['0.00', '5.00']);
  });

  it('cupón: válido APPLIED; inexistente, vencido o de otra sucursal => NOT_APPLIED colapsado', () => {
    const coupon = promo({ code: 'SUSHI', value: '20.00' });
    expect(run([line(0, 1000, 1)], [coupon], 0, 'sushi').ev.coupon).toEqual({ status: 'APPLIED' });
    for (const bad of [
      [promo({ code: 'SUSHI', endsAt: new Date('2026-01-02T00:00:00Z') })],
      [promo({ code: 'SUSHI', branchIds: ['otra'] })],
      [promo({ code: 'SUSHI', active: false })],
      [],
    ]) {
      const r = run([line(0, 1000, 1)], bad, 0, 'sushi');
      expect(r.ev.coupon).toEqual({ status: 'NOT_APPLIED' });
      expect(r.amounts.discountTotal).toBe('0.00');
    }
    expect(run([line(0, 1000, 1)], [coupon]).ev.coupon).toBeNull();
  });

  it('happy hour: dentro del tramo aplica; fuera no', () => {
    const hh = (startsAt: string, endsAt: string) =>
      promo({ value: '50.00', schedule: [{ weekday: 1, startsAt, endsAt }] });
    expect(run([line(0, 1000, 1)], [hh('15:00', '18:00')]).amounts.discountTotal).toBe('5.00');
    expect(run([line(0, 1000, 1)], [hh('17:00', '18:00')]).amounts.discountTotal).toBe('0.00');
  });

  it('modo: una promoción solo en el local no aplica a pickup', () => {
    expect(run([line(0, 1000, 1)], [promo({ dineInOnly: true })]).amounts.discountTotal).toBe(
      '0.00',
    );
  });

  it('líneas no comprables: importes null, no suman y total null; las demás se calculan', () => {
    const r = run([
      line(0, 1000, 2),
      line(1, null as unknown as number, 1, 0, { status: 'NOT_FOUND', unitCents: null }),
    ]);
    expect(r.amounts.lines[1]).toMatchObject({
      unitPrice: null,
      lineSubtotal: null,
      lineTotal: null,
      discount: null,
    });
    expect(r.amounts.subtotal).toBe('20.00');
    expect(r.amounts.total).toBeNull();
  });

  it('PRICE_CHANGED es comprable y suma; el eco solo aparece en esa línea', () => {
    const r = run([
      line(0, 1000, 1, 0, { status: 'PRICE_CHANGED', previousUnitPrice: '9.00' }),
      line(1, 500, 1, 0, { previousUnitPrice: '4.00' }),
    ]);
    expect(r.amounts.lines.map((l) => l.previousUnitPrice)).toEqual(['9.00', null]);
    expect(r.amounts.total).toBe('15.00');
  });

  it('tarifa null (no verificable) => total null; PICKUP 0 => deliveryFee 0.00', () => {
    expect(run([line(0, 1000, 1)], [], null).amounts).toMatchObject({
      total: null,
      deliveryFee: null,
      totalCents: null,
    });
    expect(run([line(0, 1000, 1)], [], 0).amounts).toMatchObject({
      total: '10.00',
      deliveryFee: '0.00',
    });
  });

  it('propiedad: total = Σ líneas visibles − descuentos + envío (1000 casos pseudoaleatorios deterministas)', () => {
    let seed = 20261116;
    const next = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    for (let i = 0; i < 1000; i++) {
      const lines = Array.from({ length: 1 + next(8) }, (_, idx) =>
        line(idx, 1 + next(200_000), 1 + next(99), next(2) ? next(5000) : 0),
      );
      const promos: EvaluatorPromotion[] = [];
      if (next(2))
        promos.push(
          promo({
            value: `${1 + next(100)}.${String(next(100)).padStart(2, '0')}`.replace(
              /^100\.[1-9].*/,
              '100.00',
            ),
          }),
        );
      if (next(2))
        promos.push(
          promo({
            id: '00000000-0000-4000-8000-00000000f0ff',
            kind: 'FIXED_AMOUNT',
            value: `${1 + next(500)}.${String(next(100)).padStart(2, '0')}`,
          }),
        );
      const fee = next(4) ? next(5000) : null;
      const { amounts } = run(lines, promos, fee);
      const cents = (s: string | null) => Number((s as string).replace('.', ''));
      const sumLines = amounts.lines.reduce((a, l) => a + cents(l.lineTotal), 0);
      expect(amounts.totalCents).toBe(fee === null ? null : sumLines + fee);
      expect(cents(amounts.subtotal) - cents(amounts.discountTotal) + (fee ?? 0)).toBe(
        fee === null ? sumLines : (amounts.totalCents as number),
      );
      for (const l of amounts.lines) {
        expect(cents(l.discount)).toBeLessThanOrEqual(
          Number(l.unitPrice?.replace('.', '')) * l.quantity,
        );
        expect(cents(l.lineSubtotal) - cents(l.discount)).toBe(cents(l.lineTotal));
      }
    }
  });
});
