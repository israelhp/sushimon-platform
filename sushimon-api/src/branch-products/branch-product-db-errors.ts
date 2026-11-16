import { BadRequestException } from '@nestjs/common';
import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';
import { branchNotFound, busy, productNotFound } from './branch-product-policy.js';

const textOf = (error: unknown): string => {
  const parts: string[] = [];
  const e = error as {
    message?: unknown;
    meta?: { message?: unknown };
    cause?: { message?: unknown };
  };
  for (const m of [e?.message, e?.meta?.message, e?.cause?.message])
    if (typeof m === 'string') parts.push(m);
  return `${parts.join(' ')} ${uniqueTarget(error) ?? ''}`;
};

/**
 * Red de seguridad: traduce errores de BD esperables a HTTP; devuelve el MISMO error si no son del dominio
 * (=> 500 genérico, sin detalles).
 * - P2028/55P03/40P01/40001: 503 `BRANCH_PRODUCTS_BUSY` (mensaje fijo, reintentable).
 * - FK (P2003/23503) por carrera: `branch_products_branch_id_fkey` => 404 `BRANCH_NOT_FOUND`;
 *   `branch_products_product_id_fkey` => 404 `PRODUCT_NOT_FOUND`; otra => se devuelve tal cual.
 * - CHECK (P2004/23514): 400 genérico (la forma ya se valida antes; es el respaldo de la BD).
 */
export function translateBranchProductDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  const found = codes(error);
  if (
    found.includes('55P03') ||
    found.includes('P2028') ||
    found.includes('40P01') ||
    found.includes('40001')
  )
    return busy();
  if (found.includes('P2003') || found.includes('23503')) {
    const text = textOf(error);
    if (/branch_products_branch_id_fkey/.test(text)) return branchNotFound();
    if (/branch_products_product_id_fkey/.test(text)) return productNotFound();
    return error;
  }
  if (found.includes('P2004') || found.includes('23514')) {
    return new BadRequestException(['Datos inválidos']);
  }
  return error;
}
