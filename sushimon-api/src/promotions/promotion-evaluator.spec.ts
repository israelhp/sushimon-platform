import {
  computeLineDiscount,
  couponPublicOutcome,
  normalizeCouponCode,
  PromotionEvaluationInputError,
  PromotionEvaluator,
  type EvaluatorInput,
  type EvaluatorPromotion,
} from './promotion-evaluator.js';

const TZ = 'America/Guatemala';
const local = (iso: string): Date => new Date(`${iso}-06:00`);
const BRANCH = 'b1';
const P1 = 'p1';
const P2 = 'p2';
const AT = local('2026-11-16T16:00:00'); // lunes 16:00

const promo = (over: Partial<EvaluatorPromotion> & { id: string }): EvaluatorPromotion => ({
  code: null,
  kind: 'PERCENT',
  value: '10.00',
  startsAt: local('2026-01-01T00:00:00'),
  endsAt: local('2027-01-01T00:00:00'),
  dineInOnly: false,
  active: true,
  branchIds: 'ALL',
  productIds: 'ALL',
  schedule: [],
  ...over,
});

const evaluator = new PromotionEvaluator(TZ);
const run = (promotions: EvaluatorPromotion[], over: Partial<EvaluatorInput> = {}) =>
  evaluator.evaluate({
    at: AT,
    branchId: BRANCH,
    mode: 'pickup',
    lines: [{ productId: P1, unitPrice: '85.00', quantity: 2 }],
    promotions,
    ...over,
  });

describe('computeLineDiscount: ejemplos de la spec (D15.8)', () => {
  it('PERCENT 15.00 sobre Q85.00 x 2 = 25.50, final 144.50', () => {
    expect(computeLineDiscount('PERCENT', '15.00', '85.00', 2)).toEqual({
      lineBaseCents: 17000,
      discountCents: 2550,
      finalCents: 14450,
    });
  });
  it('PERCENT 33.33 sobre Q10.01 x 1: 333.63 -> 334 (medio hacia arriba) = 3.34, final 6.67', () => {
    expect(computeLineDiscount('PERCENT', '33.33', '10.01', 1)).toEqual({
      lineBaseCents: 1001,
      discountCents: 334,
      finalCents: 667,
    });
  });
  it('FIXED_AMOUNT 20.00 sobre Q15.00 x 3: min(6000, 4500) = 45.00, final 0.00', () => {
    expect(computeLineDiscount('FIXED_AMOUNT', '20.00', '15.00', 3)).toEqual({
      lineBaseCents: 4500,
      discountCents: 4500,
      finalCents: 0,
    });
  });
  it('redondeo medio hacia arriba exacto en .5 y justo debajo', () => {
    // 10.05 * 1 * 5.00% = 0.5025 -> 1 centavo; 0.10*5% = 0.005 (medio) -> sube a 1
    expect(computeLineDiscount('PERCENT', '5.00', '0.10', 1).discountCents).toBe(1);
    // 0.09 * 5% = 0.0045 -> 0
    expect(computeLineDiscount('PERCENT', '5.00', '0.09', 1).discountCents).toBe(0);
  });
  it('0.1 + 0.2: la aritmética es entera (sin 0.30000000000000004)', () => {
    const r = run([promo({ id: 'a', kind: 'FIXED_AMOUNT', value: '0.10' })], {
      lines: [{ productId: P1, unitPrice: '0.20', quantity: 1 }],
    });
    expect(r.lines[0]).toMatchObject({ discountAmount: '0.10', finalPrice: '0.10' });
    const sum = run([promo({ id: 'a', kind: 'FIXED_AMOUNT', value: '0.10' })], {
      lines: [
        { productId: P1, unitPrice: '0.10', quantity: 1 },
        { productId: P2, unitPrice: '0.20', quantity: 1 },
      ],
    });
    expect(sum.discountTotal).toBe('0.20');
    const pct = run([promo({ id: 'a', kind: 'PERCENT', value: '33.33' })], {
      lines: [{ productId: P1, unitPrice: '0.30', quantity: 1 }],
    });
    expect(pct.lines[0]?.discountAmount).toBe('0.10');
  });
  it('100 % deja la línea en 0.00 y nunca negativa', () => {
    const r = computeLineDiscount('PERCENT', '100.00', '85.00', 3);
    expect(r.finalCents).toBe(0);
    expect(r.discountCents).toBe(25500);
  });
  it('valores en los bordes: precio máximo x 99', () => {
    const r = computeLineDiscount('PERCENT', '99.99', '999999.99', 99);
    expect(r.lineBaseCents).toBe(99_999_999 * 99);
    expect(r.discountCents).toBeLessThanOrEqual(r.lineBaseCents);
    expect(Number.isSafeInteger(r.discountCents)).toBe(true);
  });
  it('rechaza entradas inválidas', () => {
    expect(() => computeLineDiscount('PERCENT', '15.00', '85', 1)).toThrow(
      PromotionEvaluationInputError,
    );
    expect(() => computeLineDiscount('PERCENT', '15.00', '85.00', 0)).toThrow(
      PromotionEvaluationInputError,
    );
    expect(() => computeLineDiscount('PERCENT', '15.00', '85.00', 100)).toThrow(
      PromotionEvaluationInputError,
    );
    expect(() => computeLineDiscount('PERCENT', '15.00', '85.00', 1.5)).toThrow(
      PromotionEvaluationInputError,
    );
    expect(() => computeLineDiscount('PERCENT', '100.01', '85.00', 1)).toThrow(
      PromotionEvaluationInputError,
    );
    expect(() => computeLineDiscount('PERCENT', '0.00', '85.00', 1)).toThrow(
      PromotionEvaluationInputError,
    );
    expect(() => computeLineDiscount('FIXED_AMOUNT', '0.00', '85.00', 1)).toThrow(
      PromotionEvaluationInputError,
    );
  });
});

