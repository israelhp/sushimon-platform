import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminModifierGroupSummary } from '@/lib/data-access/models';
import {
  addableGroups,
  canAddMoreGroups,
  emptyGroupForm,
  groupToForm,
  modifierServerError,
  newOptionRow,
  ruleText,
  sameIds,
  toCreateGroupRequest,
  toUpdateGroupRequest,
  validateGroupForm,
} from './modifiers-view';

const err = (status: number, code?: string, details?: string[]) =>
  new ApiError(status, 'x', 'mensaje del servidor', undefined, details, code);

const summary: AdminModifierGroupSummary = {
  id: 'g1',
  name: 'Extras',
  minSelect: 0,
  maxSelect: 3,
  required: false,
  active: true,
  optionCount: 4,
  activeOptionCount: 3,
  productCount: 2,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
};

describe('F12 formulario de grupos', () => {
  it('valida nombre, enteros y la relación min <= max <= 20', () => {
    expect(validateGroupForm({ ...emptyGroupForm(), name: 'Ok' }, 'create')).toEqual({});
    expect(validateGroupForm(emptyGroupForm(), 'create').name).toBeDefined();
    expect(
      validateGroupForm({ ...emptyGroupForm(), name: 'a'.repeat(81) }, 'create').name,
    ).toBeDefined();
    for (const [min, max] of [
      ['2', '1'],
      ['0', '0'],
      ['0', '21'],
      ['x', '1'],
      ['-1', '1'],
      ['1.5', '2'],
    ]) {
      const e = validateGroupForm(
        { ...emptyGroupForm(), name: 'Ok', minSelect: min!, maxSelect: max! },
        'edit',
      );
      expect(e.minSelect ?? e.maxSelect, `${min}-${max}`).toBeDefined();
    }
  });

  it('opciones iniciales: nombre, precio, repetidos (case-insensitive) y mínimo alcanzable solo si el grupo queda activo', () => {
    const base = { ...emptyGroupForm(), name: 'Ok', minSelect: '2', maxSelect: '2' };
    expect(
      validateGroupForm({ ...base, options: [newOptionRow('A')] }, 'create').minSelect,
    ).toMatch(/supera las opciones/);
    expect(
      validateGroupForm({ ...base, active: false, options: [newOptionRow('A')] }, 'create'),
    ).toEqual({});
    expect(
      validateGroupForm({ ...base, options: [newOptionRow('A'), newOptionRow('a')] }, 'create')
        .options,
    ).toMatch(/repetido/);
    expect(
      validateGroupForm({ ...base, options: [newOptionRow('A', '10000')] }, 'create').options,
    ).toMatch(/precio extra/);
    expect(validateGroupForm({ ...base, options: [newOptionRow('')] }, 'create').options).toMatch(
      /Opción 1/,
    );
    const many = Array.from({ length: 31 }, (_, i) => newOptionRow(`O${i}`));
    expect(
      validateGroupForm({ ...base, minSelect: '0', maxSelect: '1', options: many }, 'create')
        .options,
    ).toMatch(/Máximo 30/);
  });

  it('arma la solicitud de alta (precio canónico) y el PATCH solo con lo que cambió', () => {
    const form = {
      ...emptyGroupForm(),
      name: '  Término  ',
      minSelect: '1',
      maxSelect: '1',
      options: [newOptionRow('Medio', '2,5'), newOptionRow('Bien cocido', '')],
    };
    expect(toCreateGroupRequest(form)).toEqual({
      name: 'Término',
      minSelect: 1,
      maxSelect: 1,
      active: true,
      options: [
        { name: 'Medio', extraPrice: '2.50' },
        { name: 'Bien cocido', extraPrice: '0.00' },
      ],
    });
    expect(toCreateGroupRequest({ ...form, options: [] })).not.toHaveProperty('options');
    expect(toUpdateGroupRequest(groupToForm(summary), summary)).toBeNull();
    expect(
      toUpdateGroupRequest({ ...groupToForm(summary), maxSelect: '4', name: 'Extras+' }, summary),
    ).toEqual({ name: 'Extras+', maxSelect: 4 });
  });

  it('texto de regla y utilidades de asociación', () => {
    expect(ruleText(1, 1)).toBe('Elige 1');
    expect(ruleText(0, 3)).toBe('Elige hasta 3');
    expect(ruleText(2, 4)).toBe('Elige de 2 a 4');
    const all = [
      { id: 'a', active: true },
      { id: 'b', active: false },
      { id: 'c', active: true },
    ];
    expect(addableGroups(all, ['a']).map((g) => g.id)).toEqual(['c']);
    expect(canAddMoreGroups(Array.from({ length: 9 }, String))).toBe(true);
    expect(canAddMoreGroups(Array.from({ length: 10 }, String))).toBe(false);
    expect(sameIds(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});

describe('F12 errores del servidor: se ramifica por code, nunca por message', () => {
  it('mapea cada code de negocio', () => {
    expect(modifierServerError(err(409, 'MODIFIER_GROUP_NAME_TAKEN'))).toMatchObject({
      kind: 'groupNameTaken',
      fields: { name: expect.any(String) },
    });
    expect(modifierServerError(err(409, 'MODIFIER_NAME_TAKEN'))).toMatchObject({
      kind: 'optionNameTaken',
    });
    expect(modifierServerError(err(422, 'MODIFIER_LIMITS_INVALID'))).toMatchObject({
      kind: 'limitsInvalid',
      fields: { minSelect: expect.any(String) },
    });
    expect(modifierServerError(err(422, 'MODIFIER_GROUP_UNSATISFIABLE')).message).toMatch(
      /menos opciones activas que su mínimo/,
    );
    expect(modifierServerError(err(422, 'MODIFIER_LIMIT_REACHED')).message).toMatch(
      /30 opciones por grupo y 10 grupos/,
    );
    expect(modifierServerError(err(422, 'MODIFIER_REORDER_MISMATCH'))).toMatchObject({
      kind: 'reorderMismatch',
      reload: true,
    });
    expect(modifierServerError(err(422, 'MODIFIER_GROUP_INVALID'))).toMatchObject({
      kind: 'groupInvalid',
      reload: true,
    });
    for (const code of ['MODIFIER_GROUP_NOT_FOUND', 'MODIFIER_NOT_FOUND', 'PRODUCT_NOT_FOUND']) {
      expect(modifierServerError(err(404, code))).toMatchObject({ kind: 'notFound', reload: true });
    }
    expect(modifierServerError(err(503, 'MODIFIERS_BUSY'))).toMatchObject({
      kind: 'busy',
      message: 'Hay otra edición en curso. Espera un momento y reintenta.',
    });
  });

  it('sin code: 400 con detalles, 401, 403, 404 genérico y errores no HTTP', () => {
    expect(modifierServerError(err(400, undefined, ['name: obligatorio'])).message).toMatch(
      /name: obligatorio/,
    );
    expect(modifierServerError(err(401)).kind).toBe('unauthorized');
    expect(modifierServerError(err(403)).kind).toBe('forbidden');
    expect(modifierServerError(err(404))).toMatchObject({ kind: 'notFound', reload: true });
    expect(modifierServerError(new Error('boom'))).toMatchObject({
      kind: 'other',
      message: 'boom',
    });
    // El texto del servidor NO decide: un 409 con otro code no se confunde con nombre repetido.
    expect(modifierServerError(err(409, 'OTRA_COSA')).kind).toBe('other');
  });
});
