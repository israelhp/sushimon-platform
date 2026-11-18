import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Vigencia FIRMADA sin estado de la cotización (F19, ADR-0025 D5). Formato: `v1.<payload b64url>.<HMAC-SHA256 b64url>`
 * con el secreto de servidor `CHECKOUT_QUOTE_SECRET`. Autentica «lo que el servidor cotizó» para que F20 detecte
 * cambios; NO reserva inventario ni congela precios. Sin PII: el cupón, la dirección y la identidad entran solo como
 * HMAC con clave (el token lo ve el cliente: un hash simple de un cupón permitiría adivinarlo fuera de línea).
 */

export const TOKEN_VERSION = 'v1';
export const MIN_SECRET_LENGTH = 32;

export interface QuoteTokenPayload {
  v: 1;
  /** Emisión y vencimiento, segundos Unix. */
  iat: number;
  exp: number;
  branchId: string;
  type: 'PICKUP' | 'DELIVERY';
  provider: 'OWN' | 'PEDIDOSYA' | null;
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  inputHash: string;
  sub: string;
}

export type TokenVerification =
  | { ok: true; payload: QuoteTokenPayload }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NOT_YET_VALID' };

const b64 = (buf: Buffer): string => buf.toString('base64url');

/** Firma con separación de dominio (`token\0`): la clave nunca firma el mismo mensaje que `keyedHash` (`input`/`sub`). */
function sign(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(`token\u0000${data}`).digest();
}

/** HMAC con clave y separación de dominios (`input`, `sub`): mismas entradas => mismo valor, irreversible sin el secreto. */
export function keyedHash(secret: string, domain: 'input' | 'sub', data: string): string {
  return b64(createHmac('sha256', secret).update(`${domain}\u0000${data}`).digest());
}

/** Sujeto del token: HMAC del `authUserId` o la cadena fija `guest` (invitado). */
export function subjectOf(secret: string, authUserId: string | null): string {
  return authUserId === null ? 'guest' : keyedHash(secret, 'sub', authUserId);
}

/** Huella de la entrada canónica (ya normalizada y ordenada por el llamador). */
export function inputHashOf(secret: string, canonical: unknown): string {
  return keyedHash(secret, 'input', JSON.stringify(canonical));
}

export function signQuoteToken(payload: QuoteTokenPayload, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('CHECKOUT_QUOTE_SECRET demasiado corto');
  const body = b64(Buffer.from(JSON.stringify(payload), 'utf8'));
  const head = `${TOKEN_VERSION}.${body}`;
  return `${head}.${b64(sign(secret, head))}`;
}

const SEGMENT = /^[A-Za-z0-9_-]+$/;
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

function isPayload(value: unknown): value is QuoteTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p['v'] === 1 &&
    Number.isInteger(p['iat']) &&
    Number.isInteger(p['exp']) &&
    typeof p['branchId'] === 'string' &&
    (p['type'] === 'PICKUP' || p['type'] === 'DELIVERY') &&
    isStringOrNull(p['provider']) &&
    typeof p['subtotal'] === 'string' &&
    typeof p['discountTotal'] === 'string' &&
    typeof p['deliveryFee'] === 'string' &&
    typeof p['total'] === 'string' &&
    typeof p['inputHash'] === 'string' &&
    typeof p['sub'] === 'string'
  );
}

/**
 * Verifica firma (en TIEMPO CONSTANTE) y vigencia. La firma se comprueba ANTES de interpretar el payload. Lo usará F20,
 * que además debe comparar `sub` con el sujeto actual y recalcular con el mismo cotizador.
 */
export function verifyQuoteToken(token: string, secret: string, nowMs: number): TokenVerification {
  if (typeof token !== 'string' || token.length > 1024) return { ok: false, reason: 'MALFORMED' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: 'MALFORMED' };
  const [version, body, signature] = parts as [string, string, string];
  if (!SEGMENT.test(body) || !SEGMENT.test(signature)) return { ok: false, reason: 'MALFORMED' };
  const expected = sign(secret, `${version}.${body}`);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!isPayload(payload)) return { ok: false, reason: 'MALFORMED' };
  const nowS = Math.floor(nowMs / 1000);
  if (payload.iat > nowS + 5) return { ok: false, reason: 'NOT_YET_VALID' };
  if (nowS >= payload.exp) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, payload };
}
