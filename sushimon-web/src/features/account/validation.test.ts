import { describe, expect, it } from 'vitest';
import {
  EMPTY_ADDRESS,
  hasErrors,
  isValidEmail,
  isValidPhone,
  validateAddress,
  validateProfile,
} from './validation';

describe('teléfono y correo', () => {
  it('acepta 8 dígitos con o sin prefijo 502 y rechaza el resto', () => {
    expect(isValidPhone('5555-1234')).toBe(true);
    expect(isValidPhone('+502 5555 1234')).toBe(true);
    expect(isValidPhone('555-123')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });

  it('valida el formato del correo', () => {
    expect(isValidEmail(' cliente@ejemplo.com ')).toBe(true);
    expect(isValidEmail('cliente@ejemplo')).toBe(false);
    expect(isValidEmail('sin arroba.com')).toBe(false);
  });
});

describe('validateProfile', () => {
  it('devuelve claves de mensaje por campo', () => {
    expect(validateProfile({ fullName: 'Ab', phone: '12' })).toEqual({
      fullName: 'validation.name',
      phone: 'validation.phone',
    });
    expect(hasErrors(validateProfile({ fullName: 'Ana López', phone: '5555-6789' }))).toBe(false);
  });
});

describe('validateAddress', () => {
  const base = {
    ...EMPTY_ADDRESS,
    municipalityId: 'mun-guatemala',
    line: '6a avenida 12-34',
    zone: '10',
  };

  it('exige zona «N» de 1 a 25 en la Ciudad de Guatemala (sin excluir 20, 22 ni 23)', () => {
    expect(validateAddress(base)).toEqual({});
    expect(validateAddress({ ...base, zone: '1' })).toEqual({});
    expect(validateAddress({ ...base, zone: '25' })).toEqual({});
    expect(validateAddress({ ...base, zone: '20' })).toEqual({});
    expect(validateAddress({ ...base, zone: '' })).toEqual({ zone: 'validation.zone' });
    expect(validateAddress({ ...base, zone: '  ' })).toEqual({ zone: 'validation.zone' });
    for (const zone of ['0', '26', '1.5', 'abc', 'Zona 10', '-3']) {
      expect(validateAddress({ ...base, zone })).toEqual({ zone: 'validation.zoneInvalid' });
    }
  });

  it('fuera de la ciudad la zona es opcional y de texto libre (≤ 60)', () => {
    const mixco = { ...base, municipality: 'Mixco', municipalityId: 'mun-mixco' };
    expect(validateAddress({ ...mixco, zone: '' })).toEqual({});
    expect(validateAddress({ ...mixco, zone: 'Colonia Lomas del Norte' })).toEqual({});
    expect(validateAddress({ ...mixco, zone: 'x'.repeat(60) })).toEqual({});
    expect(validateAddress({ ...mixco, zone: 'x'.repeat(61) })).toEqual({
      zone: 'validation.zoneTooLong',
    });
    // Otro departamento con municipio «Guatemala» no es la ciudad.
    expect(
      validateAddress({ ...base, department: 'Escuintla', municipality: 'Guatemala', zone: '' }),
    ).toEqual({});
  });

  it('exige departamento, municipio y una dirección exacta de 5 caracteres', () => {
    expect(validateAddress({ ...base, department: '', municipality: '', line: 'abc' })).toEqual({
      department: 'validation.department',
      municipality: 'validation.municipality',
      line: 'validation.address',
    });
  });
});
