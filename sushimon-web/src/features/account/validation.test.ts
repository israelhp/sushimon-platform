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
    expect(validateProfile({ fullName: 'Ab', phone: '12', email: 'x' })).toEqual({
      fullName: 'validation.name',
      phone: 'validation.phone',
      email: 'validation.email',
    });
    expect(
      hasErrors(validateProfile({ fullName: 'Ana López', phone: '5555-6789', email: 'a@b.co' })),
    ).toBe(false);
  });
});

describe('validateAddress', () => {
  const base = { ...EMPTY_ADDRESS, line: '6a avenida 12-34', zone: '10' };

  it('exige zona solo en la Ciudad de Guatemala y la valida contra las inexistentes', () => {
    expect(validateAddress(base, [])).toEqual({});
    expect(validateAddress({ ...base, zone: '' }, [])).toEqual({ zone: 'validation.zone' });
    expect(validateAddress({ ...base, zone: '20' }, [20])).toEqual({
      zone: 'mode.errZoneInvalid',
    });
    expect(validateAddress({ ...base, municipality: 'Mixco', zone: '' }, [])).toEqual({});
  });

  it('exige departamento, municipio y una dirección exacta de 5 caracteres', () => {
    expect(validateAddress({ ...base, department: '', municipality: '', line: 'abc' }, [])).toEqual(
      {
        department: 'validation.department',
        municipality: 'validation.municipality',
        line: 'validation.address',
      },
    );
  });
});
