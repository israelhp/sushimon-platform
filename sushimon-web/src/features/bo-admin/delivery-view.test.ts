import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminDeliveryZone } from '@/lib/data-access/models';
import {
  DEFAULT_ZONE_LIST,
  emptyZoneForm,
  hasZoneFilters,
  pedidosyaIntegrationView,
  toCreateRequest,
  toUpdateRequest,
  toZoneFilters,
  validateZoneForm,
  zoneLabelText,
  zonePageCount,
  zoneServerError,
  zoneToForm,
} from './delivery-view';

const zone: AdminDeliveryZone = {
  id: 'z1',
  branchId: 'sucursal-1',
  municipalityId: 'mun-1',
  municipalityName: 'Mixco',
  departmentId: 'dep-1',
  departmentName: 'Guatemala',
  zoneLabel: 'Zona 10',
  baseFee: '15.00',
  currency: 'GTQ',
  active: true,
  version: 3,
  createdAt: '2026-02-01T15:00:00.000Z',
  updatedAt: '2026-02-01T15:00:00.000Z',
};

describe('formulario de zonas', () => {
  it('alta: exige sucursal, municipio y tarifa; la etiqueta es opcional', () => {
    const errors = validateZoneForm(emptyZoneForm(), 'create');
    expect(Object.keys(errors).sort()).toEqual(['baseFee', 'branchId', 'municipalityId']);
    expect(
      validateZoneForm({ ...emptyZoneForm('s1'), municipalityId: 'm', baseFee: '15' }, 'create'),
    ).toEqual({});
  });

  it('la tarifa es texto decimal: rechaza 3 decimales, negativos y el tope', () => {
    const base = { ...emptyZoneForm('s1'), municipalityId: 'm' };
    for (const bad of ['15.001', '-1', '100000', 'abc']) {
      expect(validateZoneForm({ ...base, baseFee: bad }, 'create').baseFee, bad).toBeTruthy();
    }
    expect(validateZoneForm({ ...base, baseFee: '0' }, 'create')).toEqual({}); // envío gratis
  });

  it('la etiqueta: máximo 60 y sin caracteres de control', () => {
    const base = { ...emptyZoneForm('s1'), municipalityId: 'm', baseFee: '1' };
    expect(validateZoneForm({ ...base, zoneLabel: 'x'.repeat(61) }, 'create').zoneLabel).toMatch(
      /60/,
    );
    expect(validateZoneForm({ ...base, zoneLabel: 'a\u0007b' }, 'create').zoneLabel).toMatch(
      /control/,
    );
  });

  it('crea con etiqueta normalizada (o null = general), tarifa a 2 decimales y sin number', () => {
    const base = { ...emptyZoneForm('s1'), municipalityId: 'm' };
    expect(toCreateRequest({ ...base, zoneLabel: '  Zona   10 ', baseFee: '12.5' })).toEqual({
      branchId: 's1',
      municipalityId: 'm',
      zoneLabel: 'Zona 10',
      baseFee: '12.50',
      active: true,
    });
    expect(
      toCreateRequest({ ...base, zoneLabel: '  ', baseFee: '0', active: false }),
    ).toMatchObject({
      zoneLabel: null,
      baseFee: '0.00',
      active: false,
    });
  });

  it('edita solo lo que cambió y reenvía expectedVersion; sin cambios => null', () => {
    const form = zoneToForm(zone);
    expect(toUpdateRequest(form, zone)).toBeNull();
    expect(toUpdateRequest({ ...form, baseFee: '15' }, zone)).toBeNull(); // 15 == 15.00
    expect(toUpdateRequest({ ...form, baseFee: '18.5' }, zone)).toEqual({
      expectedVersion: 3,
      baseFee: '18.50',
    });
    expect(toUpdateRequest({ ...form, zoneLabel: '' }, zone)).toEqual({
      expectedVersion: 3,
      zoneLabel: null,
    });
    expect(zoneLabelText({ zoneLabel: null })).toBe('Todo el municipio');
  });
});

describe('listado', () => {
  it('traduce el estado a filtros del servidor; con sucursal fija ignora el filtro de sucursal', () => {
    expect(
      toZoneFilters(
        { ...DEFAULT_ZONE_LIST, status: 'inactive', q: ' zona ', branchId: 'b2' },
        'b1',
      ),
    ).toMatchObject({ branchId: 'b1', active: false, q: 'zona', page: 1, pageSize: 20 });
    expect(toZoneFilters(DEFAULT_ZONE_LIST).active).toBeUndefined();
    expect(hasZoneFilters(DEFAULT_ZONE_LIST)).toBe(false);
    expect(hasZoneFilters({ ...DEFAULT_ZONE_LIST, branchId: 'b2' }, 'b1')).toBe(false);
    expect(hasZoneFilters({ ...DEFAULT_ZONE_LIST, departmentId: 'd' })).toBe(true);
    expect(zonePageCount(0)).toBe(1);
    expect(zonePageCount(41)).toBe(3);
  });
});

const apiError = (status: number, businessCode?: string, details?: string[]) =>
  new ApiError(status, 'x', 'msg', undefined, details, businessCode);

describe('errores del servidor', () => {
  it('409 duplicado: mensaje claro y error en el campo zona', () => {
    const e = zoneServerError(apiError(409, 'DELIVERY_ZONE_DUPLICATE'));
    expect(e.kind).toBe('duplicate');
    expect(e.fields.zoneLabel).toBeTruthy();
    expect(e.reload).toBe(false);
  });

  it('409 versión: pide recargar y conserva lo escrito', () => {
    const e = zoneServerError(apiError(409, 'DELIVERY_ZONE_VERSION_CONFLICT'));
    expect(e).toMatchObject({ kind: 'versionConflict', reload: true });
    expect(e.message).toMatch(/Otra persona modificó/);
  });

  it('422 municipio, 400 por campo, 403 y 404', () => {
    expect(
      zoneServerError(apiError(422, 'MUNICIPALITY_NOT_FOUND')).fields.municipalityId,
    ).toBeTruthy();
    expect(
      zoneServerError(apiError(400, undefined, ['baseFee: debe ser decimal'])).fields.baseFee,
    ).toBe('debe ser decimal');
    expect(zoneServerError(apiError(403)).kind).toBe('forbidden');
    expect(zoneServerError(apiError(404))).toMatchObject({ kind: 'notFound', reload: true });
    expect(zoneServerError(new Error('boom')).message).toBe('boom');
  });
});

describe('estado de la integración de PedidosYa', () => {
  it('BLOCKED_EXTERNAL = pendiente de documentación y credenciales; jamás «conectado»', () => {
    const v = pedidosyaIntegrationView('BLOCKED_EXTERNAL');
    expect(v.label).toBe('Integración pendiente de documentación y credenciales');
    expect(v.simulated).toBe(false);
    expect(`${v.label} ${v.detail}`).not.toMatch(/conectad|operativ[ao]|activ[ao]/i);
  });

  it('MOCK = simulación; LIVE o un valor futuro se trata como pendiente (no se asume conexión)', () => {
    expect(pedidosyaIntegrationView('MOCK')).toMatchObject({
      label: 'Simulación',
      simulated: true,
    });
    expect(pedidosyaIntegrationView('LIVE').label).toMatch(/pendiente/);
    expect(pedidosyaIntegrationView('FUTURE' as never).label).toMatch(/pendiente/);
  });
});
