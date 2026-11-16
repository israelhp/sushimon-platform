import { describe, expect, it } from 'vitest';
import { fromLocal } from '@/lib/time';
import {
  computeLineDiscount,
  decimalToCents,
  evaluatePromotions,
  indicativePromoPrice,
  isInSchedule,
  isLiveAt,
  isScheduleSlotShape,
  isValueInRange,
  lifecycleOf,
  liveIntervals,
  nextChangeAt,
  normalizePromotionCode,
  parseDecimalInput,
  promotionTimes,
  scheduleViolations,
  splitOvernightSlot,
  type EvaluatorPromotion,
  type PromotionWindow,
} from './promotion-rules';

// 2026-11-09 es lunes, 2026-11-13 viernes, 2026-11-14 sábado, 2026-11-15 domingo, 2026-11-16 lunes (hora de Guatemala).
const at = (date: string, time: string, seconds = 0) =>
  new Date(fromLocal(date, time).getTime() + seconds * 1000);
const slot = (weekday: number, startsAt: string, endsAt: string) => ({ weekday, startsAt, endsAt });
const window = (p: Partial<PromotionWindow> = {}): PromotionWindow => ({
  active: true,
  startsAt: '2026-10-01T06:00:00.000Z',
  endsAt: '2027-01-01T06:00:00.000Z',
  schedule: [],
  ...p,
});

