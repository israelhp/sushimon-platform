import {
  BANNER_ALT_MAX,
  BANNER_BRANCHES_MAX,
  BANNER_CODE_PATTERN,
  BANNER_CTA_LABEL_MAX,
  BANNER_SORT_MAX,
  BANNER_SUBTITLE_MAX,
  BANNER_TITLE_MAX,
  cleanText,
  hasDisallowedBannerChars,
  isBannerPage,
  normalizeBannerCode,
  resolveTexts,
  type BannerTexts,
} from '@/lib/banner-rules';
import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminBanner,
  BannerCtaInput,
  BannerCtaType,
  BannerLifecycle,
  BannerLocale,
  BannerPage,
  BannerTranslationInput,
  PromotionScope,
  StoreBanner,
  UpdateBannerRequest,
} from '@/lib/data-access/models';
import { isoToLocalInput, localInputToIso } from '@/lib/time';
import { errorMessage } from '@/features/bo-orders/error-message';
import type { AdminBannerFilters, CreateBannerInput } from '@/services/banners';

/**
 * F16 — Lógica PURA del backoffice de banners: filtros del listado, formulario (valores → petición), validación previa, vista previa
 * y errores del servidor por `code`. Sin React ni red. El servidor decide siempre; esta validación solo avisa antes de enviar y usa
 * las MISMAS reglas (`lib/banner-rules`) que el adaptador mock. Instantes ISO con zona; el formulario captura fecha y hora LOCALES de
 * Guatemala (`datetime-local`). El CTA es estructurado: jamás una ruta ni una URL de texto libre.
 */

export const BANNER_CTA_OPTIONS: readonly BannerCtaType[] = [
  'NONE',
  'MENU',
  'PROMOTIONS',
  'CATEGORY',
  'PRODUCT',
  'PAGE',
];
export const BANNER_PAGE_OPTIONS: readonly BannerPage[] = ['CAREERS', 'TRACK_ORDER', 'INCIDENTS'];
export const LIFECYCLE_FILTERS: readonly BannerLifecycle[] = [
  'PUBLISHED',
  'SCHEDULED',
  'INACTIVE',
  'EXPIRED',
];

// ── Filtros del listado ────────────────────────────────────────────────────────────────────

export interface BannerFilterValues {
  q: string;
  branchId: string;
  lifecycle: BannerLifecycle | 'all';
}

export const EMPTY_FILTERS: BannerFilterValues = { q: '', branchId: 'all', lifecycle: 'all' };

export const hasActiveFilters = (f: BannerFilterValues): boolean =>
  f.q.trim() !== '' || f.branchId !== 'all' || f.lifecycle !== 'all';

/** Filtros de la pantalla → consulta del contrato (orden por prioridad, el mismo de la tienda). */
export function filtersToQuery(
  f: BannerFilterValues,
  page: number,
  pageSize: number,
): AdminBannerFilters {
  return {
    q: f.q.trim() || undefined,
    branchId: f.branchId === 'all' ? undefined : f.branchId,
    lifecycle: f.lifecycle === 'all' ? undefined : f.lifecycle,
    sort: 'priority',
    order: 'asc',
    page,
    pageSize,
  };
}

// ── Formulario ─────────────────────────────────────────────────────────────────────────────

export interface TextValues {
  title: string;
  subtitle: string;
  ctaLabel: string;
  imageAlt: string;
}

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
  code: string;
  image: ImageValue | null;
  es: TextValues;
  en: TextValues;
  ctaType: BannerCtaType;
  categoryId: string;
  productId: string;
  page: BannerPage | '';
  /** `datetime-local` en hora de Guatemala (`YYYY-MM-DDTHH:mm`); vacío = sin extremo. */
  startsAt: string;
  endsAt: string;
  branchScope: PromotionScope;
  branchIds: string[];
  /** Vacío = sin promoción vinculada. */
  promotionId: string;
  /** Vacío = al final (alta) / sin cambio (edición). */
  sortOrder: string;
  active: boolean;
}

export const EMPTY_TEXTS: TextValues = { title: '', subtitle: '', ctaLabel: '', imageAlt: '' };

export function emptyBannerForm(global: boolean): BannerFormValues {
  return {
    code: '',
    image: null,
    es: { ...EMPTY_TEXTS },
    en: { ...EMPTY_TEXTS },
    ctaType: 'MENU',
    categoryId: '',
    productId: '',
    page: '',
    startsAt: '',
    endsAt: '',
    branchScope: global ? 'ALL' : 'SELECTED',
    branchIds: [],
    promotionId: '',
    sortOrder: '',
    active: true,
  };
}

