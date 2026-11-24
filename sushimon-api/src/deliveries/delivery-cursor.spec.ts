import { HttpException } from '@nestjs/common';
import {
  decodeDeliveryCursor,
  encodeDeliveryCursor,
  filterFingerprint,
} from './delivery-cursor.js';

const NOW = new Date('2026-11-18T19:00:00.000Z');
const ID = 'c0000000-0000-4000-8000-000000000001';
const KEY = '2026-11-18T18:30:00.123456Z';
const fp = filterFingerprint({
  statuses: ['pending'],
  riderId: null,
  branchId: null,
  from: null,
  to: null,
});
const raw = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
const invalid = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return [
      (e as HttpException).getStatus(),
      ((e as HttpException).getResponse() as { code: string }).code,
    ];
  }
  return null;
};

describe('cursor keyset de entregas (R36)', () => {
  it('ida y vuelta con microsegundos exactos', () => {
    const cursor = encodeDeliveryCursor({ createdAtKey: KEY, id: ID }, fp);
    expect(decodeDeliveryCursor(cursor, fp, NOW)).toEqual({ createdAtKey: KEY, id: ID });
  });

  it.each([
    ['no base64url', '%%%'],
    ['vacío', ''],
    ['versión', raw(`v2|${KEY}|${ID}|${fp}`)],
    ['sin huella', raw(`v1|${KEY}|${ID}`)],
    ['huella corta', raw(`v1|${KEY}|${ID}|abc`)],
    ['instante sin microsegundos', raw(`v1|2026-11-18T18:30:00Z|${ID}|${fp}`)],
    ['fecha inexistente', raw(`v1|2026-02-31T18:30:00.000000Z|${ID}|${fp}`)],
    ['año 0000', raw(`v1|0000-01-01T00:00:00.000000Z|${ID}|${fp}`)],
    ['futuro', raw(`v1|2027-01-01T00:00:00.000000Z|${ID}|${fp}`)],
    ['id no UUID', raw(`v1|${KEY}|no-uuid|${fp}`)],
    ['partes de más', raw(`v1|${KEY}|${ID}|${fp}|x`)],
    ['demasiado largo', 'a'.repeat(201)],
  ])('cursor alterado (%s) => 400 DELIVERY_CURSOR_INVALID', (_n, value) => {
    expect(invalid(() => decodeDeliveryCursor(value, fp, NOW))).toEqual([
      400,
      'DELIVERY_CURSOR_INVALID',
    ]);
  });

  it('un cursor de OTRA consulta (huella distinta) es inválido', () => {
    const cursor = encodeDeliveryCursor({ createdAtKey: KEY, id: ID }, fp);
    const other = filterFingerprint({
      statuses: ['delivered'],
      riderId: null,
      branchId: null,
      from: null,
      to: null,
    });
    expect(other).not.toBe(fp);
    expect(invalid(() => decodeDeliveryCursor(cursor, other, NOW))).toEqual([
      400,
      'DELIVERY_CURSOR_INVALID',
    ]);
  });

  it('la huella no depende del orden de los estados y distingue riderId, sucursal y rango', () => {
    const base = { riderId: null, branchId: null, from: null, to: null };
    expect(filterFingerprint({ statuses: ['a', 'b'], ...base })).toBe(
      filterFingerprint({ statuses: ['b', 'a'], ...base }),
    );
    const variants = [
      { ...base, riderId: ID },
      { ...base, branchId: ID },
      { ...base, from: '2026-11-01T00:00:00Z' },
      { ...base, to: '2026-11-02T00:00:00Z' },
    ].map((v) => filterFingerprint({ statuses: ['a'], ...v }));
    expect(new Set([...variants, filterFingerprint({ statuses: ['a'], ...base })]).size).toBe(5);
  });
});
