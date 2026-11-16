import {
  assertLimits,
  assertReachable,
  buildOfferGroups,
  diffGroup,
  diffOption,
  formatCents,
  normalizeCreateGroup,
  normalizeExtraPrice,
  normalizeGroupIds,
  normalizeName,
  normalizeUpdateGroup,
  normalizeUpdateOption,
  parseExtraCents,
  sumPrices,
  toPublicGroups,
  validateSelections,
} from './modifier-policy.js';
import type { GroupRow, OfferRow, OptionRow } from './modifiers.types.js';

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

describe('precio extra (céntimos enteros)', () => {
  it('formas válidas y rango 0.00-9999.99', () => {
    expect(normalizeExtraPrice('0.00')).toBe('0.00');
    expect(normalizeExtraPrice('9999.99')).toBe('9999.99');
    expect(parseExtraCents('12.05')).toBe(1205);
    expect(formatCents(5)).toBe('0.05');
  });
  it.each(['10000.00', '5', '5.0', '-1.00', '1e2', ' 5.00', '5,00', '', 5, null])(
    'rechaza %j con 400',
    (raw) => {
      expect(status(thrown(() => parseExtraCents(raw)))).toBe(400);
    },
  );
  it('suma exacta: 0.10 + 0.20 = 0.30 y sumas grandes', () => {
    expect(sumPrices(['0.10', '0.20'])).toBe('0.30');
    expect(sumPrices([])).toBe('0.00');
    expect(sumPrices(Array(30).fill('9999.99'))).toBe('299999.70');
  });
});

describe('nombre', () => {
  it('normaliza espacios y rechaza vacío/largo/no texto', () => {
    expect(normalizeName('  Salsa   soya ')).toBe('Salsa soya');
    expect(normalizeName('Sal\u200Bsa')).toBe('Salsa');
    expect(normalizeName('\u202Eatoy\u2066 x\u200F')).toBe('atoy x');
    for (const bad of ['', '   ', '\u200B\u202E', 'x'.repeat(81), 3]) {
      expect(status(thrown(() => normalizeName(bad)))).toBe(400);
    }
  });
});

describe('límites', () => {
  it.each([
    [0, 1],
    [0, 20],
    [1, 1],
    [3, 5],
  ])('válidos %i-%i', (min, max) => {
    expect(thrown(() => assertLimits(min, max))).toBeNull();
  });
  it.each([
    [2, 1],
    [0, 0],
    [0, 21],
    [-1, 1],
    [0.5, 1],
  ])('inválidos %s-%s => 422 MODIFIER_LIMITS_INVALID', (min, max) => {
    const e = thrown(() => assertLimits(min, max));
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('MODIFIER_LIMITS_INVALID');
  });
  it('grupo activo con min > opciones activas es inalcanzable; inactivo no tiene restricción', () => {
    expect(code(thrown(() => assertReachable(true, 2, 1)))).toBe('MODIFIER_LIMITS_INVALID');
    expect(thrown(() => assertReachable(false, 5, 0))).toBeNull();
    expect(thrown(() => assertReachable(true, 1, 1))).toBeNull();
  });
});

describe('normalizeCreateGroup', () => {
  it('defaults, opciones con precio por defecto y nombres duplicados (sin mayúsculas) => 409', () => {
    const n = normalizeCreateGroup({ name: ' Salsas ', options: [{ name: 'Soya' }] });
    expect(n).toMatchObject({ name: 'Salsas', minSelect: 0, maxSelect: 1, active: true });
    expect(n.options).toEqual([{ name: 'Soya', extraPrice: '0.00' }]);
    const e = thrown(() =>
      normalizeCreateGroup({ name: 'A', options: [{ name: 'Soya' }, { name: ' SOYA ' }] }),
    );
    expect(status(e)).toBe(409);
    expect(code(e)).toBe('MODIFIER_NAME_TAKEN');
  });
  it('31 opciones => 422 MODIFIER_LIMIT_REACHED', () => {
    const options = Array.from({ length: 31 }, (_, i) => ({ name: `o${i}` }));
    expect(code(thrown(() => normalizeCreateGroup({ name: 'A', options })))).toBe(
      'MODIFIER_LIMIT_REACHED',
    );
  });
});

