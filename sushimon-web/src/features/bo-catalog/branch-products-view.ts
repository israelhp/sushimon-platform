import { isApiError } from '@/lib/data-access/errors';
import type { AdminBranchProductState } from '@/lib/data-access/models';
import { parseOverrideInput } from '@/lib/branch-pricing-rules';
import { errorMessage } from '../bo-orders/error-message';
import { BUSY_MESSAGE } from './products-view';

/**
 * F13 — Lógica pura del backoffice de precio y disponibilidad por sucursal: mensajes por `code` y validación del campo
 * «Precio especial». Sin React ni red. El backoffice se muestra en español.
 */

export type BranchProductErrorKind =
  | 'priceInvalid'
  | 'busy'
  | 'branchNotFound'
  | 'productNotFound'
  | 'forbidden'
  | 'unauthorized'
  | 'badRequest'
  | 'other';

export interface BranchProductServerError {
  kind: BranchProductErrorKind;
  message: string;
  /** Hay que volver a pedir datos (la sucursal o el producto cambiaron en otra sesión). */
  reload: boolean;
}

const result = (
  kind: BranchProductErrorKind,
  message: string,
  reload = false,
): BranchProductServerError => ({ kind, message, reload });

/**
 * 422 `BRANCH_PRICE_INVALID` | 503 `BRANCH_PRODUCTS_BUSY` | 404 `BRANCH_NOT_FOUND` | 404 `PRODUCT_NOT_FOUND` | 400 | 401 | 403.
 * Se ramifica por `code`, nunca por el texto del servidor.
 */
export function branchProductServerError(error: unknown): BranchProductServerError {
  if (!isApiError(error)) return result('other', errorMessage(error));
  switch (error.businessCode) {
    case 'BRANCH_PRICE_INVALID':
      return result('priceInvalid', 'El precio especial debe ser mayor a 0 (por ejemplo 85.00).');
    case 'BRANCH_PRODUCTS_BUSY':
      return result('busy', BUSY_MESSAGE);
    case 'BRANCH_NOT_FOUND':
      return result(
        'branchNotFound',
        'La sucursal no existe o no tienes acceso a ella. Se recargaron los datos.',
        true,
      );
    case 'PRODUCT_NOT_FOUND':
      return result('productNotFound', 'El producto ya no existe. Se recargaron los datos.', true);
  }
  if (error.status === 401)
    return result('unauthorized', 'Tu sesión expiró. Vuelve a iniciar sesión.');
  if (error.status === 403) {
    return result('forbidden', 'No tienes permiso para esta acción en esa sucursal.');
  }
  if (error.status === 400) {
    return result('badRequest', 'Datos inválidos: revisa el precio (por ejemplo 85.00).');
  }
  return result('other', errorMessage(error));
}

export type OverrideDraft =
  { ok: true; priceOverride: string | null; changed: boolean } | { ok: false; message: string };

/** Valida el texto del campo contra el estado guardado. `changed=false` = nada que enviar. */
export function validateOverrideDraft(
  text: string,
  state: Pick<AdminBranchProductState, 'priceOverride'>,
): OverrideDraft {
  const parsed = parseOverrideInput(text);
  if (!parsed.ok) {
    return {
      ok: false,
      message:
        parsed.reason === 'zero'
          ? 'El precio especial debe ser mayor a 0.'
          : 'Escribe un importe válido (hasta 999999.99, con máximo 2 decimales).',
    };
  }
  return { ok: true, priceOverride: parsed.price, changed: parsed.price !== state.priceOverride };
}
