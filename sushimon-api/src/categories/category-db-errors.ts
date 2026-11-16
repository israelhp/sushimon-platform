import { BadRequestException, HttpStatus } from '@nestjs/common';
import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';
import { codedException } from '../common/errors/coded-exception.js';
import { slugTaken } from './category-policy.js';

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

const isSlugTarget = (error: unknown): boolean => {
  const target = uniqueTarget(error);
  return target !== null && /slug/i.test(target);
};

/**
 * Red de seguridad: traduce errores de BD esperables a HTTP; devuelve el mismo error si no son del dominio
 * (→ 500 genérico). La API ya valida bajo el bloqueo de jerarquía; esto cubre carreras con escritores que no lo toman.
 * - UNIQUE (P2002/23505): 409 `CATEGORY_SLUG_TAKEN` solo si el objetivo es `slug` (columna o `categories_slug_key`).
 * - P2028/55P03: 503 `CATEGORIES_BUSY` (mensaje fijo, reintentable).
 * - Trigger (23514): `categories_parent_cycle` → 422 `CATEGORY_CYCLE`; `categories_max_depth` → 422
 *   `CATEGORY_DEPTH_EXCEEDED`. Otro CHECK (P2004/23514): 400 genérico (no se filtra el nombre de la restricción).
 */
export function translateCategoryDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  const found = codes(error);
  // Espera del lock agotada (lock_timeout, 55P03) o transacción interactiva sin tiempo/conexión (P2028): reintentable.
  if (found.includes('55P03') || found.includes('P2028')) {
    return codedException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'CATEGORIES_BUSY',
      'Las categorías se están modificando; reintenta en unos segundos',
    );
  }
  if (found.includes('P2002') || found.includes('23505')) {
    // Solo el UNIQUE de slug es un 409; cualquier otro (o un objetivo desconocido) NO se disfraza: 500 genérico.
    return isSlugTarget(error) ? slugTaken() : error;
  }
  if (
    found.includes('P2004') ||
    found.includes('23514') ||
    /categories_(parent_cycle|max_depth)/.test(messageOf(error))
  ) {
    const text = messageOf(error);
    if (/categories_parent_cycle/.test(text))
      return codedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CATEGORY_CYCLE',
        'Una categoría no puede ser hija de sí misma ni de sus descendientes',
      );
    if (/categories_max_depth/.test(text))
      return codedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CATEGORY_DEPTH_EXCEEDED',
        'El menú admite como máximo 3 niveles de categorías',
      );
    return new BadRequestException(['Datos inválidos']);
  }
  return error;
}