describe('horario semanal: intervalos [inicio, fin) en hora de Guatemala (T1–T9, T13)', () => {
  const monday = window({ schedule: [slot(1, '15:00', '18:00')] });

  it('T1/T2: inicio inclusivo y fin exclusivo al segundo', () => {
    expect(isLiveAt(monday, at('2026-11-09', '15:00'))).toBe(true);
    expect(isLiveAt(monday, at('2026-11-09', '14:59', 59))).toBe(false);
    expect(isLiveAt(monday, at('2026-11-09', '17:59', 59))).toBe(true);
    expect(isLiveAt(monday, at('2026-11-09', '18:00'))).toBe(false);
  });

  it('T5/T6: el día es el LOCAL (domingo 21:00 local ya es lunes en UTC, pero rige el domingo)', () => {
    const t = new Date('2026-11-16T03:00:00Z');
    expect(isInSchedule([slot(1, '00:00', '24:00')], t)).toBe(false);
    expect(isInSchedule([slot(7, '21:00', '22:00')], t)).toBe(true);
    expect(isInSchedule([slot(1, '00:00', '01:00')], new Date('2026-11-16T06:00:00Z'))).toBe(true);
    expect(isInSchedule([slot(7, '23:00', '24:00')], new Date('2026-11-16T05:59:59Z'))).toBe(true);
  });

  const overnight = window({
    schedule: [slot(5, '22:00', '24:00'), slot(6, '00:00', '02:00')],
  });

  it('T7: viernes 22:00–24:00 + sábado 00:00–02:00 rigen en los bordes exactos', () => {
    expect(isLiveAt(overnight, at('2026-11-13', '23:59', 59))).toBe(true);
    expect(isLiveAt(overnight, at('2026-11-14', '00:00'))).toBe(true);
    expect(isLiveAt(overnight, at('2026-11-14', '01:59', 59))).toBe(true);
    expect(isLiveAt(overnight, at('2026-11-14', '02:00'))).toBe(false);
  });

  it('T8: los tramos contiguos se fusionan (nextEndsAt = sáb 02:00, no vie 24:00)', () => {
    const times = promotionTimes(overnight, at('2026-11-13', '23:00'));
    expect(times.live).toBe(true);
    expect(times.nextEndsAt?.toISOString()).toBe(at('2026-11-14', '02:00').toISOString());
  });

  it('T9: domingo→lunes también se fusiona (7 → 1)', () => {
    const w = window({ schedule: [slot(7, '22:00', '24:00'), slot(1, '00:00', '01:00')] });
    expect(isLiveAt(w, at('2026-11-15', '23:59', 59))).toBe(true);
    expect(isLiveAt(w, at('2026-11-16', '00:00'))).toBe(true);
    expect(promotionTimes(w, at('2026-11-15', '23:00')).nextEndsAt?.toISOString()).toBe(
      at('2026-11-16', '01:00').toISOString(),
    );
  });

  it('T10: la vigencia corta el tramo en su instante exacto', () => {
    const w = window({ ...overnight, endsAt: at('2026-11-14', '00:30').toISOString() });
    expect(isLiveAt(w, at('2026-11-14', '00:29', 59))).toBe(true);
    expect(isLiveAt(w, at('2026-11-14', '00:30'))).toBe(false);
    expect(promotionTimes(w, at('2026-11-13', '23:00')).nextEndsAt?.toISOString()).toBe(
      at('2026-11-14', '00:30').toISOString(),
    );
  });

  it('T13: sin tramos rige todo el día dentro de la vigencia', () => {
    const w = window();
    expect(isLiveAt(w, at('2026-11-11', '03:00'))).toBe(true);
    expect(promotionTimes(w, at('2026-11-11', '03:00')).nextEndsAt?.toISOString()).toBe(w.endsAt);
  });

  it('T3/T4/T15: vigencia con fin exclusivo, inicio futuro e inactiva', () => {
    const w = window({ endsAt: '2026-12-31T06:00:00.000Z' }); // 31 dic 00:00 local
    expect(lifecycleOf(w, at('2026-12-30', '23:59', 59))).toBe('RUNNING');
    expect(lifecycleOf(w, at('2026-12-31', '00:00'))).toBe('EXPIRED');
    const future = window({
      startsAt: new Date(at('2026-11-11', '12:00').getTime() + 1000).toISOString(),
    });
    expect(lifecycleOf(future, at('2026-11-11', '12:00'))).toBe('SCHEDULED');
    expect(isLiveAt(future, at('2026-11-11', '12:00'))).toBe(false);
    expect(
      lifecycleOf(
        window({ active: false, endsAt: '2020-01-01T00:00:00Z' }),
        at('2026-11-11', '12:00'),
      ),
    ).toBe('INACTIVE');
    expect(promotionTimes(window({ active: false }), at('2026-11-11', '12:00'))).toEqual({
      live: false,
      nextEndsAt: null,
      nextStartsAt: null,
    });
  });

  it('próximo inicio: hoy antes del tramo, o el siguiente día con tramo', () => {
    const w = window({ schedule: [1, 2, 3, 4].map((d) => slot(d, '15:00', '18:00')) });
    // miércoles 14:25 → hoy 15:00
    expect(promotionTimes(w, at('2026-11-11', '14:25')).nextStartsAt?.toISOString()).toBe(
      at('2026-11-11', '15:00').toISOString(),
    );
    // jueves 19:00 → lunes siguiente
    expect(promotionTimes(w, at('2026-11-12', '19:00')).nextStartsAt?.toISOString()).toBe(
      at('2026-11-16', '15:00').toISOString(),
    );
    // vigente: nextStartsAt = el siguiente tramo, nextEndsAt = fin del actual
    const live = promotionTimes(w, at('2026-11-11', '16:00'));
    expect(live.nextEndsAt?.toISOString()).toBe(at('2026-11-11', '18:00').toISOString());
    expect(live.nextStartsAt?.toISOString()).toBe(at('2026-11-12', '15:00').toISOString());
  });

  it('horizonte de 14 días: un inicio posterior no cuenta como próximo', () => {
    const far = window({ startsAt: at('2026-12-20', '00:00').toISOString() });
    expect(promotionTimes(far, at('2026-11-11', '12:00')).nextStartsAt).toBeNull();
    expect(
      promotionTimes(
        window({ startsAt: at('2026-11-24', '00:00').toISOString() }),
        at('2026-11-11', '12:00'),
      ).nextStartsAt,
    ).not.toBeNull();
  });

  it('T17: nextChangeAt = el menor cambio futuro de todas las promociones activas', () => {
    const a = window({ schedule: [slot(3, '15:00', '18:00')] });
    const b = window({ endsAt: at('2026-11-11', '14:30').toISOString() });
    const inactive = window({ active: false, endsAt: at('2026-11-11', '14:26').toISOString() });
    const now = at('2026-11-11', '14:25');
    expect(nextChangeAt([a, b, inactive], now)?.toISOString()).toBe(
      at('2026-11-11', '14:30').toISOString(),
    );
    expect(nextChangeAt([a], now)?.toISOString()).toBe(at('2026-11-11', '15:00').toISOString());
    expect(nextChangeAt([window({ endsAt: '2026-11-01T06:00:00Z' })], now)).toBeNull();
  });

  it('liveIntervals fusiona contiguos y no muta la entrada', () => {
    const schedule = [slot(6, '00:00', '02:00'), slot(5, '22:00', '24:00')];
    const copy = JSON.stringify(schedule);
    const w = window({ schedule });
    const iv = liveIntervals(w, at('2026-11-13', '12:00'), at('2026-11-15', '12:00'));
    expect(iv).toHaveLength(1);
    expect(iv[0]).toEqual({
      start: at('2026-11-13', '22:00').getTime(),
      end: at('2026-11-14', '02:00').getTime(),
    });
    expect(JSON.stringify(schedule)).toBe(copy);
  });
});