const textValues = (t: BannerTranslationInput | null | undefined): TextValues => ({
  title: t?.title ?? '',
  subtitle: t?.subtitle ?? '',
  ctaLabel: t?.ctaLabel ?? '',
  imageAlt: t?.imageAlt ?? '',
});

export function bannerToForm(b: AdminBanner): BannerFormValues {
  return {
    code: b.code,
    image: {
      assetId: b.image.assetId,
      url: b.image.url,
      mimeType: b.image.mimeType,
      sizeBytes: b.image.sizeBytes,
    },
    es: textValues(b.translations.es),
    en: textValues(b.translations.en),
    ctaType: b.cta.type,
    categoryId: b.cta.categoryId ?? '',
    productId: b.cta.productId ?? '',
    page: b.cta.page ?? '',
    startsAt: b.startsAt ? isoToLocalInput(b.startsAt) : '',
    endsAt: b.endsAt ? isoToLocalInput(b.endsAt) : '',
    branchScope: b.branchScope,
    branchIds: b.branches.map((x) => x.id),
    promotionId: b.promotion?.id ?? '',
    sortOrder: String(b.sortOrder),
    active: b.active,
  };
}

export type BannerField =
  | 'code'
  | 'image'
  | 'esTitle'
  | 'esSubtitle'
  | 'esCtaLabel'
  | 'esImageAlt'
  | 'enTitle'
  | 'enSubtitle'
  | 'enCtaLabel'
  | 'enImageAlt'
  | 'cta'
  | 'startsAt'
  | 'endsAt'
  | 'branches'
  | 'promotion'
  | 'sortOrder';

export interface BannerFormError {
  field: BannerField;
  message: string;
}

export const MESSAGES = {
  code: 'El código admite de 3 a 64 caracteres en minúsculas: letras, números o guion, sin empezar por guion.',
  image: 'Elige o sube una imagen para el banner.',
  esTitle: `El título en español es obligatorio (1 a ${BANNER_TITLE_MAX} caracteres).`,
  esImageAlt: `El texto alternativo en español es obligatorio (1 a ${BANNER_ALT_MAX} caracteres).`,
  title: `El título admite hasta ${BANNER_TITLE_MAX} caracteres.`,
  subtitle: `El subtítulo admite hasta ${BANNER_SUBTITLE_MAX} caracteres.`,
  ctaLabel: `El texto del botón admite hasta ${BANNER_CTA_LABEL_MAX} caracteres.`,
  imageAlt: `El texto alternativo admite hasta ${BANNER_ALT_MAX} caracteres.`,
  chars: 'El texto contiene caracteres no permitidos.',
  ctaCategory: 'Elige la categoría de destino.',
  ctaProduct: 'Elige el producto de destino.',
  ctaPage: 'Elige la página de destino.',
  startsAt: 'La fecha de inicio no es válida.',
  endsAt: 'La fecha de fin no es válida.',
  period: 'El fin debe ser posterior al inicio.',
  branches: 'Elige al menos una sucursal.',
  branchesMax: `Elige hasta ${BANNER_BRANCHES_MAX} sucursales o usa «Todas».`,
  sortOrder: `La prioridad es un número entero entre 0 y ${BANNER_SORT_MAX}.`,
} as const;

const SORT_PATTERN = /^\d{1,4}$/;

function textErrors(
  prefix: 'es' | 'en',
  v: TextValues,
  add: (field: BannerField, message: string) => void,
): void {
  const key = (name: string) => `${prefix}${name}` as BannerField;
  const limits: [keyof TextValues, string, number, string][] = [
    ['title', 'Title', BANNER_TITLE_MAX, MESSAGES.title],
    ['subtitle', 'Subtitle', BANNER_SUBTITLE_MAX, MESSAGES.subtitle],
    ['ctaLabel', 'CtaLabel', BANNER_CTA_LABEL_MAX, MESSAGES.ctaLabel],
    ['imageAlt', 'ImageAlt', BANNER_ALT_MAX, MESSAGES.imageAlt],
  ];
  for (const [field, suffix, max, message] of limits) {
    const value = v[field].trim();
    if (value.length > max) add(key(suffix), message);
    else if (hasDisallowedBannerChars(value)) add(key(suffix), MESSAGES.chars);
  }
}

