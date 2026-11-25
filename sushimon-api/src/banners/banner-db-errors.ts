import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';
import { busy, imageInvalid, limitReached } from './banner-policy.js';

/** Texto donde Prisma/pg dejan el nombre de la restricción (mensaje, meta, causa y objetivo). */
const textOf = (error: unknown): string => {
  const parts: string[] = [];
  const e = error as {
    message?: unknown;
    meta?: { message?: unknown; field_name?: unknown; constraint?: unknown };
    cause?: { message?: unknown; constraint?: unknown };
    constraint?: unknown;
  };
  for (const m of [
    e?.message,
    e?.meta?.message,
    e?.meta?.field_name,
    e?.meta?.constraint,
    e?.cause?.message,
    e?.cause?.constraint,
    e?.constraint,
  ])
    if (typeof m === 'string') parts.push(m);
  return `${parts.join(' ')} ${uniqueTarget(error) ?? ''}`;
};

/** ¿Aparece EXACTAMENTE ese nombre de restricción (delimitado) en el texto? Sin regex amplio. */
const names = (text: string, constraint: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_])${constraint}(?![A-Za-z0-9_])`).test(text);

/**
 * Red de seguridad: traduce SOLO errores de BD esperables a HTTP; devuelve el MISMO error si no son del dominio
 * (=> 500 genérico, sin detalles).
 * - P2028/55P03/40P01/40001: 503 `BANNERS_BUSY` (mensaje fijo, reintentable).
 * - Trigger de tope (0023): SQLSTATE 23514 con mensaje y CONSTRAINT `banners_max_count`: 409 `BANNER_LIMIT_REACHED`. Se
 *   clasifica por NOMBRE (mensaje/constraint), no solo por SQLSTATE: el adaptador puede envolverlo (p. ej. P2010).
 * - FK (P2003/23503) `banners_image_asset_id_fkey`: la imagen desapareció por carrera => 422 `BANNER_IMAGE_INVALID`.
 *   Cualquier otra restricción se devuelve tal cual.
 */
export function translateBannerDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  const found = codes(error);
  if (
    found.includes('55P03') ||
    found.includes('P2028') ||
    found.includes('40P01') ||
    found.includes('40001')
  )
    return busy();
  const text = textOf(error);
  if (names(text, 'banners_max_count')) return limitReached();
  if (
    (found.includes('P2003') || found.includes('23503')) &&
    names(text, 'banners_image_asset_id_fkey')
  )
    return imageInvalid('ASSET_UNKNOWN');
  return error;
}
