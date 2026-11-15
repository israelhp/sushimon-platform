import { describe, expect, it } from 'vitest';
import {
  ADDRESS_LIMIT,
  canAddAddress,
  duplicateKey,
  normalizeAddressFields,
  normalizeText,
  roundCoordinate,
} from './customer-address.policy.js';

const MUNI_A = '11111111-1111-4111-8111-111111111111';
const MUNI_B = '22222222-2222-4222-8222-222222222222';

describe('normalizeText', () => {
  it('recorta, colapsa espacios y elimina caracteres de control sin tocar tildes', () => {
    expect(normalizeText('  Avenida   La\tPaz\u0007 12  ')).toBe('Avenida La Paz 12');
    expect(normalizeText('Zona 10 · Ñandú')).toBe('Zona 10 · Ñandú');
  });
});

describe('normalizeAddressFields', () => {
  it('acepta una dirección mínima y convierte zona/referencia vacías a null', () => {
    const r = normalizeAddressFields({
      label: 'Casa',
      addressLine: '  5a calle  ',
      zone: '   ',
      referenceNote: '',
    });
    expect(r).toEqual({
      ok: true,
      value: { label: 'Casa', addressLine: '5a calle', zone: null, referenceNote: null },
    });
  });

  it('rechaza etiqueta vacía o de más de 40 caracteres (contando code points)', () => {
    const vacia = normalizeAddressFields({ label: '   ' });
    expect(vacia.ok).toBe(false);
    const larga = normalizeAddressFields({ label: 'ñ'.repeat(41) });
    expect(larga.ok).toBe(false);
    if (!larga.ok) expect(larga.violations[0]?.code).toBe('LABEL_LENGTH');
    expect(normalizeAddressFields({ label: 'ñ'.repeat(40) }).ok).toBe(true);
  });

  it('rechaza línea de dirección vacía y referencia de más de 200 caracteres', () => {
    const linea = normalizeAddressFields({ addressLine: ' ' });
    expect(linea.ok).toBe(false);
    if (!linea.ok) expect(linea.violations[0]?.code).toBe('ADDRESS_LINE_LENGTH');
    const ref = normalizeAddressFields({ referenceNote: 'x'.repeat(201) });
    expect(ref.ok).toBe(false);
    if (!ref.ok) expect(ref.violations[0]?.code).toBe('REFERENCE_LENGTH');
  });

  it('valida rangos de latitud y longitud', () => {
    expect(normalizeAddressFields({ latitude: 90.0001, longitude: 0 }).ok).toBe(false);
    expect(normalizeAddressFields({ latitude: 0, longitude: -180.5 }).ok).toBe(false);
    const ok = normalizeAddressFields({ latitude: 14.6349149, longitude: -90.5068824 });
    expect(ok).toEqual({ ok: true, value: { latitude: 14.6349149, longitude: -90.5068824 } });
  });

  it('exige latitud y longitud juntas o ambas nulas; nunca inventa una coordenada', () => {
    const solo = normalizeAddressFields({ latitude: 14.6, longitude: null });
    expect(solo.ok).toBe(false);
    if (!solo.ok) expect(solo.violations[0]?.code).toBe('COORDINATES_PAIR');
    expect(normalizeAddressFields({ latitude: null, longitude: null })).toEqual({
      ok: true,
      value: { latitude: null, longitude: null },
    });
  });

  it('redondea coordenadas a 7 decimales (numeric(10,7))', () => {
    expect(roundCoordinate(14.123456789)).toBe(14.1234568);
  });

  it('no valida campos ausentes (útil para PATCH parcial)', () => {
    expect(normalizeAddressFields({})).toEqual({ ok: true, value: {} });
  });
});

describe('duplicateKey', () => {
  it('ignora mayúsculas, espacios y la referencia; distingue municipio y zona', () => {
    const base = { addressLine: 'Calle  Real 1', municipalityId: MUNI_A, zone: 'Zona 10' };
    expect(duplicateKey(base)).toBe(duplicateKey({ ...base, addressLine: ' calle real 1 ' }));
    expect(duplicateKey(base)).not.toBe(duplicateKey({ ...base, municipalityId: MUNI_B }));
    expect(duplicateKey(base)).not.toBe(duplicateKey({ ...base, zone: 'Zona 11' }));
    expect(duplicateKey({ ...base, zone: null })).toBe(duplicateKey({ ...base, zone: null }));
  });

  it('no considera duplicadas dos direcciones con la misma etiqueta (la etiqueta no entra en la clave)', () => {
    // La clave no recibe etiqueta ni referencia: dos "Casa" con líneas distintas nunca colisionan.
    expect(duplicateKey({ addressLine: 'A', municipalityId: MUNI_A, zone: null })).not.toBe(
      duplicateKey({ addressLine: 'B', municipalityId: MUNI_A, zone: null }),
    );
  });
});

describe('canAddAddress', () => {
  it(`permite crear hasta ${ADDRESS_LIMIT} direcciones y no una más`, () => {
    expect(canAddAddress(ADDRESS_LIMIT - 1)).toBe(true);
    expect(canAddAddress(ADDRESS_LIMIT)).toBe(false);
  });
});
