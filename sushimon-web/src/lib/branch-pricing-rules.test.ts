import { describe, expect, it } from 'vitest';
import {
  checkOverrideBody,
  effectivePrice,
  isOffered,
  overrideDiffersFromBase,
  overrideToInput,
  parseOverrideInput,
} from './branch-pricing-rules';

describe('precio efectivo y oferta', () => {
  it('el override gana sobre el base; sin override se usa el base (cadenas canónicas)', () => {
    expect(effectivePrice('85.00', '90.50')).toBe('90.50');
    expect(effectivePrice('85.00', null)).toBe('85.00');
    // Un override igual al base es válido y se conserva (congela el precio de la sucursal).
    expect(effectivePrice('85.00', '85.00')).toBe('85.00');
  });
  it('ofertado = visible Y disponible', () => {
    expect(isOffered(true, true)).toBe(true);
    expect(isOffered(true, false)).toBe(false);
    expect(isOffered(false, true)).toBe(false);
  });
  it('informa si el override difiere del base', () => {
    expect(overrideDiffersFromBase('85.00', '90.00')).toBe(true);
    expect(overrideDiffersFromBase('85.00', '85.00')).toBe(false);
    expect(overrideDiffersFromBase('85.00', null)).toBe(false);
    expect(overrideToInput('85.00')).toBe('85.00');
    expect(overrideToInput(null)).toBe('');
  });
});

describe('parseOverrideInput (texto del campo → cadena con céntimos enteros)', () => {
  it('normaliza a 2 decimales sin usar flotantes', () => {
    expect(parseOverrideInput('85')).toEqual({ ok: true, price: '85.00' });
    expect(parseOverrideInput('85.5')).toEqual({ ok: true, price: '85.50' });
    expect(parseOverrideInput(' 85,05 ')).toEqual({ ok: true, price: '85.05' });
    expect(parseOverrideInput('0.10')).toEqual({ ok: true, price: '0.10' });
    expect(parseOverrideInput('999999.99')).toEqual({ ok: true, price: '999999.99' });
  });
  it('vacío = sin override (null)', () => {
    expect(parseOverrideInput('')).toEqual({ ok: true, price: null });
    expect(parseOverrideInput('   ')).toEqual({ ok: true, price: null });
  });
  it('cero es «zero»; la forma inválida es «invalid»', () => {
    expect(parseOverrideInput('0')).toEqual({ ok: false, reason: 'zero' });
    expect(parseOverrideInput('0.00')).toEqual({ ok: false, reason: 'zero' });
    for (const bad of ['-5', '1e3', '85.123', '1000000', 'abc', '1.2.3', 'Q85']) {
      expect(parseOverrideInput(bad), bad).toEqual({ ok: false, reason: 'invalid' });
    }
  });
});

describe('checkOverrideBody (D9: 400 de forma vs 422 de regla)', () => {
  it('null y cadenas bien formadas son válidas', () => {
    expect(checkOverrideBody(null)).toBe('ok');
    expect(checkOverrideBody('85.00')).toBe('ok');
    expect(checkOverrideBody('999999.99')).toBe('ok');
  });
  it('"0.00" está bien formada pero es regla de negocio', () => {
    expect(checkOverrideBody('0.00')).toBe('zero');
  });
  it('cualquier otra forma (número, sin decimales, > máximo, negativo) es de forma', () => {
    for (const bad of [85, '85', '85.5', '1000000.00', '-1.00', '', 'x', undefined, {}]) {
      expect(checkOverrideBody(bad), String(bad)).toBe('shape');
    }
  });
});
