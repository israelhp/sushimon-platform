import { decodeCursor, encodeCursor } from './order-cursor.js';
import * as adminCursor from './admin/admin-orders-cursor.js';

const NOW = new Date('2026-11-19T15:00:00.000Z');
const ID = '7c1f0f52-3b5e-4c63-9a4d-5f6e8f0a1b2c';
const KEY = '2026-11-18T19:42:10.123456Z';
const raw = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

describe('códec de cursor compartido (F22 + F23, spec 024 §11 #9)', () => {
  it('ida y vuelta con microsegundos exactos', () => {
    expect(decodeCursor(encodeCursor({ placedAtKey: KEY, id: ID }), NOW)).toEqual({
      placedAtKey: KEY,
      id: ID,
    });
  });

  it('F22 conserva su ruta de importación y usa el MISMO códec', () => {
    expect(adminCursor.encodeCursor).toBe(encodeCursor);
    expect(adminCursor.decodeCursor).toBe(decodeCursor);
  });

  it.each([
    ['vacío', ''],
    ['caracteres fuera de base64url', 'abc$%'],
    ['más de 200 caracteres', 'a'.repeat(201)],
    ['versión desconocida', raw(`v2|${KEY}|${ID}`)],
    ['faltan partes', raw(`v1|${KEY}`)],
    ['sobran partes', raw(`v1|${KEY}|${ID}|x`)],
    ['fecha sin microsegundos', raw(`v1|2026-11-18T19:42:10Z|${ID}`)],
    ['fecha inexistente (31 de febrero)', raw(`v1|2026-02-31T10:00:00.000000Z|${ID}`)],
    ['año 0000', raw(`v1|0000-01-01T00:00:00.000000Z|${ID}`)],
    ['más de un día en el futuro', raw(`v1|2026-11-21T00:00:00.000000Z|${ID}`)],
    ['UUID inválido', raw(`v1|${KEY}|not-a-uuid`)],
    ['UUID en mayúsculas', raw(`v1|${KEY}|${ID.toUpperCase()}`)],
  ])('%s => 400 ORDER_CURSOR_INVALID (nunca 500)', (_name, cursor) => {
    try {
      decodeCursor(cursor, NOW);
      throw new Error('debía lanzar');
    } catch (error) {
      const e = error as { status: number; response: { code: string } };
      expect(e.status).toBe(400);
      expect(e.response.code).toBe('ORDER_CURSOR_INVALID');
    }
  });
});