/** Mismas reglas que el servidor (forma y rangos) para avisar antes de enviar. `editing` = el código no se valida (inmutable). */
export function validateBannerForm(v: BannerFormValues, editing: boolean): BannerFormError[] {
  const errors: BannerFormError[] = [];
  const add = (field: BannerField, message: string) => errors.push({ field, message });
  if (!editing && !BANNER_CODE_PATTERN.test(normalizeBannerCode(v.code)))
    add('code', MESSAGES.code);
  if (!v.image) add('image', MESSAGES.image);
  if (cleanText(v.es.title) === null) add('esTitle', MESSAGES.esTitle);
  if (cleanText(v.es.imageAlt) === null) add('esImageAlt', MESSAGES.esImageAlt);
  textErrors('es', v.es, (f, m) => {
    if (!errors.some((e) => e.field === f)) add(f, m);
  });
  textErrors('en', v.en, add);
  if (v.ctaType === 'CATEGORY' && v.categoryId === '') add('cta', MESSAGES.ctaCategory);
  if (v.ctaType === 'PRODUCT' && v.productId === '') add('cta', MESSAGES.ctaProduct);
  if (v.ctaType === 'PAGE' && !isBannerPage(v.page)) add('cta', MESSAGES.ctaPage);
  const start = v.startsAt === '' ? null : localInputToIso(v.startsAt);
  const end = v.endsAt === '' ? null : localInputToIso(v.endsAt);
  if (v.startsAt !== '' && !start) add('startsAt', MESSAGES.startsAt);
  if (v.endsAt !== '' && !end) add('endsAt', MESSAGES.endsAt);
  if (start && end && Date.parse(end) <= Date.parse(start)) add('endsAt', MESSAGES.period);
  if (v.branchScope === 'SELECTED') {
    if (v.branchIds.length === 0) add('branches', MESSAGES.branches);
    else if (v.branchIds.length > BANNER_BRANCHES_MAX) add('branches', MESSAGES.branchesMax);
  }
  if (v.sortOrder.trim() !== '') {
    const n = Number(v.sortOrder.trim());
    if (!SORT_PATTERN.test(v.sortOrder.trim()) || n > BANNER_SORT_MAX) {
      add('sortOrder', MESSAGES.sortOrder);
    }
  }
  return errors;
}

// ── Formulario → petición ──────────────────────────────────────────────────────────────────

/** `null` = nada que enviar en ese idioma. */
function translationBody(v: TextValues): BannerTranslationInput {
  return {
    title: cleanText(v.title),
    subtitle: cleanText(v.subtitle),
    ctaLabel: cleanText(v.ctaLabel),
    imageAlt: cleanText(v.imageAlt),
  };
}

const hasContent = (t: BannerTranslationInput) =>
  Boolean(t.title || t.subtitle || t.ctaLabel || t.imageAlt);

/** Solo el campo que corresponde al tipo (el servidor rechaza combinaciones incoherentes). */
export function ctaBody(v: BannerFormValues): BannerCtaInput {
  switch (v.ctaType) {
    case 'CATEGORY':
      return { type: 'CATEGORY', categoryId: v.categoryId };
    case 'PRODUCT':
      return { type: 'PRODUCT', productId: v.productId };
    case 'PAGE':
      return { type: 'PAGE', page: v.page as BannerPage };
    default:
      return { type: v.ctaType };
  }
}

const instantOrNull = (local: string): string | null =>
  local.trim() === '' ? null : localInputToIso(local);

/** Alta: lo ya validado → petición del contrato. */
export function toCreateRequest(v: BannerFormValues): CreateBannerInput {
  const en = translationBody(v.en);
  const startsAt = instantOrNull(v.startsAt);
  const endsAt = instantOrNull(v.endsAt);
  return {
    code: normalizeBannerCode(v.code),
    imageAssetId: (v.image as ImageValue).assetId,
    translations: {
      es: translationBody(v.es),
      ...(hasContent(en) ? { en } : {}),
    },
    cta: ctaBody(v),
    branchScope: v.branchScope,
    ...(v.branchScope === 'SELECTED' ? { branchIds: v.branchIds } : {}),
    ...(v.promotionId ? { promotionId: v.promotionId } : {}),
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    ...(v.sortOrder.trim() !== '' ? { sortOrder: Number(v.sortOrder.trim()) } : {}),
    active: v.active,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

const sameInstant = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));

const TEXT_FIELDS = ['title', 'subtitle', 'ctaLabel', 'imageAlt'] as const;

