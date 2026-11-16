import {
  assertBranchShape,
  assertPeriod,
  assertProductShape,
  assertValue,
  canonicalValue,
  createdAudit,
  diffDraft,
  normalizeCode,
  normalizeDescription,
  normalizeName,
  normalizeSchedule,
  parseInstantField,
  productViolations,
  validateDraft,
  type PromotionDraft,
} from './promotion-policy.js';
import { touches, covers } from './promotion-views.js';

const info = (e: unknown) => {
  const x = e as { getStatus?: () => number; getResponse?: () => unknown };
  const body = (x.getResponse?.() ?? {}) as {
    code?: string;
    violations?: { path: string; code: string }[];
  };
  return { status: x.getStatus?.(), code: body.code, violations: body.violations };
};
const fail = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return info(e);
  }
  throw new Error('no lanzó');
};

const draft = (over: Partial<PromotionDraft> = {}): PromotionDraft => ({
  code: null,
  name: 'Happy Hour',
  description: null,
  kind: 'PERCENT',
  value: '15.00',
  startsAt: new Date('2026-01-01T00:00:00Z'),
  endsAt: new Date('2026-12-31T00:00:00Z'),
  dineInOnly: false,
  active: true,
  branchScope: 'ALL',
  branchIds: [],
  productScope: 'ALL',
  productIds: [],
  schedule: [],
  ...over,
});

describe('valor (D3)', () => {
  it('PERCENT > 100 => 422 PROMOTION_VALUE_INVALID; 100.00 y 0.01 válidos', () => {
    expect(fail(() => assertValue('PERCENT', '100.01'))).toMatchObject({
      status: 422,
      code: 'PROMOTION_VALUE_INVALID',
    });
    expect(() => assertValue('PERCENT', '100.00')).not.toThrow();
    expect(() => assertValue('PERCENT', '0.01')).not.toThrow();
  });
  it('0.00 => 422 en ambos tipos (monto negativo no pasa el patrón: 400)', () => {
    for (const kind of ['PERCENT', 'FIXED_AMOUNT'] as const) {
      expect(fail(() => assertValue(kind, '0.00'))).toMatchObject({ status: 422 });
    }
    expect(fail(() => assertValue('FIXED_AMOUNT', '-5.00'))).toMatchObject({ status: 400 });
  });
  it('FIXED_AMOUNT: hasta 999999.99', () => {
    expect(() => assertValue('FIXED_AMOUNT', '999999.99')).not.toThrow();
  });
});

describe('periodo y fechas', () => {
  it('endsAt <= startsAt => 422 PROMOTION_PERIOD_INVALID', () => {
    const a = new Date('2026-01-01T00:00:00Z');
    expect(fail(() => assertPeriod(a, a))).toMatchObject({
      status: 422,
      code: 'PROMOTION_PERIOD_INVALID',
    });
    expect(fail(() => assertPeriod(a, new Date(a.getTime() - 1)))).toMatchObject({ status: 422 });
    expect(() => assertPeriod(a, new Date(a.getTime() + 1000))).not.toThrow();
  });
  it('instante sin zona o inexistente => 400', () => {
    expect(fail(() => parseInstantField('startsAt', '2026-01-01T00:00:00'))).toMatchObject({
      status: 400,
    });
    expect(fail(() => parseInstantField('startsAt', '2026-02-31T00:00:00Z'))).toMatchObject({
      status: 400,
    });
    expect(parseInstantField('startsAt', '2026-01-01T00:00:00-06:00').toISOString()).toBe(
      '2026-01-01T06:00:00.000Z',
    );
  });
});

describe('código, nombre, descripción', () => {
  it('código recortado y en mayúsculas; vacío/null = automática', () => {
    expect(normalizeCode('  verano-10 ')).toBe('VERANO-10');
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
    expect(normalizeCode('   ')).toBeNull();
    expect(fail(() => normalizeCode('a b'))).toMatchObject({ status: 400 });
    expect(fail(() => normalizeCode('ab'))).toMatchObject({ status: 400 });
  });
  it('nombre y descripción', () => {
    expect(normalizeName('  Hola ')).toBe('Hola');
    expect(fail(() => normalizeName('   '))).toMatchObject({ status: 400 });
    expect(normalizeDescription('  ')).toBeNull();
    expect(normalizeDescription(' x ')).toBe('x');
  });
});