describe('validación del horario (T11, T12, T16)', () => {
  it('T11: fin <= inicio es SLOT_ENDS_BEFORE_START (con el índice original)', () => {
    expect(scheduleViolations([slot(1, '18:00', '15:00'), slot(2, '10:00', '10:00')])).toEqual([
      { path: 'schedule[0]', code: 'SLOT_ENDS_BEFORE_START' },
      { path: 'schedule[1]', code: 'SLOT_ENDS_BEFORE_START' },
    ]);
  });

  it('T12: solapados son inválidos y contiguos válidos', () => {
    expect(scheduleViolations([slot(1, '15:00', '18:00'), slot(1, '17:00', '19:00')])).toEqual([
      { path: 'schedule[1]', code: 'SLOT_OVERLAP' },
    ]);
    expect(scheduleViolations([slot(1, '15:00', '18:00'), slot(1, '18:00', '19:00')])).toEqual([]);
    // mismo rango en días distintos no es solape
    expect(scheduleViolations([slot(1, '15:00', '18:00'), slot(2, '15:00', '18:00')])).toEqual([]);
  });

  it('límites: más de 6 por día o 42 en total', () => {
    const seven = Array.from({ length: 7 }, (_, i) => slot(1, `0${i}:00`, `0${i}:30`));
    expect(scheduleViolations(seven).map((v) => v.code)).toContain('SLOT_LIMIT');
    const six = seven.slice(0, 6);
    expect(scheduleViolations(six)).toEqual([]);
    const many = Array.from({ length: 43 }, (_, i) =>
      slot(
        (i % 7) + 1,
        `${String(Math.floor(i / 7)).padStart(2, '0')}:00`,
        `${String(Math.floor(i / 7)).padStart(2, '0')}:30`,
      ),
    );
    expect(scheduleViolations(many).map((v) => v.code)).toContain('SLOT_LIMIT');
  });

  it('T16: la forma exige weekday 1..7 entero y horas HH:mm (24:00 solo como fin)', () => {
    expect(isScheduleSlotShape(slot(0, '15:00', '18:00'))).toBe(false);
    expect(isScheduleSlotShape(slot(8, '15:00', '18:00'))).toBe(false);
    expect(isScheduleSlotShape(slot(1, '24:00', '24:00'))).toBe(false);
    expect(isScheduleSlotShape(slot(1, '7:5', '18:00'))).toBe(false);
    expect(isScheduleSlotShape(slot(1.5, '15:00', '18:00'))).toBe(false);
    expect(isScheduleSlotShape({ ...slot(1, '15:00', '18:00'), extra: 1 })).toBe(false);
    expect(isScheduleSlotShape(slot(7, '22:00', '24:00'))).toBe(true);
  });

  it('una franja que cruza la medianoche se parte en dos días (domingo continúa en lunes)', () => {
    expect(splitOvernightSlot(5, '22:00', '02:00')).toEqual([
      slot(5, '22:00', '24:00'),
      slot(6, '00:00', '02:00'),
    ]);
    expect(splitOvernightSlot(7, '22:00', '01:00')).toEqual([
      slot(7, '22:00', '24:00'),
      slot(1, '00:00', '01:00'),
    ]);
    expect(splitOvernightSlot(2, '20:00', '00:00')).toEqual([slot(2, '20:00', '24:00')]);
  });
});

