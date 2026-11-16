import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';
import {
  branchNotFound,
  busy,
  codeTaken,
  ctaInvalid,
  imageInvalid,
  periodInvalid,
  promotionInvalid,
} from './banner-policy.js';

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
 * - UNIQUE (P2002/23505) de `banners_code_key` (o el campo `code` en la forma de Prisma): 409 `BANNER_CODE_TAKEN`. Cualquier
 *   otra restricción única se devuelve tal cual.
 * - FK (P2003/23503) de una restricción CONOCIDA: imagen, destino de categoría/producto, promoción o sucursal
 *   desaparecidos por carrera. FK desconocida: tal cual.
 * - CHECK (P2004/23514) de periodo o de referencias del CTA (carrera con datos ya validados). Otro CHECK: tal cual.
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
  if (found.includes('P2002') || found.includes('23505')) {
    const target = uniqueTarget(error) ?? '';
    return names(text, 'banners_code_key') || /^\[\s*\[?\s*"code"\s*\]?\s*\]$/.test(target)
      ? codeTaken()
      : error;
  }
  if (found.includes('P2003') || found.includes('23503')) {
    if (names(text, 'banners_image_asset_id_fkey')) return imageInvalid('ASSET_UNKNOWN');
    if (names(text, 'banners_cta_category_id_fkey') || names(text, 'banners_cta_product_id_fkey'))
      return ctaInvalid([
        { path: 'cta', code: 'TARGET_UNKNOWN', message: 'El destino del banner no existe' },
      ]);
    if (names(text, 'banners_promotion_id_fkey')) return promotionInvalid('PROMOTION_UNKNOWN');
    if (names(text, 'banner_branches_branch_id_fkey')) return branchNotFound();
    return error;
  }
  if (found.includes('P2004') || found.includes('23514')) {
    if (names(text, 'banners_period_chk')) return periodInvalid();
    if (names(text, 'banners_cta_refs_chk') || names(text, 'banners_cta_page_chk'))
      return ctaInvalid([
        { path: 'cta', code: 'FIELD_MISMATCH', message: 'Destino incoherente con el tipo' },
      ]);
    return error;
  }
  return error;
}
