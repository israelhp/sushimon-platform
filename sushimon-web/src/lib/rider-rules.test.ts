import { describe, expect, it } from 'vitest';
import {
  RIDER_PHONE_RE,
  RIDER_PLATE_RE,
  collapseRiderName,
  maskRiderPhone,
  normalizeRiderPlate,
  riderNameKey,
  riderNameProblem,
  riderOperationalState,
} from './rider-rules';

/** F27 (spec 028 §3.2): las mismas reglas de formato que el servidor (`rider-policy.ts`). */
describe('reglas de motoristas (espejo del servidor)', () => {
  it('teléfono estricto +502 y 8 dígitos', () => {
    expect(RIDER_PHONE_RE.test('+50255501122')).toBe(true);
    for (const bad of [
      '50255501122',
      '+5025550112',
      '+502555011223',
      '+502 5550 1122',
      '+50a55501122',
      '',
    ]) {
      expect(RIDER_PHONE_RE.test(bad), bad).toBe(false);
    }
  });

  it('placa: mayúsculas sin espacios ni guiones, 4 a 10 alfanuméricos', () => {
    expect(normalizeRiderPlate(' m-482 hjk ')).toBe('M482HJK');
    expect(RIDER_PLATE_RE.test('M482HJK')).toBe(true);
    expect(RIDER_PLATE_RE.test('AB1')).toBe(false);
    expect(RIDER_PLATE_RE.test('ABCDEFGHIJK')).toBe(false);
    expect(RIDER_PLATE_RE.test('AB*123')).toBe(false);
  });

  it('nombre: NFC, espacios colapsados, 2 a 80, sin caracteres de control', () => {
    expect(collapseRiderName('  Luis   Coc ')).toBe('Luis Coc');
    expect(riderNameProblem('A')).toBe('length');
    expect(riderNameProblem(' '.repeat(5))).toBe('length');
    expect(riderNameProblem('x'.repeat(81))).toBe('length');
    expect(riderNameProblem('x'.repeat(80))).toBeNull();
    expect(riderNameProblem('Ana\u0007')).toBe('control');
    expect(riderNameProblem('Ángel Morales')).toBeNull();
  });

  it('clave de búsqueda sin acentos ni mayúsculas', () => {
    expect(riderNameKey('  ÁNGEL   Morales ')).toBe('angel morales');
  });

  it('teléfono enmascarado como el servidor', () => {
    expect(maskRiderPhone('+50255501122')).toBe('+502****1122');
  });

  it('estado operativo: INACTIVE > UNAVAILABLE > BUSY > AVAILABLE', () => {
    expect(riderOperationalState(false, 'AVAILABLE', true)).toBe('INACTIVE');
    expect(riderOperationalState(true, 'UNAVAILABLE', true)).toBe('UNAVAILABLE');
    expect(riderOperationalState(true, 'AVAILABLE', true)).toBe('BUSY');
    expect(riderOperationalState(true, 'AVAILABLE', false)).toBe('AVAILABLE');
  });
});
