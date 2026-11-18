import { ApiError } from '@/lib/data-access/errors';
import type { CheckoutBlocker, CheckoutQuote, OrderQuoteChange } from '@/lib/data-access/models';

/**
 * F20 — Clasificación PURA de los errores de `POST /v1/orders` (spec 021 §2.3). Se ramifica por estado HTTP y código de negocio
 * estable (`ApiError.businessCode`), nunca por el texto del mensaje. Un código futuro cae en `unknown` (el contrato dice tolerarlos).
 */
export type PlaceFailure =
  /** Sin respuesta (red caída, timeout, 5xx genérico) o `IDEMPOTENCY_IN_PROGRESS`: reintento con la MISMA clave. */
  | { kind: 'ambiguous' }
  /** 503 `ORDERS_BUSY`: reintento con la MISMA clave. */
  | { kind: 'busy' }
  /** 503 `ORDERS_UNAVAILABLE`: sin reintento automático. */
  | { kind: 'unavailable' }
  | { kind: 'quoteChanged'; changes: OrderQuoteChange[]; quote: CheckoutQuote }
  | { kind: 'quoteExpired' }
  | { kind: 'quoteInvalid' }
  | { kind: 'keyReused' }
  | { kind: 'blocked'; blockers: CheckoutBlocker[] }
  | { kind: 'rateLimited'; retryAfterSec: number | undefined }
  | { kind: 'pendingLimit' }
  | { kind: 'paymentUnavailable' }
  | { kind: 'contactIncomplete' }
  | { kind: 'providerNotSelectable' }
  /** 401 / 404: dirección guardada ajena o inexistente, o sesión caducada. */
  | { kind: 'address' }
  | { kind: 'invalid' }
  | { kind: 'unknown' };

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Cotización del cuerpo 409 si trae la forma mínima que la pantalla necesita (token y total); si no, `null`. */
export function quoteFromConflict(body: unknown): CheckoutQuote | null {
  if (!isObj(body) || !isObj(body.quote)) return null;
  const q = body.quote as Partial<CheckoutQuote>;
  if (!isObj(q.quote) || typeof q.total !== 'string' || !Array.isArray(q.lines)) return null;
  return body.quote as unknown as CheckoutQuote;
}

function changesFromConflict(body: unknown): OrderQuoteChange[] {
  if (!isObj(body) || !Array.isArray(body.changes)) return [];
  return body.changes.filter((c): c is OrderQuoteChange => isObj(c) && typeof c.field === 'string');
}

export function classifyPlaceError(error: unknown): PlaceFailure {
  if (!(error instanceof ApiError)) return { kind: 'unknown' };
  const { status, businessCode: code } = error;
  if (status === 0) return { kind: 'ambiguous' };
  if (status === 409) {
    if (code === 'IDEMPOTENCY_IN_PROGRESS') return { kind: 'ambiguous' };
    if (code === 'IDEMPOTENCY_KEY_REUSED') return { kind: 'keyReused' };
    if (code === 'QUOTE_EXPIRED') return { kind: 'quoteExpired' };
    if (code === 'QUOTE_CHANGED') {
      const quote = quoteFromConflict(error.body);
      // Sin la cotización nueva no se puede re-aceptar: se recotiza como si hubiera vencido.
      return quote
        ? { kind: 'quoteChanged', changes: changesFromConflict(error.body), quote }
        : { kind: 'quoteExpired' };
    }
    return { kind: 'unknown' };
  }
  if (status === 422) {
    switch (code) {
      case 'QUOTE_INVALID':
        return { kind: 'quoteInvalid' };
      case 'CHECKOUT_BLOCKED': {
        const blockers =
          isObj(error.body) && Array.isArray(error.body.blockers)
            ? (error.body.blockers as CheckoutBlocker[])
            : [];
        return { kind: 'blocked', blockers };
      }
      case 'PAYMENT_METHOD_UNAVAILABLE':
        return { kind: 'paymentUnavailable' };
      case 'CONTACT_INCOMPLETE':
        return { kind: 'contactIncomplete' };
      case 'DELIVERY_PROVIDER_NOT_SELECTABLE':
        return { kind: 'providerNotSelectable' };
      default:
        return { kind: 'invalid' };
    }
  }
  if (status === 429) {
    return code === 'PENDING_ORDERS_LIMIT'
      ? { kind: 'pendingLimit' }
      : { kind: 'rateLimited', retryAfterSec: error.retryAfterSec };
  }
  if (status === 503) {
    return code === 'ORDERS_UNAVAILABLE' ? { kind: 'unavailable' } : { kind: 'busy' };
  }
  if (status >= 500) return { kind: 'ambiguous' };
  if (status === 401 || status === 404) return { kind: 'address' };
  if (status === 400) return { kind: 'invalid' };
  return { kind: 'unknown' };
}

/** ¿Se reintenta solo con la MISMA clave? (red/5xx/ocupado). Nunca ante 4xx ni `ORDERS_UNAVAILABLE`. */
export const isAutoRetryable = (f: PlaceFailure): boolean =>
  f.kind === 'ambiguous' || f.kind === 'busy';

/** ¿Se descarta la clave de idempotencia? (la siguiente confirmación usa una nueva). */
export const discardsAttempt = (f: PlaceFailure): boolean =>
  f.kind === 'quoteChanged' ||
  f.kind === 'quoteExpired' ||
  f.kind === 'quoteInvalid' ||
  f.kind === 'keyReused';
