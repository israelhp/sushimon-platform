import { describe, expect, it } from 'vitest';
import {
  areLimitsValid,
  centsToExtraPrice,
  compactSelections,
  extraPriceToCents,
  isOfferable,
  isRequiredGroup,
  isSatisfiable,
  modifierNameKey,
  normalizeModifierName,
  parseExtraPriceInput,
  selectionRule,
  sumExtraCents,
  validateSelection,
  type RuleGroup,
} from './modifier-rules';

const opt = (id: string, extraPrice = '0.00', active?: boolean) => ({
  id,
  name: id.toUpperCase(),
  extraPrice,
  ...(active === undefined ? {} : { active }),
});

const extras: RuleGroup = {
  id: 'g-extras',
  minSelect: 0,
  maxSelect: 2,
  options: [opt('queso', '5.00'), opt('aguacate', '4.00'), opt('salsa', '3.00')],
};
const salsa: RuleGroup = {
  id: 'g-salsa',
  minSelect: 1,
  maxSelect: 1,
  options: [opt('anguila'), opt('mayo')],
};

describe('F12 precios extra (céntimos enteros)', () => {
  it('convierte cadenas decimales a céntimos y valida forma y rango', () => {
    expect(extraPriceToCents('0.00')).toBe(0);
    expect(extraPriceToCents('5.00')).toBe(500);
    expect(extraPriceToCents('9999.99')).toBe(999_999);
    for (const bad of ['10000.00', '5', '5.0', '-1.00', '5,00', 'abc', '', '1e2']) {
      expect(extraPriceToCents(bad), bad).toBeNull();
    }
    expect(centsToExtraPrice(1234)).toBe('12.34');
    expect(centsToExtraPrice(5)).toBe('0.05');
  });

  it('suma exacta: 0.10 + 0.20 = 0.30 (sin coma flotante)', () => {
    expect(sumExtraCents(['0.10', '0.20'])).toBe(30);
    expect(centsToExtraPrice(sumExtraCents(['0.10', '0.20']))).toBe('0.30');
    expect(sumExtraCents(['9999.99', '9999.99', '0.02'])).toBe(2_000_000);
  });

  it('acepta coma o punto al escribir; vacío = 0.00; rechaza lo que el servidor rechaza', () => {
    expect(parseExtraPriceInput('')).toBe('0.00');
    expect(parseExtraPriceInput(' 5 ')).toBe('5.00');
    expect(parseExtraPriceInput('4,5')).toBe('4.50');
    expect(parseExtraPriceInput('0')).toBe('0.00');
    expect(parseExtraPriceInput('9999.99')).toBe('9999.99');
    for (const bad of ['10000', '1.234', '-1', 'a', '1,2,3']) {
      expect(parseExtraPriceInput(bad), bad).toBeNull();
    }
  });
});

describe('F12 límites y regla de elección', () => {
  it('min <= max, max 1–20, enteros', () => {
    expect(areLimitsValid(0, 1)).toBe(true);
    expect(areLimitsValid(1, 1)).toBe(true);
    expect(areLimitsValid(0, 20)).toBe(true);
    expect(areLimitsValid(2, 1)).toBe(false);
    expect(areLimitsValid(0, 0)).toBe(false);
    expect(areLimitsValid(0, 21)).toBe(false);
    expect(areLimitsValid(-1, 3)).toBe(false);
    expect(areLimitsValid(0.5, 3)).toBe(false);
  });

  it('«obligatorio» es derivado (min >= 1) y la satisfacibilidad solo aplica a grupos activos', () => {
    expect(isRequiredGroup(0)).toBe(false);
    expect(isRequiredGroup(1)).toBe(true);
    expect(isSatisfiable({ active: true, minSelect: 2, activeOptionCount: 1 })).toBe(false);
    expect(isSatisfiable({ active: true, minSelect: 2, activeOptionCount: 2 })).toBe(true);
    expect(isSatisfiable({ active: false, minSelect: 2, activeOptionCount: 0 })).toBe(true);
  });

  it('regla: exactamente, hasta y entre', () => {
    expect(selectionRule(1, 1)).toEqual({ kind: 'exactly', count: 1 });
    expect(selectionRule(2, 2)).toEqual({ kind: 'exactly', count: 2 });
    expect(selectionRule(0, 3)).toEqual({ kind: 'upTo', max: 3 });
    expect(selectionRule(0, 1)).toEqual({ kind: 'upTo', max: 1 });
    expect(selectionRule(2, 4)).toEqual({ kind: 'between', min: 2, max: 4 });
  });

  it('nombres: normaliza y compara sin distinguir mayúsculas', () => {
    expect(normalizeModifierName('  Queso   crema ')).toBe('Queso crema');
    expect(modifierNameKey('QUESO  Crema')).toBe(modifierNameKey('queso crema'));
  });

  it('ofrecible: activo con al menos max(min, 1) opciones activas', () => {
    expect(isOfferable(extras)).toBe(true);
    expect(isOfferable({ ...extras, active: false })).toBe(false);
    expect(isOfferable({ ...extras, options: [] })).toBe(false);
    expect(
      isOfferable({ ...salsa, minSelect: 2, options: [opt('a'), opt('b', '0.00', false)] }),
    ).toBe(false);
  });
});

