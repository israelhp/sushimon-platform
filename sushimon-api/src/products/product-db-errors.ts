import { BadRequestException, HttpStatus } from '@nestjs/common';
import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';
import { codedException } from '../common/errors/coded-exception.js';
import { categoryInvalid, skuTaken, slugTaken } from './product-policy.js';

const messageOf = (error: unknown): string => {
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
 * (→ 500 genérico, sin detalles). La unicidad la garantizan los índices únicos (sin advisory lock).
 * - UNIQUE (P2002/23505): 409 `PRODUCT_SLUG_TAKEN` / `PRODUCT_SKU_TAKEN` según el OBJETIVO (columna o
 *   `products_slug_key` / `products_sku_key`); otro objetivo (p. ej. `product_media_product_sort_key`) o
 *   desconocido => 500.
 * - P2028/55P03: 503 `PRODUCTS_BUSY` (mensaje fijo, reintentable).
 * - FK de categoría (P2003/23503, `products_category_id_fkey`): 422 `PRODUCT_CATEGORY_INVALID`.
 * - Trigger `product_media_max_items` (23514): 422 `PRODUCT_MEDIA_INVALID`. Otro CHECK (P2004/23514): 400 genérico.
 */
export function translateProductDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  const found = codes(error);
  if (found.includes('55P03') || found.includes('P2028')) {
    return codedException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'PRODUCTS_BUSY',
      'El catálogo se está modificando; reintenta en unos segundos',
    );
  }
  if (found.includes('P2002') || found.includes('23505')) {
    const target = uniqueTarget(error) ?? '';
    if (/slug/i.test(target) && !/sku/i.test(target)) return slugTaken();
    if (/sku/i.test(target) && !/slug/i.test(target)) return skuTaken();
    return error;
  }
  if (found.includes('P2003') || found.includes('23503')) {
    return /products_category_id_fkey|category_id/.test(messageOf(error))
      ? categoryInvalid('La categoría no existe o no está activa')
      : error;
  }
  if (found.includes('P2004') || found.includes('23514')) {
    if (/product_media_max_items/.test(messageOf(error)))
      return codedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PRODUCT_MEDIA_INVALID',
        'Un producto admite como máximo 8 imágenes',
      );
    return new BadRequestException(['Datos inválidos']);
  }
  return error;
}
