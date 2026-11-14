import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminBranch } from '@/lib/data-access/models';
import {
  branchServerError,
  branchStats,
  branchToForm,
  coordinatesLabel,
  emptyBranchForm,
  firstBranchError,
  hasActiveFilters,
  normalizeBranchCode,
  pageCount,
  radiusLabel,
  toAdminFilters,
  toCreateRequest,
  toUpdateRequest,
  validateBranchForm,
  validateStatusReason,
  DEFAULT_BRANCH_LIST,
} from './branches-view';

const branch: AdminBranch = {
  id: 'b1',
  code: 'zona-10',
  name: 'Zona 10',
  address: 'Avenida Reforma 1-50',
  phone: '+502 2222-3333',
  latitude: 14.6,
  longitude: -90.5,
  active: true,
  createdAt: '2026-01-15T18:00:00.000Z',
};

const valid = {
  ...emptyBranchForm(),
  code: 'Zona-11',
  name: ' Zona 11 ',
  address: ' 6a avenida 10-50 ',
};

describe('formulario de sucursal', () => {
  it('normaliza el código como la API (recorta y minúsculas)', () => {
    expect(normalizeBranchCode('  Cayala-2 ')).toBe('cayala-2');
  });

  it('acepta datos válidos; teléfono y coordenadas son opcionales', () => {
    expect(validateBranchForm(valid)).toEqual({});
    expect(toCreateRequest(valid)).toEqual({
      code: 'zona-11',
      name: 'Zona 11',
      address: '6a avenida 10-50',
      phone: null,
      latitude: null,
      longitude: null,
      active: true,
    });
  });

  it('valida el código (largo, caracteres, guiones)', () => {
    for (const code of ['', 'a', '-ab', 'ab-', 'a--b', 'a_b', 'x'.repeat(41)]) {
      expect(validateBranchForm({ ...valid, code }).code, code).toBeTruthy();
    }
    expect(validateBranchForm({ ...valid, code: 'ab' }).code).toBeUndefined();
  });

  it('en edición no valida el código (inmutable)', () => {
    expect(validateBranchForm({ ...valid, code: '' }, 'edit').code).toBeUndefined();
  });

  it('exige nombre y dirección y respeta los máximos', () => {
    const errors = validateBranchForm({ ...valid, name: ' ', address: '' });
    expect(Object.keys(errors)).toEqual(['name', 'address']);
    expect(validateBranchForm({ ...valid, name: 'n'.repeat(101) }).name).toBeTruthy();
    expect(validateBranchForm({ ...valid, address: 'a'.repeat(301) }).address).toBeTruthy();
  });

  it('valida el teléfono (7 a 15 dígitos, caracteres permitidos)', () => {
    expect(validateBranchForm({ ...valid, phone: '+502 (2222) 3333' }).phone).toBeUndefined();
    expect(validateBranchForm({ ...valid, phone: '12345' }).phone).toBeTruthy();
    expect(validateBranchForm({ ...valid, phone: '1234567890123456' }).phone).toBeTruthy();
    expect(validateBranchForm({ ...valid, phone: '2222-ABCD' }).phone).toBeTruthy();
  });

  it('coordenadas: ambas o ninguna, dentro de rango', () => {
    expect(validateBranchForm({ ...valid, latitude: '14.6', longitude: '-90.5' })).toEqual({});
    expect(validateBranchForm({ ...valid, latitude: '14.6' }).longitude).toBeTruthy();
    expect(validateBranchForm({ ...valid, longitude: '-90.5' }).latitude).toBeTruthy();
    expect(validateBranchForm({ ...valid, latitude: '91', longitude: '0' }).latitude).toBeTruthy();
    expect(
      validateBranchForm({ ...valid, latitude: '0', longitude: '181' }).longitude,
    ).toBeTruthy();
    expect(validateBranchForm({ ...valid, latitude: 'x', longitude: '0' }).latitude).toBeTruthy();
  });

  it('el primer campo con error sigue el orden de pantalla', () => {
    expect(firstBranchError(validateBranchForm(emptyBranchForm()))).toBe('code');
    expect(firstBranchError({})).toBeUndefined();
  });

  it('el PATCH envía solo los campos modificados y nunca code/active', () => {
    expect(toUpdateRequest(branchToForm(branch), branch)).toBeNull();
    const patch = toUpdateRequest(
      { ...branchToForm(branch), name: 'Zona 10 Reforma', code: 'otro', phone: '' },
      branch,
    );
    expect(patch).toEqual({ name: 'Zona 10 Reforma', phone: null });
    expect(patch).not.toHaveProperty('code');
    expect(patch).not.toHaveProperty('active');
  });
});

describe('estado administrativo', () => {
  it('desactivar exige motivo; activar no', () => {
    expect(validateStatusReason('', false)).toBeTruthy();
    expect(validateStatusReason('   ', false)).toBeTruthy();
    expect(validateStatusReason('Remodelación', false)).toBe('');
    expect(validateStatusReason('', true)).toBe('');
    expect(validateStatusReason('x'.repeat(201), true)).toBeTruthy();
  });
});

describe('errores del servidor', () => {
  it('409 señala el campo código', () => {
    const e = branchServerError(new ApiError(409, 'conflict', 'dup'));
    expect(e.fields.code).toMatch(/Ya existe/);
  });

  it('400 con detalles asigna los que nombran un campo y lista el resto', () => {
    const e = branchServerError(
      new ApiError(400, 'bad_request', 'Datos inválidos', undefined, [
        'phone: de 7 a 15 dígitos',
        'otra cosa',
      ]),
    );
    expect(e.fields.phone).toBe('de 7 a 15 dígitos');
    expect(e.message).toContain('otra cosa');
  });

  it('403 y 404 tienen mensajes propios; otros errores pasan tal cual', () => {
    expect(branchServerError(new ApiError(403, 'forbidden', 'x')).message).toMatch(/permiso/);
    expect(branchServerError(new ApiError(404, 'not_found', 'x')).message).toMatch(/alcance/);
    expect(branchServerError(new ApiError(500, 'server_error', 'Falló')).message).toBe('Falló');
  });
});

describe('filtros', () => {
  it('traduce el estado a `active` y fija el tamaño de página', () => {
    expect(toAdminFilters(DEFAULT_BRANCH_LIST)).toMatchObject({
      q: undefined,
      active: undefined,
      sort: 'name',
      order: 'asc',
      page: 1,
    });
    expect(toAdminFilters({ ...DEFAULT_BRANCH_LIST, status: 'inactive', q: ' zo ' })).toMatchObject(
      { active: false, q: 'zo' },
    );
    expect(toAdminFilters({ ...DEFAULT_BRANCH_LIST, status: 'active' }).active).toBe(true);
    expect(hasActiveFilters(DEFAULT_BRANCH_LIST)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_BRANCH_LIST, status: 'active' })).toBe(true);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25, 12)).toBe(3);
  });

  it('coordenadas: sin valores ficticios', () => {
    expect(coordinatesLabel({ latitude: null, longitude: null })).toBe('Sin coordenadas');
    expect(coordinatesLabel(branch)).toBe('14.6, -90.5');
  });
});

describe('operación simulada', () => {
  it('radio y estadísticas', () => {
    expect(radiusLabel({ radiusKm: 4 })).toBe('Radio 4 km');
    expect(radiusLabel({ radiusKm: 0 })).toBe('—');
    expect(branchStats('1', [{ branchId: '1', orders: 3, sales: 90 }], undefined)).toEqual({
      orders: 3,
      sales: 90,
      active: 0,
    });
  });
});
