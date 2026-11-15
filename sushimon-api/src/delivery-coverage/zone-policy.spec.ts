import { BadRequestException } from '@nestjs/common';
import { normalizeMoney, normalizeZone, normalizeZoneLabel, zoneKeyOf } from './zone-policy.js';

describe('normalizeZoneLabel (D6)', () => {
  it('null, undefined, vacío y blancos => null (cobertura general)', () => {
    expect(normalizeZoneLabel(null)).toBeNull();
    expect(normalizeZoneLabel(undefined)).toBeNull();
    expect(normalizeZoneLabel('')).toBeNull();
    expect(normalizeZoneLabel('   \t\n ')).toBeNull();
  });

  it('recorta, colapsa espacios Unicode y conserva mayúsculas y acentos', () => {
    expect(normalizeZoneLabel('  Zona   4 ')).toBe('Zona 4');
    expect(normalizeZoneLabel('Zona\t 4\n')).toBe('Zona 4');
    expect(normalizeZoneLabel('San José  Pinula')).toBe('San José Pinula');
  });

  it('NFC: la forma descompuesta y la compuesta dan la misma etiqueta', () => {
    expect(normalizeZoneLabel('José')).toBe('José');
    expect(normalizeZoneLabel('José')).toBe('José');
  });

  it('60 caracteres es válido; 61 => 400; cuenta puntos de código, no unidades UTF-16', () => {
    expect(normalizeZoneLabel('a'.repeat(60))).toHaveLength(60);
    expect(() => normalizeZoneLabel('a'.repeat(61))).toThrow(BadRequestException);
    expect(normalizeZoneLabel('😀'.repeat(60))).not.toBeNull();
    expect(() => normalizeZoneLabel('😀'.repeat(61))).toThrow(BadRequestException);
    // el límite se aplica tras normalizar: espacios sobrantes no cuentan
    expect(normalizeZoneLabel(`${' '.repeat(50)}${'a'.repeat(60)}${' '.repeat(50)}`)).toHaveLength(
      60,
    );
  });

  it('caracteres de control (no espacio) => 400', () => {
    expect(() => normalizeZoneLabel('Zona\u0000 4')).toThrow(BadRequestException);
    expect(() => normalizeZoneLabel('Zona\u0007')).toThrow(BadRequestException);
    expect(() => normalizeZoneLabel('Zona\u0085')).toThrow(BadRequestException);
  });
});

describe('zoneKeyOf (D6)', () => {
  it('null => cadena vacía; sin acentos ni mayúsculas', () => {
    expect(zoneKeyOf(null)).toBe('');
    expect(zoneKeyOf('Zona 4')).toBe('zona 4');
    expect(zoneKeyOf('Ñandú Á')).toBe('nandu a');
    expect(zoneKeyOf('SAN JOSÉ')).toBe('san jose');
  });

  it('NFC y NFD equivalentes producen la misma clave; etiquetas equivalentes colisionan', () => {
    expect(zoneKeyOf('José')).toBe(zoneKeyOf('José'));
    expect(zoneKeyOf('ZONA 4')).toBe(zoneKeyOf('zóna 4'));
    expect(zoneKeyOf('İstanbul')).toBe('istanbul');
  });

  it('NO unifica ceros ni sinónimos: "Zona 4" ≠ "4" ≠ "04"', () => {
    const keys = ['Zona 4', '4', '04'].map(zoneKeyOf);
    expect(new Set(keys).size).toBe(3);
  });

  it('solo marcas combinantes => 400 (la clave no puede ser vacía con etiqueta)', () => {
    expect(() => zoneKeyOf('́')).toThrow(BadRequestException);
  });

  it('cumple los CHECK de la BD: minúsculas, sin bordes de espacio ni dobles espacios', () => {
    for (const raw of ['  Zona   4 ', 'ÁÉÍ  ÓÚ', 'Mixco Z 1']) {
      const { label, key } = normalizeZone(raw);
      expect(label).not.toBeNull();
      expect(key).toBe(key.toLowerCase());
      expect(key).toBe(key.trim());
      expect(key).not.toMatch(/\s{2,}/);
      expect(key).not.toBe('');
    }
    expect(normalizeZone(null)).toEqual({ label: null, key: '' });
    expect(normalizeZone('   ')).toEqual({ label: null, key: '' });
  });
});

describe('normalizeMoney (D11)', () => {
  it('normaliza a 2 decimales con texto exacto', () => {
    expect(normalizeMoney('15')).toBe('15.00');
    expect(normalizeMoney('15.5')).toBe('15.50');
    expect(normalizeMoney('0.1')).toBe('0.10');
    expect(normalizeMoney('0')).toBe('0.00');
    expect(normalizeMoney('0.00')).toBe('0.00');
    expect(normalizeMoney('99999.99')).toBe('99999.99');
    expect(normalizeMoney('99999')).toBe('99999.00');
  });

  it('rechaza 3 decimales, negativos, topes, ceros a la izquierda, notación y no strings', () => {
    for (const bad of [
      '15.001',
      '-1',
      '+1',
      '100000',
      '100000.00',
      '099',
      '1e2',
      '1,5',
      ' 15',
      '15 ',
      '.5',
      '15.',
      '',
      'abc',
      'NaN',
      'Infinity',
    ]) {
      expect(() => normalizeMoney(bad), bad).toThrow(BadRequestException);
    }
    for (const notString of [15, 15.5, null, undefined, true, {}]) {
      expect(() => normalizeMoney(notString)).toThrow(BadRequestException);
    }
  });

  it('no pierde exactitud donde un float fallaría', () => {
    expect(normalizeMoney('0.30')).toBe('0.30');
    expect(normalizeMoney('4.35')).toBe('4.35');
  });
});