describe('dinero: centavos enteros y basis points (D9, D15.7–D15.8)', () => {
  it('ejemplos de la spec', () => {
    // PERCENT 15.00 sobre Q85.00 × 2 → 25.50, final 144.50
    expect(computeLineDiscount(8500, 2, 'PERCENT', 1500)).toEqual({
      lineBase: 17000,
      discount: 2550,
      finalPrice: 14450,
    });
    // PERCENT 33.33 sobre Q10.01 × 1: 333.63 → 334
    expect(computeLineDiscount(1001, 1, 'PERCENT', 3333)).toEqual({
      lineBase: 1001,
      discount: 334,
      finalPrice: 667,
    });
    // FIXED 20.00 sobre Q15.00 × 3: min(6000, 4500) → 45.00, final 0.00
    expect(computeLineDiscount(1500, 3, 'FIXED_AMOUNT', 2000)).toEqual({
      lineBase: 4500,
      discount: 4500,
      finalPrice: 0,
    });
  });

  it('redondeo medio hacia arriba sobre el total de la línea (no por unidad)', () => {
    // 0.5 centavo exacto sube: 1 × 0.50 % de Q1.00 = 0.5 → 1 centavo.
    expect(computeLineDiscount(100, 1, 'PERCENT', 50).discount).toBe(1);
    // Por unidad serían 3 × round(3.33)=9; sobre el total: 1000 × 3 × 33.33 % = 999.9 → 1000.
    expect(computeLineDiscount(1000, 3, 'PERCENT', 3333).discount).toBe(1000);
    expect(computeLineDiscount(1000, 1, 'PERCENT', 3333).discount).toBe(333);
  });

  it('propiedades: 0 ≤ descuento ≤ lineBase, final ≥ 0, sin decimales, en los bordes', () => {
    const prices = [1, 99, 100, 1001, 8500, 99_999_999];
    const values = [1, 3333, 5000, 9999, 10_000];
    for (const price of prices) {
      for (const quantity of [1, 2, 7, 99]) {
        for (const value of values) {
          for (const kind of ['PERCENT', 'FIXED_AMOUNT'] as const) {
            const r = computeLineDiscount(price, quantity, kind, value);
            expect(Number.isInteger(r.discount)).toBe(true);
            expect(r.discount).toBeGreaterThanOrEqual(0);
            expect(r.discount).toBeLessThanOrEqual(r.lineBase);
            expect(r.finalPrice).toBeGreaterThanOrEqual(0);
            expect(r.finalPrice + r.discount).toBe(r.lineBase);
            expect(Number.isSafeInteger(r.lineBase * value)).toBe(true);
          }
        }
      }
    }
    expect(computeLineDiscount(8500, 1, 'PERCENT', 10_000).finalPrice).toBe(0);
  });

  it('cadenas decimales: forma, rango y entrada del formulario', () => {
    expect(decimalToCents('15.00')).toBe(1500);
    expect(decimalToCents('0.00')).toBe(0);
    expect(decimalToCents('999999.99')).toBe(99_999_999);
    for (const bad of ['15', '15.0', '15,00', '1234567.00', '-1.00', '', '1e2']) {
      expect(decimalToCents(bad)).toBeNull();
    }
    expect(parseDecimalInput('15')).toBe('15.00');
    expect(parseDecimalInput('15,5')).toBe('15.50');
    expect(parseDecimalInput(' 0.07 ')).toBe('0.07');
    expect(parseDecimalInput('1.234')).toBeNull();
    expect(isValueInRange('PERCENT', 10_000)).toBe(true);
    expect(isValueInRange('PERCENT', 10_001)).toBe(false);
    expect(isValueInRange('PERCENT', 0)).toBe(false);
    expect(isValueInRange('FIXED_AMOUNT', 99_999_999)).toBe(true);
    expect(isValueInRange('FIXED_AMOUNT', 100_000_000)).toBe(false);
    expect(normalizePromotionCode('  bienvenido10 ')).toBe('BIENVENIDO10');
  });

  it('precio indicativo: misma función, sin ahorro => null', () => {
    expect(indicativePromoPrice('53.00', { kind: 'PERCENT', value: '25.00' })).toBe('39.75');
    expect(indicativePromoPrice('10.01', { kind: 'PERCENT', value: '33.33' })).toBe('6.67');
    expect(indicativePromoPrice('15.00', { kind: 'FIXED_AMOUNT', value: '20.00' })).toBe('0.00');
    expect(indicativePromoPrice('0.01', { kind: 'PERCENT', value: '1.00' })).toBeNull();
  });
});