describe('PromotionEvaluator', () => {
  it('aplica una promoción automática y devuelve cadenas decimales de 2 posiciones', () => {
    const r = run([promo({ id: 'a', value: '15.00' })]);
    expect(r.lines[0]).toMatchObject({
      index: 0,
      applicable: true,
      promotionId: 'a',
      lineBase: '170.00',
      discountAmount: '25.50',
      finalPrice: '144.50',
      reason: 'APPLIED',
    });
    expect(r.discountTotal).toBe('25.50');
    expect(r.at).toBe(AT.toISOString());
    expect(r.internal.rejected).toEqual([]);
    expect(r.internal.coupon).toBeNull();
  });

  it('sin promociones: NO_CANDIDATE y total 0.00', () => {
    const r = run([]);
    expect(r.lines[0]).toMatchObject({
      applicable: false,
      promotionId: null,
      discountAmount: '0.00',
      finalPrice: '170.00',
      reason: 'NO_CANDIDATE',
    });
    expect(r.discountTotal).toBe('0.00');
  });

  describe('compuertas de vigencia', () => {
    it.each([
      ['INACTIVE', { active: false }],
      ['NOT_STARTED', { startsAt: new Date(AT.getTime() + 1000) }],
      ['EXPIRED', { endsAt: new Date(AT.getTime()) }],
      ['OUTSIDE_SCHEDULE', { schedule: [{ weekday: 1, startsAt: '17:00', endsAt: '18:00' }] }],
      ['BRANCH_NOT_ELIGIBLE', { branchIds: ['otra'] }],
      ['DINE_IN_ONLY', { dineInOnly: true }],
      ['CODE_REQUIRED', { code: 'VERANO' }],
    ] as const)('%s', (reason, over) => {
      const r = run([promo({ id: 'a', ...over })]);
      expect(r.lines[0]?.applicable).toBe(false);
      expect(r.internal.rejected).toEqual([{ promotionId: 'a', reason }]);
    });

    it('límites exactos: starts_at inclusivo y ends_at exclusivo', () => {
      expect(run([promo({ id: 'a', startsAt: AT })]).lines[0]?.applicable).toBe(true);
      expect(
        run([promo({ id: 'a', endsAt: new Date(AT.getTime() + 1) })]).lines[0]?.applicable,
      ).toBe(true);
      expect(run([promo({ id: 'a', endsAt: AT })]).lines[0]?.applicable).toBe(false);
    });

    it('Happy Hour: dentro, fuera y límites exactos (lun 15:00-18:00)', () => {
      const hh = promo({
        id: 'hh',
        schedule: [{ weekday: 1, startsAt: '15:00', endsAt: '18:00' }],
      });
      const at = (t: string) => run([hh], { at: local(`2026-11-16T${t}`) }).lines[0]?.applicable;
      expect(at('14:59:59')).toBe(false);
      expect(at('15:00:00')).toBe(true);
      expect(at('17:59:59')).toBe(true);
      expect(at('18:00:00')).toBe(false);
      // mismo horario en otro día de la semana
      expect(run([hh], { at: local('2026-11-17T16:00:00') }).lines[0]?.applicable).toBe(false);
    });

    it('medianoche no admitida como tramo único: se evalúa por día calendario local', () => {
      const split = promo({
        id: 'n',
        schedule: [
          { weekday: 5, startsAt: '22:00', endsAt: '24:00' },
          { weekday: 6, startsAt: '00:00', endsAt: '02:00' },
        ],
      });
      const at = (t: string) => run([split], { at: local(t) }).lines[0]?.applicable;
      expect(at('2026-11-20T23:59:59')).toBe(true);
      expect(at('2026-11-21T00:30:00')).toBe(true);
      expect(at('2026-11-21T02:00:00')).toBe(false);
    });

    it('el día se toma de la hora LOCAL (T5): domingo 21:00 local no es lunes', () => {
      const mon = promo({
        id: 'm',
        schedule: [{ weekday: 1, startsAt: '00:00', endsAt: '24:00' }],
      });
      const r = run([mon], { at: new Date('2026-11-16T03:00:00Z') });
      expect(r.internal.rejected).toEqual([{ promotionId: 'm', reason: 'OUTSIDE_SCHEDULE' }]);
    });
  });

  describe('dine_in_only (D4)', () => {
    const p = promo({ id: 'd', dineInOnly: true });
    it('nunca aplica a pickup ni delivery; solo con mode dine_in', () => {
      expect(run([p], { mode: 'pickup' }).lines[0]?.applicable).toBe(false);
      expect(run([p], { mode: 'delivery' }).lines[0]?.applicable).toBe(false);
      expect(run([p], { mode: 'dine_in' }).lines[0]?.applicable).toBe(true);
    });
  });

  describe('alcance de productos y sucursales', () => {
    it('producto incluido / excluido', () => {
      const p = promo({ id: 'a', productIds: [P2] });
      const r = run([p], {
        lines: [
          { productId: P1, unitPrice: '10.00', quantity: 1 },
          { productId: P2, unitPrice: '10.00', quantity: 1 },
        ],
      });
      expect(r.lines.map((l) => l.applicable)).toEqual([false, true]);
      expect(r.lines[0]?.reason).toBe('NO_CANDIDATE');
    });
    it('NO_ELIGIBLE_LINES cuando ningún producto del carrito está en el alcance', () => {
      const r = run([promo({ id: 'a', productIds: ['otro'] })]);
      expect(r.internal.rejected).toEqual([{ promotionId: 'a', reason: 'NO_ELIGIBLE_LINES' }]);
    });
    it('sucursal incluida / excluida', () => {
      expect(run([promo({ id: 'a', branchIds: [BRANCH] })]).lines[0]?.applicable).toBe(true);
      expect(run([promo({ id: 'a', branchIds: ['x'] })]).lines[0]?.applicable).toBe(false);
    });
    it('precio específico de sucursal: se descuenta el precio recibido (F13), no otro', () => {
      const r = run([promo({ id: 'a', value: '10.00' })], {
        lines: [{ productId: P1, unitPrice: '45.00', quantity: 1 }],
      });
      expect(r.lines[0]?.discountAmount).toBe('4.50');
    });
  });

  describe('tope y NO_SAVING', () => {
    it('descuento mayor que el precio: tope en el precio base (final 0.00, sin negativos)', () => {
      const r = run([promo({ id: 'a', kind: 'FIXED_AMOUNT', value: '500.00' })], {
        lines: [{ productId: P1, unitPrice: '20.00', quantity: 2 }],
      });
      expect(r.lines[0]).toMatchObject({ discountAmount: '40.00', finalPrice: '0.00' });
    });
    it('descuento 0.00 no cuenta como aplicado (NO_SAVING)', () => {
      const r = run([promo({ id: 'a', value: '5.00' })], {
        lines: [{ productId: P1, unitPrice: '0.09', quantity: 1 }],
      });
      expect(r.lines[0]).toMatchObject({ applicable: false, reason: 'NO_CANDIDATE' });
      expect(r.internal.lineReasons).toEqual(['NO_SAVING']);
      expect(r.internal.rejected).toEqual([{ promotionId: 'a', reason: 'NO_SAVING' }]);
    });
  });

  describe('combinación (D15): una promoción por línea, nunca se apilan', () => {
    it('porcentaje + monto: gana el de mayor ahorro y NO se suman', () => {
      const pct = promo({ id: 'pct', value: '10.00' }); // 17.00 sobre 170.00
      const fix = promo({ id: 'fix', kind: 'FIXED_AMOUNT', value: '12.00' }); // 24.00 por 2 u.
      const r = run([pct, fix]);
      expect(r.lines[0]).toMatchObject({ promotionId: 'fix', discountAmount: '24.00' });
      expect(r.discountTotal).toBe('24.00');
      expect(r.internal.rejected).toEqual([{ promotionId: 'pct', reason: 'NOT_BEST_OFFER' }]);
    });
    it('cupón + automática: una sola; gana la de mayor ahorro', () => {
      const auto = promo({ id: 'auto', value: '30.00' });
      const coupon = promo({ id: 'cup', code: 'VERANO', value: '10.00' });
      const r = run([auto, coupon], { couponCode: 'verano' });
      expect(r.lines[0]?.promotionId).toBe('auto');
      expect(r.internal.coupon).toEqual({ status: 'NOT_APPLIED', reason: 'NOT_BEST_OFFER' });
    });
    it('dos automáticas simultáneas: una sola', () => {
      const r = run([promo({ id: 'a', value: '10.00' }), promo({ id: 'b', value: '20.00' })]);
      expect(r.lines[0]).toMatchObject({ promotionId: 'b', discountAmount: '34.00' });
    });
    it('líneas distintas pueden recibir promociones distintas', () => {
      const a = promo({ id: 'a', productIds: [P1], value: '10.00' });
      const b = promo({ id: 'b', productIds: [P2], value: '50.00' });
      const r = run([a, b], {
        lines: [
          { productId: P1, unitPrice: '10.00', quantity: 1 },
          { productId: P2, unitPrice: '10.00', quantity: 1 },
        ],
      });
      expect(r.lines.map((l) => l.promotionId)).toEqual(['a', 'b']);
      expect(r.discountTotal).toBe('6.00');
    });
    it('desempate: con código, luego vence antes, luego id menor; independiente del orden de entrada', () => {
      const base = { value: '10.00' };
      const withCode = promo({ id: 'z', code: 'CUP', ...base });
      const earlier = promo({ id: 'y', endsAt: local('2026-12-01T00:00:00'), ...base });
      const later = promo({ id: 'a', endsAt: local('2027-06-01T00:00:00'), ...base });
      const sameEnd1 = promo({ id: 'b', ...base });
      const sameEnd2 = promo({ id: 'c', ...base });
      const winner = (list: EvaluatorPromotion[], coupon?: string) =>
        run(list, { couponCode: coupon ?? null }).lines[0]?.promotionId;
      expect(winner([later, earlier, withCode], 'CUP')).toBe('z');
      expect(winner([withCode, later, earlier], 'CUP')).toBe('z');
      expect(winner([later, earlier])).toBe('y');
      expect(winner([earlier, later])).toBe('y');
      expect(winner([sameEnd2, sameEnd1])).toBe('b');
      expect(winner([sameEnd1, sameEnd2])).toBe('b');
    });
    it('propiedad: el resultado no depende del orden de entrada (todas las permutaciones)', () => {
      const list = [
        promo({ id: 'a', value: '10.00' }),
        promo({ id: 'b', kind: 'FIXED_AMOUNT', value: '8.50' }),
        promo({ id: 'c', code: 'X1', value: '10.00' }),
        promo({ id: 'd', value: '10.00', endsAt: local('2026-12-01T00:00:00') }),
      ];
      const perms = (xs: EvaluatorPromotion[]): EvaluatorPromotion[][] =>
        xs.length <= 1
          ? [xs]
          : xs.flatMap((x, i) =>
              perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
            );
      const results = perms(list).map((p) => JSON.stringify(run(p, { couponCode: 'x1' })));
      expect(new Set(results).size).toBe(1);
    });
  });

  describe('cupones', () => {
    const coupon = promo({ id: 'cup', code: 'VERANO10', value: '10.00' });
    it('válido con mayúsculas/espacios', () => {
      for (const code of ['VERANO10', 'verano10', '  Verano10  ']) {
        const r = run([coupon], { couponCode: code });
        expect(r.internal.coupon).toEqual({ status: 'APPLIED' });
        expect(r.lines[0]?.promotionId).toBe('cup');
      }
    });
    it('promoción con código jamás es candidata sin el código o con otro', () => {
      expect(run([coupon]).lines[0]?.applicable).toBe(false);
      expect(run([coupon], { couponCode: 'OTRO' }).lines[0]?.applicable).toBe(false);
      expect(run([coupon]).internal.coupon).toBeNull();
    });
    it('cupón desconocido, inactivo, no iniciado, vencido o fuera de horario: misma salida UNKNOWN', () => {
      const unknown = run([coupon], { couponCode: 'NOEXISTE' }).internal.coupon;
      expect(unknown).toEqual({ status: 'UNKNOWN' });
      const variants: Partial<EvaluatorPromotion>[] = [
        { active: false },
        { startsAt: new Date(AT.getTime() + 60_000) },
        { endsAt: new Date(AT.getTime() - 60_000) },
        { schedule: [{ weekday: 2, startsAt: '00:00', endsAt: '24:00' }] },
      ];
      for (const v of variants) {
        const r = run([{ ...coupon, ...v }], { couponCode: 'VERANO10' });
        expect(r.internal.coupon).toEqual(unknown);
        expect(r.lines[0]?.applicable).toBe(false);
      }
    });
    it('cupón vigente pero de otra sucursal / solo en el local: NOT_APPLIED con motivo interno', () => {
      expect(
        run([{ ...coupon, branchIds: ['x'] }], { couponCode: 'VERANO10' }).internal.coupon,
      ).toEqual({
        status: 'NOT_APPLIED',
        reason: 'BRANCH_NOT_ELIGIBLE',
      });
      expect(
        run([{ ...coupon, dineInOnly: true }], { couponCode: 'VERANO10' }).internal.coupon,
      ).toEqual({
        status: 'NOT_APPLIED',
        reason: 'DINE_IN_ONLY',
      });
    });
    it('un cupón inválido no impide las automáticas', () => {
      const r = run([promo({ id: 'auto' }), coupon], { couponCode: 'NOEXISTE' });
      expect(r.lines[0]?.promotionId).toBe('auto');
      expect(r.internal.coupon).toEqual({ status: 'UNKNOWN' });
    });
    it('normalizeCouponCode', () => {
      expect(normalizeCouponCode('  ab-1 ')).toBe('AB-1');
      expect(normalizeCouponCode('   ')).toBeNull();
      expect(normalizeCouponCode(undefined)).toBeNull();
      expect(() => normalizeCouponCode(5)).toThrow(PromotionEvaluationInputError);
    });
  });

  describe('validación de entradas (error de programación, no se enmascara)', () => {
    it.each([
      ['precio fuera de patrón', { lines: [{ productId: P1, unitPrice: '85', quantity: 1 }] }],
      ['precio con coma', { lines: [{ productId: P1, unitPrice: '85,00', quantity: 1 }] }],
      ['cantidad 0', { lines: [{ productId: P1, unitPrice: '85.00', quantity: 0 }] }],
      ['cantidad 100', { lines: [{ productId: P1, unitPrice: '85.00', quantity: 100 }] }],
      ['cantidad decimal', { lines: [{ productId: P1, unitPrice: '85.00', quantity: 1.5 }] }],
      ['fecha inválida', { at: new Date('x') }],
      [
        'más de 100 líneas',
        {
          lines: Array.from({ length: 101 }, () => ({
            productId: P1,
            unitPrice: '1.00',
            quantity: 1,
          })),
        },
      ],
    ] as const)('%s', (_name, over) => {
      expect(() => run([], over as Partial<EvaluatorInput>)).toThrow(PromotionEvaluationInputError);
    });
    it('100 líneas es válido', () => {
      const lines = Array.from({ length: 100 }, (_, i) => ({
        productId: `p${i}`,
        unitPrice: '1.00',
        quantity: 1,
      }));
      expect(run([promo({ id: 'a' })], { lines }).lines).toHaveLength(100);
    });
    it('promoción mal formada (valor) lanza', () => {
      expect(() => run([promo({ id: 'a', value: '1e2' })])).toThrow(PromotionEvaluationInputError);
    });
  });

  describe('cupón: vista pública idéntica (REQUISITO DE SEGURIDAD de F19, M2)', () => {
    const coupon = promo({ id: 'cup', code: 'VERANO10', value: '10.00' });
    const publicView = (promotions: EvaluatorPromotion[], over: Partial<EvaluatorInput> = {}) => {
      const r = run(promotions, { couponCode: 'VERANO10', ...over });
      return JSON.stringify({ coupon: r.coupon, lines: r.lines, total: r.discountTotal });
    };

    it('inexistente, vencido, inactivo, de otra sucursal, solo en el local y sin ahorro: respuesta idéntica', () => {
      const unknownFor = (over: Partial<EvaluatorInput> = {}) => {
        const r = run([], { couponCode: 'VERANO10', ...over });
        return JSON.stringify({ coupon: r.coupon, lines: r.lines, total: r.discountTotal });
      };
      const unknown = unknownFor();
      const cases: Record<string, string> = {
        vencido: publicView([{ ...coupon, endsAt: new Date(AT.getTime() - 1000) }]),
        inactivo: publicView([{ ...coupon, active: false }]),
        'otra sucursal': publicView([{ ...coupon, branchIds: ['otra'] }]),
        'solo en el local': publicView([{ ...coupon, dineInOnly: true }]),
        'fuera de horario': publicView([
          { ...coupon, schedule: [{ weekday: 2, startsAt: '00:00', endsAt: '24:00' }] },
        ]),
      };
      for (const [name, json] of Object.entries(cases)) expect(json, name).toBe(unknown);
      // sin ahorro (mismo carrito de céntimos que el código inexistente)
      const cents = { lines: [{ productId: P1, unitPrice: '0.01', quantity: 1 }] };
      expect(publicView([coupon], cents)).toBe(unknownFor(cents));
      expect((JSON.parse(unknown) as { coupon: unknown }).coupon).toEqual({
        status: 'NOT_APPLIED',
      });
    });

    it('el resultado público no contiene motivos ni UNKNOWN; el detalle queda en `internal`', () => {
      const r = run([{ ...coupon, branchIds: ['otra'] }], { couponCode: 'VERANO10' });
      expect(JSON.stringify(r.coupon)).not.toMatch(/UNKNOWN|reason|BRANCH/);
      expect(r.internal.coupon).toEqual({ status: 'NOT_APPLIED', reason: 'BRANCH_NOT_ELIGIBLE' });
      const none = run([], { couponCode: 'X1' });
      expect(none.coupon).toEqual({ status: 'NOT_APPLIED' });
      expect(none.internal.coupon).toEqual({ status: 'UNKNOWN' });
      expect(run([coupon], { couponCode: 'VERANO10' }).coupon).toEqual({ status: 'APPLIED' });
    });

    it('couponPublicOutcome', () => {
      expect(couponPublicOutcome(null)).toBeNull();
      expect(couponPublicOutcome({ status: 'UNKNOWN' })).toEqual({ status: 'NOT_APPLIED' });
      expect(couponPublicOutcome({ status: 'NOT_APPLIED', reason: 'NO_SAVING' })).toEqual({
        status: 'NOT_APPLIED',
      });
      expect(couponPublicOutcome({ status: 'APPLIED' })).toEqual({ status: 'APPLIED' });
    });
  });

  describe('propiedades (generador determinista)', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const money = () => `${rnd(1000)}.${String(rnd(100)).padStart(2, '0')}`;

    it('descuento <= base de la línea, final >= 0, final + descuento = base, total = suma', () => {
      for (let i = 0; i < 400; i += 1) {
        const kind = rnd(2) === 0 ? 'PERCENT' : 'FIXED_AMOUNT';
        const value =
          kind === 'PERCENT' ? `${rnd(100) + 1}.${String(rnd(100)).padStart(2, '0')}` : money();
        if (value === '0.00') continue;
        const unit = money();
        const qty = rnd(99) + 1;
        const r = computeLineDiscount(kind, value, unit, qty);
        expect(r.discountCents).toBeGreaterThanOrEqual(0);
        expect(r.discountCents).toBeLessThanOrEqual(r.lineBaseCents);
        expect(r.finalCents).toBeGreaterThanOrEqual(0);
        expect(r.finalCents + r.discountCents).toBe(r.lineBaseCents);
        expect(Number.isInteger(r.discountCents)).toBe(true);
      }
    });
    it('discountTotal = suma de descuentos de las líneas', () => {
      for (let i = 0; i < 100; i += 1) {
        const lines = Array.from({ length: rnd(8) + 1 }, (_, k) => ({
          productId: `p${k}`,
          unitPrice: money(),
          quantity: rnd(99) + 1,
        }));
        const r = run(
          [
            promo({ id: 'a', value: '12.50' }),
            promo({ id: 'b', kind: 'FIXED_AMOUNT', value: '3.00' }),
          ],
          { lines },
        );
        const cents = (s: string) => Number(s.replace('.', ''));
        expect(cents(r.discountTotal)).toBe(
          r.lines.reduce((s, l) => s + cents(l.discountAmount), 0),
        );
        for (const l of r.lines)
          expect(cents(l.finalPrice)).toBe(cents(l.lineBase) - cents(l.discountAmount));
      }
    });
  });
});