describe('normalizeUpdate*', () => {
  it('cuerpo vacío => 400', () => {
    expect(status(thrown(() => normalizeUpdateGroup({})))).toBe(400);
    expect(status(thrown(() => normalizeUpdateOption({})))).toBe(400);
  });
  it('rangos individuales => 422', () => {
    expect(code(thrown(() => normalizeUpdateGroup({ maxSelect: 21 })))).toBe(
      'MODIFIER_LIMITS_INVALID',
    );
    expect(code(thrown(() => normalizeUpdateGroup({ minSelect: -1 })))).toBe(
      'MODIFIER_LIMITS_INVALID',
    );
  });
});

const T = new Date('2026-01-01T00:00:00Z');
const group: GroupRow = {
  id: 'g',
  name: 'Salsas',
  minSelect: 0,
  maxSelect: 2,
  active: true,
  createdAt: T,
  updatedAt: T,
};
const option: OptionRow = {
  id: 'o',
  groupId: 'g',
  name: 'Soya',
  extraPrice: '1.00',
  active: true,
  sortOrder: 0,
  createdAt: T,
  updatedAt: T,
};

describe('diff', () => {
  it('sin cambios reales => null; active no entra en oldValues/newValues', () => {
    expect(diffGroup(group, { name: 'Salsas', active: true })).toBeNull();
    expect(diffOption(option, { extraPrice: '1.00' })).toBeNull();
    const d = diffGroup(group, { name: 'Otras', active: false });
    expect(d?.changes).toEqual({ name: 'Otras', active: false });
    expect(d?.oldValues).toEqual({ name: 'Salsas' });
    expect(diffGroup(group, { active: false })?.hasFieldChanges).toBe(false);
    expect(diffOption(option, { extraPrice: '2.00' })?.newValues).toEqual({ extraPrice: '2.00' });
  });
});

describe('normalizeGroupIds', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  it('duplicados => 422 MODIFIER_GROUP_INVALID con path; > 10 => LIMIT_REACHED', () => {
    const e = thrown(() => normalizeGroupIds([id(1), id(2), id(1)]));
    expect(code(e)).toBe('MODIFIER_GROUP_INVALID');
    expect(
      (e as { response: { violations: { path: string }[] } }).response.violations[0]?.path,
    ).toBe('groupIds[2]');
    const many = Array.from(
      { length: 11 },
      (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
    );
    expect(code(thrown(() => normalizeGroupIds(many)))).toBe('MODIFIER_LIMIT_REACHED');
    expect(normalizeGroupIds([])).toEqual([]);
  });
});

describe('ofrecible', () => {
  const row = (over: Partial<OfferRow>): OfferRow => ({
    groupId: 'g1',
    groupName: 'G',
    minSelect: 0,
    maxSelect: 1,
    groupActive: true,
    modifierId: 'm1',
    modifierName: 'M',
    extraPrice: '1.00',
    modifierActive: true,
    ...over,
  });
  it('omite inactivos, sin opciones activas e insatisfacibles; required = min >= 1', () => {
    const groups = buildOfferGroups([
      row({}),
      row({ modifierId: 'm2', modifierActive: false }),
      row({ groupId: 'g2', groupActive: false }),
      row({ groupId: 'g3', modifierId: null }),
      row({ groupId: 'g4', minSelect: 2, maxSelect: 2 }),
      row({ groupId: 'g5', minSelect: 1, modifierId: 'm9' }),
      { ...row({}), groupId: null },
    ]);
    const pub = toPublicGroups(groups);
    expect(pub.map((g) => g.id)).toEqual(['g1', 'g5']);
    expect(pub[0]?.options.map((o) => o.id)).toEqual(['m1']);
    expect(pub[1]?.required).toBe(true);
    expect(pub[0]?.required).toBe(false);
  });
});

describe('validateSelections: tope de violaciones', () => {
  it('corta en 50', () => {
    const groups = Array.from({ length: 10 }, (_, i) => ({
      id: `g${i}`,
      name: `G${i}`,
      minSelect: 0,
      maxSelect: 1,
      active: true,
      options: [{ id: `o${i}`, name: 'O', extraPrice: '0.00', active: true }],
    }));
    const foreign = Array.from({ length: 20 }, (_, j) => `x${j}`);
    const selections = groups.map((g) => ({ groupId: g.id, modifierIds: foreign }));
    const e = thrown(() => validateSelections(groups, selections)) as {
      response: { violations: unknown[] };
    };
    expect(e.response.violations).toHaveLength(50);
  });
});
