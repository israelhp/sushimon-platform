import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { AuditValues } from '../audit/audit.service.js';
import { codedException } from '../common/errors/coded-exception.js';
import type {
  BranchProductRow,
  BranchProductStateView,
  ProductFacts,
} from './branch-products.types.js';

/** Reglas puras de precio y disponibilidad por sucursal: sin I/O (spec F13 D2, D3, D9, D10). */

export const PRICE_PATTERN = /^[0-9]{1,6}\.[0-9]{2}$/;
export const MAX_RESOLVE_IDS = 200;
export const MAX_VIOLATIONS = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

export const branchNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
export const productNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
export const busy = () =>
  codedException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'BRANCH_PRODUCTS_BUSY',
    'El catálogo se está modificando; reintenta en unos segundos',
  );
export const priceInvalid = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'BRANCH_PRICE_INVALID',
    'El precio de sucursal debe ser mayor que cero',
    [
      {
        path: 'priceOverride',
        code: 'BRANCH_PRICE_INVALID',
        message: 'El precio de sucursal debe ser mayor que cero',
      },
    ],
  );
export const branchNotAvailable = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'BRANCH_NOT_AVAILABLE',
    'Sucursal no disponible',
    [{ path: 'branchId', code: 'BRANCH_NOT_AVAILABLE', message: 'Sucursal no disponible' }],
  );

// ---------- precio ----------

/** `"85.00"` -> 8500 (enteros; sin floats). Solo para cadenas que ya cumplen `PRICE_PATTERN`. */
export const toCents = (price: string): number => {
  const [units, cents] = price.split('.') as [string, string];
  return Number(units) * 100 + Number(cents);
};

export const centsToPrice = (cents: number): string => {
  const whole = Math.floor(cents / 100);
  return `${whole}.${String(cents % 100).padStart(2, '0')}`;
};

/** Forma del cuerpo de pricing (400): `null` o cadena `^[0-9]{1,6}\.[0-9]{2}$`. */
export type PriceInput = { kind: 'clear' } | { kind: 'set'; cents: number };

export function parsePriceInput(value: unknown): PriceInput {
  if (value === null) return { kind: 'clear' };
  if (typeof value !== 'string' || !PRICE_PATTERN.test(value)) {
    throw new BadRequestException(['priceOverride debe ser null o una cadena decimal "85.00"']);
  }
  // El patrón (máx. 6 dígitos enteros) ya limita a 999999.99: no hace falta otra comprobación de tope.
  return { kind: 'set', cents: toCents(value) };
}

/** Regla de negocio (422): bien formado pero <= 0. Devuelve la cadena normalizada o `null` para borrar. */
export function normalizePriceOverride(input: PriceInput): string | null {
  if (input.kind === 'clear') return null;
  if (input.cents <= 0) throw priceInvalid();
  return centsToPrice(input.cents);
}

export const effectivePrice = (basePrice: string, override: string | null): string =>
  override ?? basePrice;

// ---------- estado ----------

export const DEFAULT_ROW: Readonly<{ priceOverride: null; available: true }> = {
  priceOverride: null,
  available: true,
};

/** ¿Qué sucede con la fila tras fijar el override? `null` = sin cambio (idempotente). */
export function planPricing(
  current: BranchProductRow | null,
  next: string | null,
): { action: 'price_set' | 'price_cleared'; oldPrice: string | null } | null {
  const old = current?.priceOverride ?? null;
  if (old === next) return null;
  return { action: next === null ? 'price_cleared' : 'price_set', oldPrice: old };
}

export function planAvailability(
  current: BranchProductRow | null,
  next: boolean,
): { oldAvailable: boolean } | null {
  const old = current?.available ?? true;
  return old === next ? null : { oldAvailable: old };
}

/** La fila solo existe si hay override o `available=false` (D2). */
export const isDefaultRow = (row: Pick<BranchProductRow, 'priceOverride' | 'available'>): boolean =>
  row.priceOverride === null && row.available;

export function stateView(
  branchId: string,
  product: ProductFacts,
  row: BranchProductRow | null,
  categoryVisible: boolean,
): BranchProductStateView {
  const priceOverride = row?.priceOverride ?? null;
  const available = row?.available ?? true;
  return {
    branchId,
    productId: product.id,
    basePrice: product.basePrice,
    priceOverride,
    effectivePrice: effectivePrice(product.basePrice, priceOverride),
    available,
    offered: product.active && categoryVisible && available,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

// ---------- auditoría (sin PII) ----------

export const priceAudit = (
  branchId: string,
  productId: string,
  oldPrice: string | null,
  newPrice: string | null,
): { oldValues: AuditValues; newValues: AuditValues } => ({
  oldValues: { branchId, productId, oldPrice },
  newValues: { branchId, productId, newPrice },
});

export const availabilityAudit = (
  branchId: string,
  productId: string,
  oldAvailable: boolean,
  newAvailable: boolean,
): { oldValues: AuditValues; newValues: AuditValues } => ({
  oldValues: { branchId, productId, oldAvailable },
  newValues: { branchId, productId, newAvailable },
});