describe('F12 validateSelection (mismas reglas que el servidor)', () => {
  it('selección válida: suma extras en céntimos y devuelve nombre/precio de los grupos', () => {
    const r = validateSelection(
      [extras, salsa],
      [
        { groupId: 'g-salsa', modifierIds: ['mayo'] },
        { groupId: 'g-extras', modifierIds: ['queso', 'aguacate'] },
      ],
    );
    expect(r.ok).toBe(true);
    expect(r.extraCents).toBe(900);
    expect(r.items.map((i) => i.modifierId)).toEqual(['mayo', 'queso', 'aguacate']);
    expect(r.items[1]).toMatchObject({ name: 'QUESO', extraPrice: '5.00' });
  });

  it('MODIFIER_REQUIRED: grupo obligatorio ausente o con menos de min', () => {
    expect(validateSelection([extras, salsa], []).violations).toEqual([
      { path: 'groups/g-salsa', code: 'MODIFIER_REQUIRED' },
    ]);
    expect(
      validateSelection([salsa], [{ groupId: 'g-salsa', modifierIds: [] }]).violations,
    ).toEqual([{ path: 'selections[0]', code: 'MODIFIER_REQUIRED' }]);
    const two: RuleGroup = {
      ...salsa,
      minSelect: 2,
      maxSelect: 3,
      options: [opt('a'), opt('b'), opt('c')],
    };
    expect(
      validateSelection([two], [{ groupId: 'g-salsa', modifierIds: ['a'] }]).violations[0]?.code,
    ).toBe('MODIFIER_REQUIRED');
  });

  it('MODIFIER_TOO_MANY: más opciones que max', () => {
    const r = validateSelection(
      [extras],
      [{ groupId: 'g-extras', modifierIds: ['queso', 'aguacate', 'salsa'] }],
    );
    expect(r.violations).toEqual([
      { path: 'selections[0].modifierIds', code: 'MODIFIER_TOO_MANY' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('MODIFIER_NOT_IN_GROUP, MODIFIER_INACTIVE y MODIFIER_DUPLICATED por opción', () => {
    const withInactive: RuleGroup = {
      ...extras,
      maxSelect: 4,
      options: [...extras.options, opt('crunch', '6.00', false)],
    };
    const r = validateSelection(
      [withInactive],
      [{ groupId: 'g-extras', modifierIds: ['ajeno', 'crunch', 'queso', 'queso'] }],
    );
    expect(r.violations).toEqual([
      { path: 'selections[0].modifierIds[0]', code: 'MODIFIER_NOT_IN_GROUP' },
      { path: 'selections[0].modifierIds[1]', code: 'MODIFIER_INACTIVE' },
      { path: 'selections[0].modifierIds[3]', code: 'MODIFIER_DUPLICATED' },
    ]);
    // Lo inválido no suma: solo cuenta `queso`.
    expect(r.extraCents).toBe(500);
  });

  it('MODIFIER_DUPLICATED por grupo repetido; grupo ajeno o no ofrecible => GROUP_NOT_ON_PRODUCT', () => {
    const dup = validateSelection(
      [extras],
      [
        { groupId: 'g-extras', modifierIds: ['queso'] },
        { groupId: 'g-extras', modifierIds: ['aguacate'] },
      ],
    );
    expect(dup.violations).toEqual([{ path: 'selections[1]', code: 'MODIFIER_DUPLICATED' }]);
    const foreign = validateSelection([extras], [{ groupId: 'otro', modifierIds: ['x'] }]);
    expect(foreign.violations).toEqual([
      { path: 'selections[0].groupId', code: 'MODIFIER_GROUP_NOT_ON_PRODUCT' },
    ]);
    const unofferable = validateSelection(
      [{ ...extras, options: [] }],
      [{ groupId: 'g-extras', modifierIds: ['queso'] }],
    );
    expect(unofferable.violations[0]?.code).toBe('MODIFIER_GROUP_NOT_ON_PRODUCT');
  });

  it('reporta TODAS las violaciones, no solo la primera', () => {
    const r = validateSelection(
      [extras, salsa],
      [{ groupId: 'g-extras', modifierIds: ['queso', 'aguacate', 'salsa'] }],
    );
    expect(r.violations.map((v) => v.code).sort()).toEqual([
      'MODIFIER_REQUIRED',
      'MODIFIER_TOO_MANY',
    ]);
  });

  it('selección vacía es válida si ningún grupo es obligatorio', () => {
    expect(validateSelection([extras], []).ok).toBe(true);
    expect(validateSelection([extras], []).extraCents).toBe(0);
  });

  it('compactSelections omite grupos sin elección y copia los arreglos', () => {
    const source = [
      { groupId: 'a', modifierIds: ['x'] },
      { groupId: 'b', modifierIds: [] },
    ];
    const out = compactSelections(source);
    expect(out).toEqual([{ groupId: 'a', modifierIds: ['x'] }]);
    expect(out[0]?.modifierIds).not.toBe(source[0]?.modifierIds);
  });
});