describe('horario semanal (T11, T12, T16)', () => {
  const slot = (weekday: number, startsAt: string, endsAt: string) => ({
    weekday,
    startsAt,
    endsAt,
  });

  it('T11: endsAt <= startsAt => SLOT_ENDS_BEFORE_START', () => {
    for (const s of [slot(1, '18:00', '15:00'), slot(1, '10:00', '10:00')]) {
      const r = fail(() => normalizeSchedule([s]));
      expect(r).toMatchObject({ status: 422, code: 'PROMOTION_SCHEDULE_INVALID' });
      expect(r.violations?.[0]).toMatchObject({
        path: 'schedule[0]',
        code: 'SLOT_ENDS_BEFORE_START',
      });
    }
  });
  it('T12: solapados => SLOT_OVERLAP; contiguos válidos', () => {
    const r = fail(() => normalizeSchedule([slot(1, '15:00', '18:00'), slot(1, '17:00', '19:00')]));
    expect(r.violations?.map((v) => v.code)).toContain('SLOT_OVERLAP');
    const ok = normalizeSchedule([slot(1, '18:00', '19:00'), slot(1, '15:00', '18:00')]);
    expect(ok).toEqual([slot(1, '15:00', '18:00'), slot(1, '18:00', '19:00')]);
  });
  it('mismo horario en días distintos no se solapa; 24:00 admitido como fin', () => {
    expect(() =>
      normalizeSchedule([slot(1, '15:00', '18:00'), slot(2, '15:00', '18:00')]),
    ).not.toThrow();
    expect(() =>
      normalizeSchedule([slot(5, '22:00', '24:00'), slot(6, '00:00', '02:00')]),
    ).not.toThrow();
  });
  it('T16: weekday 0/8, 24:00 como inicio o formato "7:5" => 400', () => {
    for (const s of [
      slot(0, '10:00', '11:00'),
      slot(8, '10:00', '11:00'),
      slot(1, '24:00', '24:00'),
      slot(1, '7:5', '8:00'),
    ]) {
      expect(fail(() => normalizeSchedule([s]))).toMatchObject({ status: 400 });
    }
  });
  it('más de 6 tramos por día => SLOT_LIMIT', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      slot(1, `${String(i * 2).padStart(2, '0')}:00`, `${String(i * 2 + 1).padStart(2, '0')}:00`),
    );
    const r = fail(() => normalizeSchedule(many));
    expect(r.violations?.map((v) => v.code)).toContain('SLOT_LIMIT');
  });
  it('más de 42 tramos en total => SLOT_LIMIT', () => {
    const many = Array.from({ length: 43 }, (_, i) =>
      slot(
        (i % 7) + 1,
        `${String(Math.floor(i / 7) * 3).padStart(2, '0')}:00`,
        `${String(Math.floor(i / 7) * 3 + 1).padStart(2, '0')}:00`,
      ),
    );
    expect(fail(() => normalizeSchedule(many)).violations?.map((v) => v.code)).toContain(
      'SLOT_LIMIT',
    );
  });
});

describe('alcance', () => {
  it('forma de sucursales (400): ALL con ids o SELECTED vacío', () => {
    expect(fail(() => assertBranchShape('ALL', ['x']))).toMatchObject({ status: 400 });
    expect(fail(() => assertBranchShape('SELECTED', []))).toMatchObject({ status: 400 });
    expect(() => assertBranchShape('SELECTED', ['x'])).not.toThrow();
    expect(() => assertBranchShape('ALL', [])).not.toThrow();
  });
  it('productos: ALL con ids => 400; SELECTED vacío => 422 PROMOTION_SCOPE_INVALID', () => {
    expect(fail(() => assertProductShape('ALL', ['x']))).toMatchObject({ status: 400 });
    expect(
      fail(() => validateDraft(draft({ productScope: 'SELECTED', productIds: [] }))),
    ).toMatchObject({
      status: 422,
      code: 'PROMOTION_SCOPE_INVALID',
    });
  });
  it('violaciones por productIds[i]', () => {
    expect(productViolations(['a', 'b', 'c'], new Set(['b']))).toEqual([
      { path: 'productIds[0]', code: 'PRODUCT_UNKNOWN', message: 'Producto inexistente' },
      { path: 'productIds[2]', code: 'PRODUCT_UNKNOWN', message: 'Producto inexistente' },
    ]);
  });
  it('touches/covers por alcance', () => {
    const global = { allBranches: true, branchIds: [] };
    const ab = { allBranches: false, branchIds: ['a', 'b'] };
    expect(touches(global, [])).toBe(true);
    expect(touches(ab, [])).toBe(true); // ALL toca a quien tiene alguna sucursal
    expect(touches(ab, ['b', 'z'])).toBe(true);
    expect(touches(ab, ['z'])).toBe(false);
    expect(touches({ allBranches: false, branchIds: [] }, [])).toBe(false);
    expect(covers(global, [])).toBe(true);
    expect(covers(ab, [])).toBe(false); // ALL exige global
    expect(covers(ab, ['a', 'b'])).toBe(true);
    expect(covers(ab, ['a', 'z'])).toBe(false);
  });
});