/** Parche de UN idioma: solo los campos distintos (`null` = borrar un opcional). */
function patchOf(
  next: BannerTranslationInput,
  current: BannerTranslationInput | null,
): BannerTranslationInput | null {
  const out: BannerTranslationInput = {};
  let changed = false;
  for (const field of TEXT_FIELDS) {
    const before = cleanText(current?.[field]);
    if (next[field] !== before) {
      out[field] = next[field];
      changed = true;
    }
  }
  return changed ? out : null;
}

/**
 * Edición: SOLO lo que cambió + `expectedVersion`; `null` si nada cambió (no se envía: el PATCH exige al menos un campo). `code` y
 * `active` no se envían nunca (inmutable / endpoint de estado). Texto por idioma y por campo; `en: null` elimina el inglés.
 */
export function toUpdateRequest(
  v: BannerFormValues,
  current: AdminBanner,
): UpdateBannerRequest | null {
  const patch: UpdateBannerRequest = { expectedVersion: current.version };
  let changed = false;
  const mark = () => {
    changed = true;
  };
  if (v.image && v.image.assetId !== current.image.assetId) {
    patch.imageAssetId = v.image.assetId;
    mark();
  }
  const translations: NonNullable<UpdateBannerRequest['translations']> = {};
  const esPatch = patchOf(translationBody(v.es), current.translations.es);
  if (esPatch) translations.es = esPatch;
  const enNext = translationBody(v.en);
  if (!hasContent(enNext)) {
    // Sin ningún texto en inglés: solo se envía `en: null` si de verdad había uno que borrar.
    if (current.translations.en) translations.en = null;
  } else {
    const enPatch = patchOf(enNext, current.translations.en);
    if (enPatch) translations.en = enPatch;
  }
  if (Object.keys(translations).length > 0) {
    patch.translations = translations;
    mark();
  }
  const cta = ctaBody(v);
  const cc = current.cta;
  if (
    cta.type !== cc.type ||
    (cta.categoryId ?? null) !== cc.categoryId ||
    (cta.productId ?? null) !== cc.productId ||
    (cta.page ?? null) !== cc.page
  ) {
    patch.cta = cta;
    mark();
  }
  const currentBranches = current.branches.map((b) => b.id);
  if (
    v.branchScope !== current.branchScope ||
    (v.branchScope === 'SELECTED' && !sameSet(v.branchIds, currentBranches))
  ) {
    patch.branchScope = v.branchScope;
    if (v.branchScope === 'SELECTED') patch.branchIds = v.branchIds;
    mark();
  }
  const promotionId = v.promotionId === '' ? null : v.promotionId;
  if (promotionId !== (current.promotion?.id ?? null)) {
    patch.promotionId = promotionId;
    mark();
  }
  const startsAt = instantOrNull(v.startsAt);
  if (!sameInstant(startsAt, current.startsAt)) {
    patch.startsAt = startsAt;
    mark();
  }
  const endsAt = instantOrNull(v.endsAt);
  if (!sameInstant(endsAt, current.endsAt)) {
    patch.endsAt = endsAt;
    mark();
  }
  if (v.sortOrder.trim() !== '' && Number(v.sortOrder.trim()) !== current.sortOrder) {
    patch.sortOrder = Number(v.sortOrder.trim());
    mark();
  }
  return changed ? patch : null;
}

// ── Vista previa (sin publicar) ────────────────────────────────────────────────────────────

/**
 * El banner tal como lo vería la tienda en `locale`: mismo respaldo POR CAMPO a español que el servidor
 * (`resolveTexts`), con la imagen elegida. `null` si falta el título o el texto alternativo en español.
 */
export function previewBanner(v: BannerFormValues, locale: BannerLocale): StoreBanner | null {
  const es: BannerTexts = {
    title: cleanText(v.es.title),
    subtitle: cleanText(v.es.subtitle),
    ctaLabel: cleanText(v.es.ctaLabel),
    imageAlt: cleanText(v.es.imageAlt),
  };
  const en: BannerTexts = {
    title: cleanText(v.en.title),
    subtitle: cleanText(v.en.subtitle),
    ctaLabel: cleanText(v.en.ctaLabel),
    imageAlt: cleanText(v.en.imageAlt),
  };
  const texts = resolveTexts(es, en, locale);
  if (!texts || !v.image) return null;
  return {
    id: 'preview',
    title: texts.title,
    subtitle: texts.subtitle,
    ctaLabel: texts.ctaLabel,
    imageAlt: texts.imageAlt,
    image: { url: v.image.url ?? '', mimeType: v.image.mimeType },
    cta: { type: v.ctaType },
    fallbackFields: texts.fallbackFields,
  };
}

// ── Errores del servidor ───────────────────────────────────────────────────────────────────

