import {
  PRODUCT_PRICE_MAX_CENTS,
  PRODUCT_PRICE_PATTERN,
  centsToPrice,
  priceToCents,
} from './product-rules';

/**
 * F13 — Reglas PURAS de precio y disponibilidad por sucursal (spec 014, ADR-0019), compartidas por el mock, los hooks y la UI.
 * Los importes son CADENAS decimales (`"85.00"`): se opera siempre en céntimos ENTEROS, nunca con `number` decimal.
 * Ausencia de override = precio base; ausencia de fila = disponible. La API (no la UI) es la fuente de verdad.
 */

/** Precio EFECTIVO de una sucursal: el override si existe; si no, el precio base (`coalesce(price_override, base_price)`). */
export const effectivePrice = (basePrice: string, priceOverride: string | null): string =>
  priceOverride ?? basePrice;

/** «Ofertado» en una sucursal = producto públicamente visible (F11/F10) Y disponible allí. */
export const isOffered = (publiclyVisible: boolean, available: boolean): boolean =>
  publiclyVisible && available;

/** Resultado de validar el texto del campo «Precio especial» (antes de enviarlo). */
export type OverrideInput =
  { ok: true; price: string | null } | { ok: false; reason: 'invalid' | 'zero' };

/**
 * Texto del campo → `priceOverride` del contrato. Vacío = `null` (usa el precio base). Admite coma o punto y de 0 a 2
 * decimales (`85`, `85.5`, `85,50`). `0` y `0.00` → `zero` (el servidor responde 422 `BRANCH_PRICE_INVALID`); lo demás que no sea
 * un importe de hasta 999 999.99 → `invalid`.
 */
export function parseOverrideInput(text: string): OverrideInput {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, price: null };
  const m = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (!m) return { ok: false, reason: 'invalid' };
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  if (cents === 0) return { ok: false, reason: 'zero' };
  return cents <= PRODUCT_PRICE_MAX_CENTS
    ? { ok: true, price: centsToPrice(cents) }
    : { ok: false, reason: 'invalid' };
}

/**
 * Valida el CUERPO `priceOverride` como lo haría el servidor (D9): `null` es válido; una cadena fuera de la forma
 * `^[0-9]{1,6}\.[0-9]{2}$` (o cualquier otro tipo) es un error de forma (`shape` → 400); `"0.00"` está bien formada pero es ≤ 0
 * (`zero` → 422 `BRANCH_PRICE_INVALID`).
 */
export function checkOverrideBody(value: unknown): 'ok' | 'shape' | 'zero' {
  if (value === null) return 'ok';
  if (typeof value !== 'string' || !PRODUCT_PRICE_PATTERN.test(value)) return 'shape';
  const [whole, fraction] = value.split('.') as [string, string];
  const cents = Number(whole) * 100 + Number(fraction);
  if (cents === 0) return 'zero';
  return priceToCents(value) === null ? 'shape' : 'ok';
}

/** Texto de edición de un override existente (`"85.00"` → `85.00`; `null` → vacío). */
export const overrideToInput = (priceOverride: string | null): string => priceOverride ?? '';

/** ¿Dos precios canónicos son iguales? (`null` = sin override). */
export const samePrice = (a: string | null, b: string | null): boolean => a === b;

/** ¿El override difiere del precio base (informativo: un override igual al base se conserva, ADR-0019)? */
export const overrideDiffersFromBase = (basePrice: string, priceOverride: string | null): boolean =>
  priceOverride !== null && priceOverride !== basePrice;
