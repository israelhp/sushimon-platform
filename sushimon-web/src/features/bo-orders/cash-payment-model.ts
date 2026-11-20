import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminOrderPayment,
  AdminOrderPaymentBlockedReason,
  OrderPaymentStatus,
} from '@/lib/data-access/models';

/**
 * F24 (spec 025 §5.4, §8, §12.2) — Modelo PURO del cobro en efectivo del backoffice. Los importes son cadenas decimales exactas y
 * se operan SIEMPRE en centavos ENTEROS (jamás `number` flotante). El cambio que calcula la web es solo INFORMATIVO: lo que se
 * persiste y se muestra después es el del servidor (la web no lo reenvía).
 */

/** Tope de seguridad del efectivo entregado: Q 5,000.00 (constante del servidor, P83). Solo ayuda local: el servidor decide. */
export const MAX_TENDERED_CENTS = 500_000;

/** Mismo patrón que `AdminCashPaymentRequest.tendered`: hasta 9 enteros y 2 decimales, sin signo, sin separador de miles. */
const TENDERED = /^([0-9]{1,9})(?:\.([0-9]{1,2}))?$/;
const MONEY = /^([0-9]{1,9})\.([0-9]{2})$/;

/** `"185.00"` → `18500`; `null` si no es una cadena monetaria exacta del contrato. */
export function moneyToCents(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const m = MONEY.exec(value);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

/** `18500` → `"185.00"` (cadena decimal exacta de 2 posiciones). */
export function centsToMoney(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  return `${whole}.${String(frac).padStart(2, '0')}`;
}

export type TenderedProblem = 'empty' | 'format' | 'decimals' | 'zero';

export type TenderedParse =
  { ok: true; cents: number; normalized: string } | { ok: false; problem: TenderedProblem };

/**
 * Valida y normaliza lo que escribió la persona. `100` y `100.00` son el mismo valor (`"100.00"` es lo que se envía); más de 2
 * decimales NO se redondean (se rechazan); `1e2`, `-5`, `1,000.00` y `abc` son formato inválido.
 */
export function parseTendered(raw: string): TenderedParse {
  const text = raw.trim();
  if (text === '') return { ok: false, problem: 'empty' };
  const m = TENDERED.exec(text);
  if (!m)
    return { ok: false, problem: /^[0-9]{1,9}\.[0-9]{3,}$/.test(text) ? 'decimals' : 'format' };
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (cents <= 0) return { ok: false, problem: 'zero' };
  return { ok: true, cents, normalized: centsToMoney(cents) };
}

export type TenderedState =
  | { kind: 'empty' }
  | { kind: 'invalid'; problem: Exclude<TenderedProblem, 'empty'> }
  | { kind: 'insufficient'; missingCents: number }
  | { kind: 'tooLarge' }
  | { kind: 'ok'; tenderedCents: number; changeCents: number; normalized: string };

/** Estado local del campo frente a lo que se debe (`dueCents`). Solo guía: la validación definitiva es del servidor. */
export function evaluateTendered(raw: string, dueCents: number): TenderedState {
  const parsed = parseTendered(raw);
  if (!parsed.ok) {
    return parsed.problem === 'empty'
      ? { kind: 'empty' }
      : { kind: 'invalid', problem: parsed.problem };
  }
  if (parsed.cents > MAX_TENDERED_CENTS) return { kind: 'tooLarge' };
  if (parsed.cents < dueCents)
    return { kind: 'insufficient', missingCents: dueCents - parsed.cents };
  return {
    kind: 'ok',
    tenderedCents: parsed.cents,
    changeCents: parsed.cents - dueCents,
    normalized: parsed.normalized,
  };
}

/** Los dos requisitos para habilitar «Registrar»: importe válido y casilla marcada. */
export const canSubmitCash = (state: TenderedState, confirmed: boolean): boolean =>
  state.kind === 'ok' && confirmed;

// ── Resultados y errores del registro ───────────────────────────────────────────────────────────

export type PaymentErrorKind =
  | 'alreadyRegistered'
  | 'notPayable'
  | 'keyReused'
  | 'insufficient'
  | 'tooLarge'
  | 'notCollectable'
  | 'invalidAmount'
  | 'confirmationRequired'
  | 'invalidRequest'
  | 'auth'
  | 'mfa'
  | 'forbidden'
  | 'notFound'
  | 'rate'
  | 'busy'
  | 'network'
  | 'unknown';

export interface PaymentError {
  kind: PaymentErrorKind;
  code: string | null;
  /** `violations[0].code` de un 422 `PAYMENT_NOT_COLLECTABLE`. */
  violation: string | null;
  retryAfterSec: number | null;
  /** Pago ACTUAL que informa el servidor en un 409 (`current`), ya validado. */
  current: AdminOrderPayment | null;
  /** El resultado quedó DESCONOCIDO (red/503): se reintenta con la MISMA clave de idempotencia. */
  retrySameKey: boolean;
}

const STATUSES: readonly OrderPaymentStatus[] = ['PENDING', 'PAID'];

/** Lee `current` de un 409 solo si tiene la forma mínima de `AdminOrderPayment` (nunca confía en el cuerpo a ciegas). */
export function readCurrentPayment(body: unknown): AdminOrderPayment | null {
  if (!body || typeof body !== 'object') return null;
  const current = (body as { current?: unknown }).current;
  if (!current || typeof current !== 'object') return null;
  const c = current as Partial<AdminOrderPayment>;
  if (
    typeof c.orderId !== 'string' ||
    typeof c.amountDue !== 'string' ||
    !STATUSES.includes(c.status as OrderPaymentStatus) ||
    typeof c.registration !== 'object' ||
    c.registration === null
  ) {
    return null;
  }
  return c as AdminOrderPayment;
}

export function classifyPaymentError(error: unknown): PaymentError {
  const base = {
    code: null as string | null,
    violation: null as string | null,
    retryAfterSec: null as number | null,
    current: null as AdminOrderPayment | null,
  };
  if (!isApiError(error)) return { kind: 'unknown', ...base, retrySameKey: false };
  const code = error.businessCode ?? null;
  const detail = {
    code,
    violation: error.violations?.[0]?.code ?? null,
    retryAfterSec: error.retryAfterSec ?? null,
    current: readCurrentPayment(error.body),
  };
  const { status } = error;
  let kind: PaymentErrorKind = 'unknown';
  if (status === 0 || (status >= 500 && code !== 'ORDERS_BUSY')) kind = 'network';
  else if (status === 503) kind = 'busy';
  else if (status === 429) kind = 'rate';
  else if (status === 401) kind = 'auth';
  else if (status === 403) kind = code === 'MFA_REQUIRED' ? 'mfa' : 'forbidden';
  else if (status === 404) kind = 'notFound';
  else if (status === 409) {
    kind =
      code === 'PAYMENT_ALREADY_REGISTERED'
        ? 'alreadyRegistered'
        : code === 'ORDER_NOT_PAYABLE'
          ? 'notPayable'
          : code === 'IDEMPOTENCY_KEY_REUSED'
            ? 'keyReused'
            : 'unknown';
  } else if (status === 422) {
    kind =
      code === 'CASH_AMOUNT_INSUFFICIENT'
        ? 'insufficient'
        : code === 'CASH_TENDERED_TOO_LARGE'
          ? 'tooLarge'
          : code === 'PAYMENT_NOT_COLLECTABLE'
            ? 'notCollectable'
            : 'unknown';
  } else if (status === 400) {
    kind =
      code === 'PAYMENT_AMOUNT_INVALID'
        ? 'invalidAmount'
        : code === 'PAYMENT_CONFIRMATION_REQUIRED'
          ? 'confirmationRequired'
          : 'invalidRequest';
  }
  // Solo red/5xx/503 dejan el estado DESCONOCIDO (puede haberse persistido): se reintenta con la misma clave. Un 429 nunca llegó
  // a procesarse, pero reutilizar la clave tampoco daña (idempotente).
  const retrySameKey = kind === 'network' || kind === 'busy' || kind === 'rate';
  return { kind, ...detail, retrySameKey };
}

/**
 * ¿Hay que descartar la clave de idempotencia tras este error? Tras un rechazo DEFINITIVO del servidor (4xx de negocio o
 * validación) el intento terminó: si la persona corrige el importe, el siguiente envío es otro intento con otra clave. Tras un
 * fallo de red/503/429 se conserva (podría haberse persistido).
 */
export const discardsKey = (error: PaymentError): boolean => !error.retrySameKey;

/** Texto-clave del motivo por el que no se puede registrar (`registration.blockedReason`). Tolera valores futuros. */
const KNOWN_BLOCKED: readonly AdminOrderPaymentBlockedReason[] = [
  'ALREADY_PAID',
  'ORDER_CLOSED',
  'PROVIDER_BLOCKED_EXTERNAL',
  'AMOUNT_ZERO',
  'LEGACY_PAYMENT_METHOD',
  'NO_PERMISSION',
];
export const blockedKey = (reason: string | null): AdminOrderPaymentBlockedReason | 'UNKNOWN' =>
  reason !== null && (KNOWN_BLOCKED as readonly string[]).includes(reason)
    ? (reason as AdminOrderPaymentBlockedReason)
    : 'UNKNOWN';

/** Nuevo identificador de intento (UUID v4; cumple `^[A-Za-z0-9_-]{22,128}$`). Solo vive en memoria del modal. */
export const newAttemptKey = (): string => crypto.randomUUID();