export type BannerErrorKind =
  | 'codeTaken'
  | 'versionConflict'
  | 'imageInvalid'
  | 'translationInvalid'
  | 'ctaInvalid'
  | 'periodInvalid'
  | 'scopeInvalid'
  | 'promotionInvalid'
  | 'reorderMismatch'
  | 'limitReached'
  | 'scopeForbidden'
  | 'branchNotFound'
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
  /** Hay que volver a pedir datos (el banner cambió, ya no existe o cambió el alcance). */
  reload: boolean;
}

const out = (
  kind: BannerErrorKind,
  message: string,
  field?: BannerField,
  reload = false,
): BannerServerError => ({ kind, message, field, reload });

export const BUSY_MESSAGE = 'Hay otra edición en curso. Espera un momento y reintenta.';

/** `translations.es.title` → `esTitle` (el campo del formulario que provocó el 422). */
export function fieldOfViolationPath(path: string): BannerField | undefined {
  const m = /^translations\.(es|en)\.(title|subtitle|ctaLabel|imageAlt)$/.exec(path);
  if (!m) return undefined;
  const [, lang, name] = m as unknown as [string, 'es' | 'en', string];
  return `${lang}${name.charAt(0).toUpperCase()}${name.slice(1)}` as BannerField;
}

/**
 * 403 `BANNER_SCOPE_FORBIDDEN`; 404 `BANNER_NOT_FOUND` | `BRANCH_NOT_FOUND`; 409 `BANNER_CODE_TAKEN` | `BANNER_VERSION_CONFLICT`; 422
 * `BANNER_{IMAGE,TRANSLATION,CTA,PERIOD,SCOPE,PROMOTION}_INVALID` | `BANNER_REORDER_MISMATCH` | `BANNER_LIMIT_REACHED`; 503
 * `BANNERS_BUSY`; 400, 401, 403. Se ramifica por `businessCode`, nunca por el texto.
 */
export function bannerServerError(error: unknown): BannerServerError {
  if (!isApiError(error)) return out('other', errorMessage(error));
  switch (error.businessCode) {
    case 'BANNER_CODE_TAKEN':
      return out('codeTaken', 'Ya existe un banner con ese código. Elige otro.', 'code');
    case 'BANNER_VERSION_CONFLICT':
      return out(
        'versionConflict',
        'Otra persona modificó este banner mientras lo editabas. Carga la versión actual para no pisar sus cambios.',
        undefined,
        true,
      );
    case 'BANNER_IMAGE_INVALID':
      return out(
        'imageInvalid',
        'La imagen elegida ya no es válida (no existe, no está confirmada o no es de banner). Elige o sube otra.',
        'image',
      );
    case 'BANNER_TRANSLATION_INVALID':
      return out(
        'translationInvalid',
        'Revisa los textos: el título y el texto alternativo en español son obligatorios y respetan sus límites.',
        fieldOfViolationPath(error.violations?.[0]?.path ?? '') ?? 'esTitle',
      );
    case 'BANNER_CTA_INVALID':
      return out(
        'ctaInvalid',
        'El destino del botón no es válido o ya no está activo. Elige otro.',
        'cta',
      );
    case 'BANNER_PERIOD_INVALID':
      return out('periodInvalid', 'El fin de la vigencia debe ser posterior al inicio.', 'endsAt');
    case 'BANNER_SCOPE_INVALID':
      return out(
        'scopeInvalid',
        'Revisa las sucursales: elige al menos una o usa «Todas».',
        'branches',
      );
    case 'BANNER_PROMOTION_INVALID':
      return out(
        'promotionInvalid',
        'La promoción vinculada no existe o no cubre las sucursales de este banner.',
        'promotion',
        true,
      );
    case 'BANNER_REORDER_MISMATCH':
      return out(
        'reorderMismatch',
        'El orden cambió mientras lo movías. Se recargó la lista; inténtalo de nuevo.',
        undefined,
        true,
      );
    case 'BANNER_LIMIT_REACHED':
      return out(
        'limitReached',
        'Hay 100 banners no vencidos. Desactiva o deja vencer alguno antes de añadir otro.',
      );
    case 'BANNER_SCOPE_FORBIDDEN':
      return out(
        'scopeForbidden',
        'No cubres todas las sucursales de este banner: pide a un administrador con alcance sobre todas que lo edite.',
      );
    case 'BRANCH_NOT_FOUND':
      return out(
        'branchNotFound',
        'Alguna sucursal ya no existe o está fuera de tu alcance. Se recargaron los datos.',
        'branches',
        true,
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
