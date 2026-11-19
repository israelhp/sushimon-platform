import { orderCursorInvalid } from './admin/order-admin-errors.js';

/**
 * Cursor keyset OPACO de `(placed_at, id)` (spec 023 §4.3; compartido por F22 y F23, spec 024 §4.1): base64url de `v1|<instante UTC con microsegundos>|<uuid>`.
 * Se valida por formato; como el alcance se aplica SIEMPRE en la consulta, un cursor manipulado no revela nada.
 */
const KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]{1,200}$/;

export interface OrderCursor {
  placedAtKey: string;
  id: string;
}

export const encodeCursor = (c: OrderCursor): string =>
  Buffer.from(`v1|${c.placedAtKey}|${c.id}`, 'utf8').toString('base64url');

/**
 * El instante debe existir de verdad (`2023-02-31…` o año `0000` harían fallar el `::timestamptz` en la BD): ida y vuelta
 * por `Date` idéntica (parte de milisegundos), año >= 2000 y no más de un día en el futuro.
 */
function isRealInstant(key: string, now: Date): boolean {
  const millis = `${key.slice(0, 23)}Z`;
  const date = new Date(millis);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString() === millis &&
    date.getUTCFullYear() >= 2000 &&
    date.getTime() <= now.getTime() + 86_400_000
  );
}

/** Decodifica o lanza 400 `ORDER_CURSOR_INVALID` (nunca detalla el motivo). */
export function decodeCursor(raw: string, now: Date = new Date()): OrderCursor {
  if (!BASE64URL.test(raw)) throw orderCursorInvalid();
  const parts = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const [version, placedAtKey, id] = parts;
  if (
    parts.length !== 3 ||
    version !== 'v1' ||
    !placedAtKey ||
    !id ||
    !KEY.test(placedAtKey) ||
    !UUID.test(id) ||
    !isRealInstant(placedAtKey, now)
  ) {
    throw orderCursorInvalid();
  }
  return { placedAtKey, id };
}
