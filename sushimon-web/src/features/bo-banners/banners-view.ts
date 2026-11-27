import { BANNER_LIMIT, bannerAltProblem, cleanAlt } from '@/lib/banner-rules';
import { isApiError } from '@/lib/data-access/errors';
import type { AdminBanner, StoreBanner, UpdateBannerRequest } from '@/lib/data-access/models';
import { errorMessage } from '@/features/bo-orders/error-message';
import type { CreateBannerInput } from '@/services/banners';

/**
 * F16 (simplificado, ADR-0033) — Lógica PURA del backoffice de banners: formulario (valores → petición), validación previa, tope de 5,
 * vista previa y errores del servidor por `code`. Sin React ni red. El servidor decide siempre; esta validación solo avisa antes de
 * enviar y usa las MISMAS reglas (`lib/banner-rules`) que el adaptador mock. Un banner = imagen + texto alternativo + activo.
 */

/** Imagen elegida: el asset `READY` de la biblioteca y, si se acaba de subir, la vista previa local. */
export interface ImageValue {
  assetId: string;
  /** URL pública (la simulada `*.invalid` nunca se pide por red). */
  url: string | null;
  mimeType: string;
  sizeBytes: number;
  /** `blob:` local de lo recién subido o elegido en esta sesión (tiene prioridad al mostrar). */
  previewSrc?: string | null;
}

export interface BannerFormValues {
  image: ImageValue | null;
  imageAlt: string;
  active: boolean;
}

export type BannerField = 'image' | 'imageAlt';

export const emptyBannerForm = (): BannerFormValues => ({
  image: null,
  imageAlt: '',
  active: true,
});

/** Detalle del servidor → valores del formulario. */
export function bannerToForm(b: AdminBanner): BannerFormValues {
  return {
    image: {
      assetId: b.image.assetId,
      url: b.image.url,
      mimeType: b.image.mimeType,
      sizeBytes: b.image.sizeBytes,
    },
    imageAlt: b.imageAlt,
    active: b.active,
  };
}

// ── Tope de 5 ──────────────────────────────────────────────────────────────────────────────

/** ¿Se puede crear otro? (activos + inactivos < 5). */
export const canAddBanner = (count: number): boolean => count < BANNER_LIMIT;

// ── Validación previa ──────────────────────────────────────────────────────────────────────

export type BannerFieldProblem = 'imageRequired' | 'altEmpty' | 'altTooLong' | 'altChars';

export interface BannerFormProblem {
  field: BannerField;
  problem: BannerFieldProblem;
}

/** Mismos criterios que el servidor (400 por longitud, 422 por blanco/caracteres); el servidor sigue decidiendo. */
export function validateBannerForm(v: BannerFormValues): BannerFormProblem[] {
  const out: BannerFormProblem[] = [];
  if (!v.image) out.push({ field: 'image', problem: 'imageRequired' });
  const alt = bannerAltProblem(v.imageAlt);
  if (alt) {
    out.push({
      field: 'imageAlt',
      problem: alt === 'empty' ? 'altEmpty' : alt === 'tooLong' ? 'altTooLong' : 'altChars',
    });
  }
  return out;
}

// ── Formulario → petición ──────────────────────────────────────────────────────────────────

/** Alta: lo ya validado → petición del contrato. */
export function toCreateRequest(v: BannerFormValues): CreateBannerInput {
  return {
    imageAssetId: (v.image as ImageValue).assetId,
    imageAlt: cleanAlt(v.imageAlt) as string,
    active: v.active,
  };
}

/** Edición: solo lo que cambió, con `expectedVersion`. `null` si no cambió nada. */
export function toUpdateRequest(
  v: BannerFormValues,
  current: AdminBanner,
): UpdateBannerRequest | null {
  const patch: UpdateBannerRequest = { expectedVersion: current.version };
  let changed = false;
  if (v.image && v.image.assetId !== current.image.assetId) {
    patch.imageAssetId = v.image.assetId;
    changed = true;
  }
  const alt = cleanAlt(v.imageAlt);
  if (alt !== null && alt !== current.imageAlt) {
    patch.imageAlt = alt;
    changed = true;
  }
  if (v.active !== current.active) {
    patch.active = v.active;
    changed = true;
  }
  return changed ? patch : null;
}

// ── Vista previa (sin publicar) ────────────────────────────────────────────────────────────

/** El banner tal como lo vería la tienda; `null` si aún falta la imagen. */
export function previewBanner(
  v: BannerFormValues,
): (Pick<StoreBanner, 'alt'> & { image: { url: string | null } }) | null {
  if (!v.image) return null;
  return { image: { url: v.image.url }, alt: cleanAlt(v.imageAlt) ?? '' };
}

// ── Errores del servidor ───────────────────────────────────────────────────────────────────

export type BannerErrorKind =
  | 'limitReached'
  | 'versionConflict'
  | 'imageInvalid'
  | 'altInvalid'
  | 'notFound'
  | 'busy'
  | 'invalid'
  | 'forbidden'
  | 'unauthorized'
  | 'other';

export interface BannerServerError {
  kind: BannerErrorKind;
  message: string;
  field?: BannerField;
  /** Hay que volver a pedir datos (el banner cambió, ya no existe o ya hay 5). */
  reload: boolean;
}

const out = (
  kind: BannerErrorKind,
  message: string,
  field?: BannerField,
  reload = false,
): BannerServerError => ({ kind, message, field, reload });

export const BUSY_MESSAGE = 'Hay otra edición en curso. Espera un momento y reintenta.';

/**
 * 403 (permiso, alcance o aal2); 404 `BANNER_NOT_FOUND`; 409 `BANNER_VERSION_CONFLICT` | `BANNER_LIMIT_REACHED`; 422
 * `BANNER_IMAGE_INVALID` | `BANNER_ALT_INVALID`; 503 `BANNERS_BUSY`; 400, 401. Se ramifica por `businessCode`, nunca por el texto.
 */
export function bannerServerError(error: unknown): BannerServerError {
  if (!isApiError(error)) return out('other', errorMessage(error));
  switch (error.businessCode) {
    case 'BANNER_LIMIT_REACHED':
      return out(
        'limitReached',
        `Ya hay ${BANNER_LIMIT} banners. Elimina uno antes de agregar otro.`,
        undefined,
        true,
      );
    case 'BANNER_VERSION_CONFLICT':
      return out(
        'versionConflict',
        'Otra persona modificó este banner mientras lo editabas. Se cargó la versión actual: revisa y vuelve a intentarlo.',
        undefined,
        true,
      );
    case 'BANNER_IMAGE_INVALID':
      return out(
        'imageInvalid',
        'La imagen elegida ya no es válida (no existe, no está confirmada o no es de banner). Elige o sube otra.',
        'image',
      );
    case 'BANNER_ALT_INVALID':
      return out(
        'altInvalid',
        'El texto alternativo no es válido: descríbelo con 1 a 120 caracteres, sin caracteres de control.',
        'imageAlt',
      );
    case 'BANNER_NOT_FOUND':
      return out('notFound', 'El banner ya no existe. Se recargó la lista.', undefined, true);
    case 'BANNERS_BUSY':
      return out('busy', BUSY_MESSAGE);
  }
  if (error.status === 400) return out('invalid', 'Revisa los datos del formulario.');
  if (error.status === 401)
    return out('unauthorized', 'Tu sesión expiró. Vuelve a iniciar sesión.');
  if (error.status === 403) return out('forbidden', 'No tienes permiso para esta acción.');
  return out('other', errorMessage(error));
}
