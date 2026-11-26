import { createHash, timingSafeEqual } from 'node:crypto';
import { canonicalInput } from '../checkout/quote-canon.js';
import { normalizeCouponCode } from '../promotions/promotion-evaluator.js';
import { normalizeZoneLabel } from '../delivery-coverage/zone-policy.js';
import type { CheckoutQuoteRequestDto } from '../checkout/dto/checkout-quote-request.dto.js';
import type { AddressText, OrderContact } from './order-contact.policy.js';
import { idempotencyKeyInvalid } from './orders-errors.js';

/**
 * Idempotencia de la creación de pedidos (F20, spec 021 §4, ADR-0026 D3): reglas PURAS (clave, alcance, huellas). El
 * protocolo transaccional vive en `OrdersRepository`. La clave nunca se guarda en claro (`key_hash = sha256`).
 */

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
/**
 * Mínimo de caracteres DISTINTOS de la clave (entropía mínima: rechaza `aaaaaaaa…`, `1234512345…`). Un UUID v4 aleatorio
 * tiene ~14-17 distintos y casi nunca < 10; se usa 10 (no 16) para no rechazar UUID legítimos.
 */
export const MIN_DISTINCT_KEY_CHARS = 10;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** Probabilidad de purgar (<= 100 filas vencidas) por creación; sin cron. */
export const LAZY_PURGE_PROBABILITY = 1 / 50;
export const LAZY_PURGE_BATCH = 100;

/** Valida la cabecera (400 `IDEMPOTENCY_KEY_INVALID`). Una cabecera repetida llega como `a, b` y no cumple el patrón. */
export function parseIdempotencyKey(raw: unknown): string {
  if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(raw)) throw idempotencyKeyInvalid();
  if (new Set(raw).size < MIN_DISTINCT_KEY_CHARS) throw idempotencyKeyInvalid();
  return raw;
}

export const keyHashOf = (key: string): Buffer => createHash('sha256').update(key, 'utf8').digest();

/** Alcance de la clave: un cliente (`customer:<id>`) o el invitado. Forma parte de la unicidad. */
export const scopeOf = (customerId: string | null): string =>
  customerId === null ? 'guest' : `customer:${customerId}`;

export const hashesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && timingSafeEqual(a, b);

export interface CanonicalOrderBodyInput {
  body: Pick<CheckoutQuoteRequestDto, 'cart' | 'fulfillment' | 'couponCode'>;
  /** Contacto YA resuelto (normalizado; con el perfil si es autenticado). */
  contact: OrderContact;
  /** Texto de dirección normalizado (`null` con dirección guardada). */
  address: AddressText | null;
  notes: string | null;
  paymentMethodPreference: string | null;
}

/**
 * Cuerpo canónico del pedido: la entrada canónica de la cotización (líneas y selecciones ordenadas, cupón y zona
 * normalizados; MISMA función que la huella del token) + contacto, dirección, notas y preferencia normalizados. SIN
 * `quoteToken`: un reintento con el token renovado sigue siendo «el mismo intento».
 */
export function canonicalOrderBody(input: CanonicalOrderBodyInput): unknown {
  const { body } = input;
  return {
    q: canonicalInput(
      body,
      normalizeCouponCode(body.couponCode),
      normalizeZoneLabel(body.fulfillment.zone),
    ),
    c: [input.contact.fullName, input.contact.phone, input.contact.email],
    a: input.address ? [input.address.addressLine, input.address.referenceNote] : null,
    n: input.notes,
    m: input.paymentMethodPreference,
  };
}
