/**
 * Aritmética monetaria (spec F15 D9, compartida con F19/ADR-0025 D6): TODO en centavos enteros; el porcentaje, en basis
 * points enteros. Ninguna operación usa coma flotante sobre importes. Antes vivía en `promotions/promotion-money.ts`
 * (que la reexporta).
 */

export const MONEY_PATTERN = /^[0-9]{1,6}\.[0-9]{2}$/;
export const MAX_QUANTITY = 99;
export const MAX_LINES = 100;

/** Error de programación: el llamador (F19) envió datos que ya debió validar. No se enmascara. */
export class PromotionEvaluationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromotionEvaluationInputError';
  }
}

/** `"85.00"` -> 8500. Lanza si la cadena no cumple el patrón. */
export function decimalToCents(value: string, label = 'importe'): number {
  if (typeof value !== 'string' || !MONEY_PATTERN.test(value)) {
    throw new PromotionEvaluationInputError(`${label} con formato inválido`);
  }
  const [units, cents] = value.split('.') as [string, string];
  return Number(units) * 100 + Number(cents);
}

/** 14450 -> `"144.50"` (solo enteros no negativos seguros). */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new PromotionEvaluationInputError('centavos fuera de rango');
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * `round_half_up(base * bp / 10000)` con enteros (`bigint` para el producto intermedio).
 * `base` y `bp` son enteros no negativos.
 */
export function percentOf(baseCents: number, basisPoints: number): number {
  return Number((BigInt(baseCents) * BigInt(basisPoints) + 5000n) / 10000n);
}
