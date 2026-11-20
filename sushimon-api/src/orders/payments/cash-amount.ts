import { createHash } from 'node:crypto';
import { paymentAmountInvalid } from './payments-errors.js';

/**
 * Aritmética del efectivo (F24, spec 025 §5.4 y §8): TODO en centavos ENTEROS; nunca `number` flotante ni redondeo silencioso.
 * Funciones puras (sin I/O). El cambio lo calcula SOLO el servidor.
 */

/** Tope de seguridad del efectivo entregado: Q 5,000.00 (P83; constante del servidor). */
export const CASH_TENDERED_MAX_CENTS = 500_000;

/** Forma exacta del contrato (`AdminCashPaymentRequest.tendered`): hasta 9 enteros y hasta 2 decimales, sin signo ni separadores. */
export const TENDERED_PATTERN = /^[0-9]{1,9}(\.[0-9]{1,2})?$/;

/**
 * `"200.00"` | `"200"` | `"0.5"` -> centavos enteros. Cualquier otra cosa (no cadena, vacío, signo, notación científica,
 * separador de miles, más de 2 decimales, cero) => 400 `PAYMENT_AMOUNT_INVALID`. `100` y `100.00` son el mismo valor.
 */
export function parseTenderedCents(raw: unknown): number {
  if (typeof raw !== 'string' || !TENDERED_PATTERN.test(raw)) throw paymentAmountInvalid();
  const [units, fraction = ''] = raw.split('.') as [string, string?];
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw paymentAmountInvalid();
  return cents;
}

/** Importe de la BD (`numeric(12,2)` como texto, `"185.00"`) -> centavos enteros; `null` si no tiene la forma esperada. */
export function dbMoneyToCents(value: string): number | null {
  const m = /^([0-9]{1,10})\.([0-9]{2})$/.exec(value);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number(m[2]);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Centavos enteros no negativos -> `"185.00"`. */
export function centsToMoney(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('centavos fuera de rango');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export type CashSettlement =
  { ok: true; changeCents: number } | { ok: false; reason: 'INSUFFICIENT' | 'TOO_LARGE' };

/**
 * Liquidación: `tendered >= amount` (si no, INSUFFICIENT) y `tendered <= tope` (si no, TOO_LARGE); `change = tendered - amount`.
 * El INGRESO aplicado es `amount` (la deuda), nunca `tendered`.
 */
export function settleCash(amountCents: number, tenderedCents: number): CashSettlement {
  if (tenderedCents < amountCents) return { ok: false, reason: 'INSUFFICIENT' };
  if (tenderedCents > CASH_TENDERED_MAX_CENTS) return { ok: false, reason: 'TOO_LARGE' };
  return { ok: true, changeCents: tenderedCents - amountCents };
}

/**
 * Huella del cuerpo canónico (normalizado: `100` y `100.00` coinciden; `receivedConfirmed` siempre `true`). Alcance: el pedido.
 * Solo se guarda este sha256 (32 bytes), nunca el importe en claro como clave.
 */
export function requestHashOf(orderId: string, tenderedCents: number): Buffer {
  return createHash('sha256').update(`cash-receipt\0${orderId}\0${tenderedCents}`, 'utf8').digest();
}
