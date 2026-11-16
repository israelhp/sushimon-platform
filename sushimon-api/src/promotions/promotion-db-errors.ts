import { BadRequestException } from '@nestjs/common';
import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';
import { branchNotFound, busy, codeTaken, scopeInvalid } from './promotion-policy.js';
import { codedException } from '../common/errors/coded-exception.js';
import { HttpStatus } from '@nestjs/common';

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
 * - P2028/55P03/40P01/40001: 503 `PROMOTIONS_BUSY` (mensaje fijo, reintentable).
 * - UNIQUE (P2002/23505) de `promotions_code_key`/`code`: 409 `PROMOTION_CODE_TAKEN`; otro objetivo => se devuelve tal cual.
 * - FK (P2003/23503): sucursal inexistente por carrera => 404 `BRANCH_NOT_FOUND`; producto => 422 `PROMOTION_SCOPE_INVALID`.
 * - EXCLUDE (23P01) de tramos => 422 `PROMOTION_SCHEDULE_INVALID` (la API ya valida solapes; es el respaldo de la BD).
 * - CHECK (P2004/23514): 400 genérico.
 */
export function translatePromotionDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  const found = codes(error);
  if (
    found.includes('55P03') ||
    found.includes('P2028') ||
    found.includes('40P01') ||
    found.includes('40001')
  )
    return busy();
  if (found.includes('P2002') || found.includes('23505')) {
    // SOLO la restricción UNIQUE de `code` (objetivo exacto); cualquier otro P2002 se devuelve tal cual (=> 500).
    const target = uniqueTarget(error) ?? '';
    return /promotions_code_key/.test(target) || /\[\s*"code"\s*\]/.test(target)
      ? codeTaken()
      : error;
  }
  if (found.includes('P2003') || found.includes('23503')) {
    const text = textOf(error);
    if (/promotion_branches_branch_id_fkey|branch_id/.test(text)) return branchNotFound();
    if (/promotion_products_product_id_fkey|product_id/.test(text))
      return scopeInvalid([
        { path: 'productIds', code: 'PRODUCT_UNKNOWN', message: 'Producto inexistente' },
      ]);
    return error;
  }
  if (found.includes('23P01')) {
    return codedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'PROMOTION_SCHEDULE_INVALID',
      'Horario semanal inválido',
      [{ path: 'schedule', code: 'SLOT_OVERLAP', message: 'Hay tramos solapados' }],
    );
  }
  if (found.includes('P2004') || found.includes('23514')) {
    return new BadRequestException(['Datos inválidos']);
  }
  return error;
}
