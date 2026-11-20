import { BadRequestException } from '@nestjs/common';
import {
  changedFieldsOf,
  collapseName,
  maskPhone,
  nameKeyOf,
  normalizeCreate,
  normalizePlate,
  normalizeReason,
  normalizeSearch,
  normalizeUpdate,
  operationalStateOf,
} from './rider-policy.js';
import type { RiderRecord } from './riders.types.js';

const BRANCH = '11111111-1111-4111-8111-111111111111';
const base = { branchId: BRANCH, fullName: 'Luis', phone: '+50255501122' };

describe('Normalización de motoristas (R01)', () => {
  it('nombre: NFC, recortado y espacios colapsados', () => {
    expect(collapseName('  José \t  Pérez  ')).toBe('José Pérez');
    // «é» descompuesta (e + U+0301) vuelve a su forma compuesta
    expect(collapseName('José')).toBe('José');
  });

  it('name_key: sin acentos, minúsculas y espacios colapsados', () => {
    expect(nameKeyOf('  JOSÉ   Muñoz ')).toBe('jose munoz');
    expect(nameKeyOf('ÁÉÍÓÚ')).toBe('aeiou');
  });

  it('alta: normaliza nombre y placa; vehículo y placa opcionales', () => {
    const data = normalizeCreate({
      ...base,
      fullName: '  Ana   María ',
      licensePlate: ' m-123 abc ',
      vehicleType: 'CAR',
    });
    expect(data).toEqual({
      branchId: BRANCH,
      fullName: 'Ana María',
      nameKey: 'ana maria',
      phone: '+50255501122',
      vehicleType: 'CAR',
      licensePlate: 'M123ABC',
    });
    const bare = normalizeCreate(base);
    expect(bare.vehicleType).toBeNull();
    expect(bare.licensePlate).toBeNull();
  });

  it.each(['+50255501122x', '50255501122', '+5025550112', '+502 55501122', '+5025550112233'])(
    'teléfono estricto: %s => 400',
    (phone) => {
      expect(() => normalizeCreate({ ...base, phone })).toThrow(BadRequestException);
    },
  );

  it.each(['A', 'x'.repeat(81), 'a\u0000b', '́́'])('nombre inválido %j => 400', (n) => {
    expect(() => normalizeCreate({ ...base, fullName: n })).toThrow(BadRequestException);
  });

  it('placa: debe cumplir 4–10 alfanuméricos tras normalizar', () => {
    expect(normalizePlate('p 123-abc')).toBe('P123ABC');
    expect(() => normalizePlate('AB')).toThrow(BadRequestException);
    expect(() => normalizePlate('ab_123')).toThrow(BadRequestException);
    expect(() => normalizePlate('---')).toThrow(BadRequestException);
  });

  it('edición: exige al menos un campo y `null` borra vehículo y placa', () => {
    expect(() => normalizeUpdate({ expectedVersion: 1 })).toThrow(BadRequestException);
    const { patch } = normalizeUpdate({
      expectedVersion: 2,
      vehicleType: null,
      licensePlate: null,
    });
    expect(patch).toEqual({ vehicleType: null, licensePlate: null });
  });

  it('búsqueda: sin acentos; vacía => sin filtro', () => {
    expect(normalizeSearch('  MUÑOZ ')).toBe('munoz');
    expect(normalizeSearch('   ')).toBeUndefined();
    expect(normalizeSearch(undefined)).toBeUndefined();
    expect(normalizeReason('  ')).toBeNull();
    expect(normalizeReason(' baja ')).toBe('baja');
  });

  it('teléfono enmascarado y estado operativo', () => {
    expect(maskPhone('+50255505678')).toBe('+502****5678');
    expect(operationalStateOf(false, 'UNAVAILABLE', false)).toBe('INACTIVE');
    expect(operationalStateOf(true, 'UNAVAILABLE', false)).toBe('UNAVAILABLE');
    expect(operationalStateOf(true, 'AVAILABLE', true)).toBe('BUSY');
    expect(operationalStateOf(true, 'AVAILABLE', false)).toBe('AVAILABLE');
    // un inactivo nunca es BUSY aunque lo reporten ocupado
    expect(operationalStateOf(false, 'UNAVAILABLE', true)).toBe('INACTIVE');
  });

  it('campos cambiados: solo diferencias reales y nunca valores', () => {
    const cur = {
      fullName: 'Luis',
      phone: '+50255501122',
      vehicleType: 'CAR',
      licensePlate: 'ABC123',
    } as RiderRecord;
    expect(
      changedFieldsOf(cur, { fullName: 'Luis', phone: '+50255501122', vehicleType: 'CAR' }),
    ).toEqual([]);
    expect(changedFieldsOf(cur, { phone: '+50255509999', licensePlate: null })).toEqual([
      'phone',
      'licensePlate',
    ]);
  });
});