describe('diff y auditoría', () => {
  it('sin cambios => null', () => {
    expect(diffDraft(draft(), draft())).toBeNull();
    expect(
      diffDraft(
        draft({ branchScope: 'SELECTED', branchIds: ['a', 'b'] }),
        draft({ branchScope: 'SELECTED', branchIds: ['b', 'a'] }),
      ),
    ).toBeNull();
  });
  it('solo registra lo cambiado', () => {
    const d = diffDraft(draft(), draft({ value: '20.00', name: 'Nuevo' }));
    expect(d?.scalars).toEqual({ value: '20.00', name: 'Nuevo' });
    expect(d?.oldValues).toEqual({ value: '15.00', name: 'Happy Hour' });
    expect(d?.newValues).toEqual({ value: '20.00', name: 'Nuevo' });
    expect(d?.branchIds).toBeUndefined();
  });
  it('listas: sucursales como ids, productos como conteos + agregados/quitados, tramos como texto', () => {
    const d = diffDraft(
      draft({ productScope: 'SELECTED', productIds: ['p1', 'p2'] }),
      draft({
        branchScope: 'SELECTED',
        branchIds: ['b1'],
        productScope: 'SELECTED',
        productIds: ['p2', 'p3'],
        schedule: [{ weekday: 1, startsAt: '15:00', endsAt: '18:00' }],
      }),
    );
    expect(d?.newValues).toMatchObject({
      branchScope: 'SELECTED',
      branchIds: ['b1'],
      productCount: 2,
      productIdsAdded: ['p3'],
      schedule: ['1 15:00-18:00'],
      scheduleCount: 1,
    });
    expect(d?.oldValues).toMatchObject({ productIdsRemoved: ['p1'], scheduleCount: 0 });
  });
  it('created: sin datos personales (solo negocio y conteos)', () => {
    const a = createdAudit(draft({ code: 'VERANO', branchScope: 'SELECTED', branchIds: ['b1'] }));
    expect(a).toMatchObject({
      code: 'VERANO',
      kind: 'PERCENT',
      value: '15.00',
      branchCount: 1,
      productCount: 0,
    });
    expect(Object.keys(a).sort()).toEqual(
      [
        'active',
        'branchCount',
        'branchIds',
        'branchScope',
        'code',
        'dineInOnly',
        'endsAt',
        'kind',
        'name',
        'productCount',
        'productScope',
        'scheduleCount',
        'startsAt',
        'value',
      ].sort(),
    );
  });
});

describe('saneado de texto (B5) y valor canónico (B6)', () => {
  it('NUL y controles bidi en name/description => 400; controles se limpian', () => {
    for (const bad of ['a\u0000b', '\u202Egnp.exe', 'x\u2066y']) {
      expect(fail(() => normalizeName(bad))).toMatchObject({ status: 400 });
      expect(fail(() => normalizeDescription(bad))).toMatchObject({ status: 400 });
    }
    expect(normalizeName('  Café\tHappy \n Hour ')).toBe('Café Happy Hour');
    expect(normalizeDescription('línea 1\nlínea 2\u0007')).toBe('línea 1\nlínea 2');
    expect(fail(() => normalizeName('\t\t'))).toMatchObject({ status: 400 });
  });
  it('canonicalValue y diff: "000001.00" sobre "1.00" no cambia nada', () => {
    expect(canonicalValue('000001.00')).toBe('1.00');
    expect(canonicalValue('007.50')).toBe('7.50');
    expect(diffDraft(draft({ value: '1.00' }), draft({ value: '000001.00' }))).toBeNull();
    expect(validateDraft(draft({ value: '000015.00' })).value).toBe('15.00');
    const d = diffDraft(draft({ value: '1.00' }), draft({ value: '0002.00' }));
    expect(d?.scalars.value).toBe('2.00');
  });
});
