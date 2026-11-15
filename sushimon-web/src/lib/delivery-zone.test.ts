import { describe, expect, it } from 'vitest';
import {
  coverageZoneOf,
  formatMoneyGtq,
  normalizeMoney,
  normalizeZoneLabel,
  sameMoney,
  zoneKeyOf,
  zoneLabelOf,
} from './delivery-zone';

describe('normalización de la etiqueta de zona (D6, igual que la API)', () => {
  const label = (raw: string | null | undefined) => {
    const r = normalizeZoneLabel(raw);
    if (!r.ok) throw new Error(r.reason);
    return r.label;
  };

  it('recorta y colapsa cualquier espacio Unicode a uno, conservando mayúsculas y acentos', () => {
    expect(label('  Zona   10 ')).toBe('Zona 10');
    expect(label('Colonia\t El Álamo')).toBe('Colonia El Álamo');
  });

  it('unifica NFC/NFD', () => {
    expect(label('Café')).toBe('Café');
  });

  it('vacío, blanco y null significan cobertura general (null)', () => {
    expect(label(null)).toBeNull();
    expect(label(undefined)).toBeNull();
    expect(label('   ')).toBeNull();
  });

  it('rechaza caracteres de control y más de 60 caracteres', () => {
    expect(normalizeZoneLabel('Zo\u0000na')).toEqual({ ok: false, reason: 'control' });
    expect(normalizeZoneLabel('x'.repeat(61))).toEqual({ ok: false, reason: 'tooLong' });
    expect(normalizeZoneLabel('x'.repeat(60)).ok).toBe(true);
  });

  it('la clave ignora mayúsculas y acentos pero NO unifica «Zona 4», «4» y «04»', () => {
    expect(zoneKeyOf('Álamo')).toBe(zoneKeyOf('alamo'));
    expect(zoneKeyOf('ZONA 10')).toBe('zona 10');
    expect(zoneKeyOf(null)).toBe('');
    expect(new Set([zoneKeyOf('Zona 4'), zoneKeyOf('4'), zoneKeyOf('04')]).size).toBe(3);
    expect(zoneKeyOf('́')).toBeNull(); // solo marcas combinantes: no distinguible de la general
  });

  it('la tienda envía la misma etiqueta que el backoffice: «Zona N»', () => {
    expect(zoneLabelOf(10)).toBe('Zona 10');
    expect(zoneLabelOf('07')).toBe('Zona 7');
    expect(coverageZoneOf('10')).toBe('Zona 10');
    expect(coverageZoneOf('')).toBeNull();
    expect(coverageZoneOf('  ')).toBeNull();
    expect(coverageZoneOf(undefined)).toBeNull();
    expect(coverageZoneOf('Colonia Norte')).toBe('Colonia Norte');
  });
});

describe('dinero exacto (string decimal, nunca number)', () => {
  it('normaliza a 2 decimales', () => {
    expect(normalizeMoney('15')).toBe('15.00');
    expect(normalizeMoney('0.1')).toBe('0.10');
    expect(normalizeMoney('15.5')).toBe('15.50');
    expect(normalizeMoney('99999.99')).toBe('99999.99');
    expect(normalizeMoney(' 12.34 ')).toBe('12.34');
  });

  it('rechaza más de 2 decimales, signo, ceros a la izquierda, notación científica y el tope', () => {
    for (const bad of ['15.001', '-1', '+1', '015', '1e3', '', 'abc', '100000', '1,5', '.5']) {
      expect(normalizeMoney(bad), bad).toBeNull();
    }
  });

  it('compara importes y los formatea sin pasar por number', () => {
    expect(sameMoney('15', '15.00')).toBe(true);
    expect(sameMoney('15.10', '15.1')).toBe(true);
    expect(sameMoney('15.00', '15.01')).toBe(false);
    expect(formatMoneyGtq('15.00')).toBe('Q15.00');
    expect(formatMoneyGtq('1234.5')).toBe('Q1,234.50');
    expect(formatMoneyGtq('0.00')).toBe('Q0.00');
  });
});
