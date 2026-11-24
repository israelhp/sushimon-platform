import { createHash } from 'node:crypto';
import { deliveryCursorInvalid } from './delivery-errors.js';

/**
 * Cursor keyset OPACO de `(created_at, id)` (spec 029 §4.2): base64url de `v1|<instante UTC con microsegundos>|<uuid>|<huella>`.
 * La huella liga el cursor a la CONSULTA (estados, motorista, sucursal y rango explícitos): un cursor de otra consulta o alterado
 * es 400 `DELIVERY_CURSOR_INVALID`. Como el alcance se aplica SIEMPRE en la consulta, un cursor manipulado no revela nada.
 */
const KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT = /^[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]{1,200}$/;

export interface DeliveryCursor {
  createdAtKey: string;
  id: string;
}

/** Huella de los filtros EXPLÍCITOS (no del `from` por omisión, que cambia en cada solicitud). */
export function filterFingerprint(filter: {
  statuses: readonly string[];
  riderId: string | null;
  branchId: string | null;
  from: string | null;
  to: string | null;
}): string {
  const canonical = JSON.stringify([
    [...filter.statuses].sort(),
    filter.riderId,
    filter.branchId,
    filter.from,
    filter.to,
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export const encodeDeliveryCursor = (c: DeliveryCursor, fingerprint: string): string =>
  Buffer.from(`v1|${c.createdAtKey}|${c.id}|${fingerprint}`, 'utf8').toString('base64url');

/** El instante debe existir de verdad (ida y vuelta por `Date`), año >= 2000 y no más de un día en el futuro. */
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

/** Decodifica o lanza 400 `DELIVERY_CURSOR_INVALID` (nunca detalla el motivo). */
export function decodeDeliveryCursor(
  raw: string,
  fingerprint: string,
  now: Date = new Date(),
): DeliveryCursor {
  if (!BASE64URL.test(raw)) throw deliveryCursorInvalid();
  const parts = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const [version, createdAtKey, id, fp] = parts;
  if (
    parts.length !== 4 ||
    version !== 'v1' ||
    !createdAtKey ||
    !id ||
    !fp ||
    !KEY.test(createdAtKey) ||
    !UUID.test(id) ||
    !FINGERPRINT.test(fp) ||
    fp !== fingerprint ||
    !isRealInstant(createdAtKey, now)
  ) {
    throw deliveryCursorInvalid();
  }
  return { createdAtKey, id };
}