describe('evaluador: una promoción por línea, mayor ahorro, desempates (D15)', () => {
  const base = (over: Partial<EvaluatorPromotion>): EvaluatorPromotion => ({
    id: 'a',
    code: null,
    kind: 'PERCENT',
    value: '10.00',
    startsAt: '2026-10-01T06:00:00.000Z',
    endsAt: '2027-01-01T06:00:00.000Z',
    dineInOnly: false,
    active: true,
    branchIds: 'ALL',
    productIds: 'ALL',
    schedule: [],
    ...over,
  });
  const now = at('2026-11-11', '16:00');
  const run = (promotions: EvaluatorPromotion[], extra: object = {}) =>
    evaluatePromotions({
      at: now,
      branchId: 'sucursal-1',
      mode: 'pickup',
      lines: [{ productId: 'p1', unitPrice: '85.00', quantity: 2 }],
      promotions,
      ...extra,
    });

  it('elige la de mayor ahorro y nunca apila % + monto', () => {
    const r = run([
      base({ id: 'pct', value: '10.00' }), // 17.00
      base({ id: 'fix', kind: 'FIXED_AMOUNT', value: '12.00' }), // 24.00 (por unidad × 2)
    ]);
    expect(r.lines[0]).toMatchObject({
      promotionId: 'fix',
      discount: '24.00',
      finalPrice: '146.00',
    });
  });

  it('desempate: con código, luego vence antes, luego id menor; independiente del orden', () => {
    const a = base({ id: 'b', code: 'CUPON', endsAt: '2027-02-01T06:00:00Z' });
    const b = base({ id: 'a', endsAt: '2026-12-01T06:00:00Z' });
    const c = base({ id: 'c', endsAt: '2026-12-01T06:00:00Z' });
    for (const order of [
      [a, b, c],
      [c, b, a],
      [b, a, c],
    ]) {
      expect(run(order, { couponCode: ' cupon ' }).lines[0]?.promotionId).toBe('b');
    }
    for (const order of [
      [b, c],
      [c, b],
    ])
      expect(run(order).lines[0]?.promotionId).toBe('a');
    const early = base({ id: 'z', endsAt: '2026-11-30T06:00:00Z' });
    const idLow = base({ id: 'a' });
    for (const order of [
      [early, idLow],
      [idLow, early],
    ]) {
      expect(run(order).lines[0]?.promotionId).toBe('z');
    }
  });

  it('un cupón no aplica sin su código (ni "por si acaso") y un código desconocido = UNKNOWN', () => {
    const coupon = base({ id: 'c', code: 'BIENVENIDO10' });
    expect(run([coupon]).lines[0]?.promotionId).toBeNull();
    expect(run([coupon]).coupon).toBe('NONE');
    expect(run([coupon], { couponCode: 'bienvenido10' })).toMatchObject({ coupon: 'APPLIED' });
    expect(run([coupon], { couponCode: 'OTRO' }).coupon).toBe('UNKNOWN');
    // Inactivo o vencido: misma salida que desconocido (sin enumeración).
    expect(run([{ ...coupon, active: false }], { couponCode: 'BIENVENIDO10' }).coupon).toBe(
      'UNKNOWN',
    );
    expect(
      run([{ ...coupon, endsAt: '2026-11-01T06:00:00Z' }], { couponCode: 'BIENVENIDO10' }).coupon,
    ).toBe('UNKNOWN');
  });

  it('cupón + automática: no se apilan; gana el de mayor ahorro', () => {
    const auto = base({ id: 'auto', value: '30.00' });
    const coupon = base({ id: 'c', code: 'X1X', value: '10.00' });
    const r = run([auto, coupon], { couponCode: 'X1X' });
    expect(r.lines[0]?.promotionId).toBe('auto');
    expect(r.coupon).toBe('NOT_APPLIED');
  });

  it('rechazos: estado, horario, sucursal, dine_in_only, producto y sin ahorro', () => {
    const reasons = (p: EvaluatorPromotion, extra: object = {}) =>
      run([p], extra).rejected.map((x) => x.reason);
    expect(reasons(base({ active: false }))).toEqual(['INACTIVE']);
    expect(reasons(base({ endsAt: '2026-11-11T20:00:00Z' }))).toEqual(['EXPIRED']);
    expect(reasons(base({ startsAt: '2026-12-01T06:00:00Z' }))).toEqual(['NOT_STARTED']);
    expect(reasons(base({ schedule: [slot(1, '15:00', '18:00')] }))).toEqual(['OUT_OF_SCHEDULE']);
    expect(reasons(base({ branchIds: ['sucursal-2'] }))).toEqual(['BRANCH_NOT_IN_SCOPE']);
    expect(reasons(base({ dineInOnly: true }))).toEqual(['DINE_IN_ONLY']);
    expect(reasons(base({ dineInOnly: true }), { mode: 'delivery' })).toEqual(['DINE_IN_ONLY']);
    expect(run([base({ dineInOnly: true })], { mode: 'dine_in' }).lines[0]?.promotionId).toBe('a');
    expect(reasons(base({ productIds: ['otro'] }))).toEqual(['PRODUCT_NOT_IN_SCOPE']);
    expect(
      evaluatePromotions({
        at: now,
        branchId: 'sucursal-1',
        mode: 'pickup',
        lines: [{ productId: 'p1', unitPrice: '0.01', quantity: 1 }],
        promotions: [base({ value: '1.00' })],
      }).rejected.map((x) => x.reason),
    ).toEqual(['NO_SAVING']);
  });

  it('líneas distintas pueden llevar promociones distintas', () => {
    const r = evaluatePromotions({
      at: now,
      branchId: 'sucursal-1',
      mode: 'pickup',
      couponCode: 'C1',
      lines: [
        { productId: 'p1', unitPrice: '85.00', quantity: 1 },
        { productId: 'p2', unitPrice: '40.00', quantity: 1 },
      ],
      promotions: [
        base({ id: 'happy', productIds: ['p2'], value: '25.00' }),
        base({ id: 'cup', code: 'C1', productIds: ['p1'], value: '10.00' }),
      ],
    });
    expect(r.lines.map((l) => l.promotionId)).toEqual(['cup', 'happy']);
    expect(r.lines.map((l) => l.discount)).toEqual(['8.50', '10.00']);
  });
});
