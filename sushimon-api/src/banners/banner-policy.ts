import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { AuditValues } from '../audit/audit.service.js';
import { codedException, type ErrorViolation } from '../common/errors/coded-exception.js';
import type { GrantScope } from '../identity/identity.types.js';
import { assertCleanText, parseInstantField } from '../promotions/promotion-policy.js';
import {
  BANNER_PAGES,
  MAX_NON_EXPIRED_BANNERS,
  type BannerCta,
  type BannerCtaType,
  type BannerDraft,
  type BannerLifecycle,
  type BannerPage,
  type BannerScope,
  type BannerText,
  type BannerTextField,
} from './banners.types.js';

/** Reglas puras de banners (spec F16 D3-D9): sin I/O ni reloj. */

export const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const TITLE_MAX = 80;
export const SUBTITLE_MAX = 160;
export const CTA_LABEL_MAX = 40;
export const IMAGE_ALT_MAX = 200;
export const MAX_BRANCH_IDS = 20;
export const MAX_VIOLATIONS = 50;
export const REASON_MAX = 200;
/** Entidad de auditoría del reordenado (no hay un banner único): UUID nulo, como `category.reordered`. */
export const ORDER_AUDIT_ENTITY_ID = '00000000-0000-0000-0000-000000000000';
export const SORT_ORDER_MAX = 9999;

export const PERMISSION_READ = 'banners.read';
export const PERMISSION_CREATE = 'banners.create';
export const PERMISSION_UPDATE = 'banners.update';

export const TEXT_MAX: Readonly<Record<BannerTextField, number>> = {
  title: TITLE_MAX,
  subtitle: SUBTITLE_MAX,
  ctaLabel: CTA_LABEL_MAX,
  imageAlt: IMAGE_ALT_MAX,
};

// ---------- errores ----------

export const bannerNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'BANNER_NOT_FOUND', 'Banner no encontrado');
export const branchNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
export const scopeForbidden = () =>
  codedException(
    HttpStatus.FORBIDDEN,
    'BANNER_SCOPE_FORBIDDEN',
    'No tienes alcance sobre todas las sucursales de este banner',
  );
export const codeTaken = () =>
  codedException(HttpStatus.CONFLICT, 'BANNER_CODE_TAKEN', 'El código ya está en uso', [
    { path: 'code', code: 'BANNER_CODE_TAKEN', message: 'El código ya está en uso' },
  ]);
export const versionConflict = () =>
  codedException(
    HttpStatus.CONFLICT,
    'BANNER_VERSION_CONFLICT',
    'El banner cambió desde que se leyó; recarga e inténtalo de nuevo',
  );
export const busy = () =>
  codedException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'BANNERS_BUSY',
    'Los banners se están modificando; reintenta en unos segundos',
  );

const unprocessable = (code: string, message: string, violations: ErrorViolation[]) =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    code,
    message,
    violations.slice(0, MAX_VIOLATIONS),
  );

export const imageInvalid = (reason: 'ASSET_UNKNOWN' | 'ASSET_NOT_READY' | 'ASSET_KIND_MISMATCH') =>
  unprocessable('BANNER_IMAGE_INVALID', 'La imagen del banner no es válida', [
    {
      path: 'imageAssetId',
      code: reason,
      message:
        reason === 'ASSET_UNKNOWN'
          ? 'El medio no existe'
          : reason === 'ASSET_NOT_READY'
            ? 'El medio aún no está confirmado'
            : 'El medio no es una imagen de banner',
    },
  ]);
export const translationInvalid = (violations: ErrorViolation[]) =>
  unprocessable('BANNER_TRANSLATION_INVALID', 'Traducciones inválidas', violations);
export const ctaInvalid = (violations: ErrorViolation[]) =>
  unprocessable('BANNER_CTA_INVALID', 'Destino del banner inválido', violations);
export const periodInvalid = () =>
  unprocessable('BANNER_PERIOD_INVALID', 'endsAt debe ser posterior a startsAt', [
    {
      path: 'endsAt',
      code: 'BANNER_PERIOD_INVALID',
      message: 'endsAt debe ser posterior a startsAt',
    },
  ]);
export const scopeInvalid = (message: string) =>
  unprocessable('BANNER_SCOPE_INVALID', 'Alcance de sucursales inválido', [
    { path: 'branchIds', code: 'BANNER_SCOPE_INVALID', message },
  ]);
export const promotionInvalid = (reason: 'PROMOTION_UNKNOWN' | 'BRANCH_SCOPE_MISMATCH') =>
  unprocessable('BANNER_PROMOTION_INVALID', 'Promoción vinculada inválida', [
    {
      path: 'promotionId',
      code: reason,
      message:
        reason === 'PROMOTION_UNKNOWN'
          ? 'La promoción no existe'
          : 'La promoción no cubre todas las sucursales del banner',
    },
  ]);
export const reorderMismatch = () =>
  unprocessable(
    'BANNER_REORDER_MISMATCH',
    'orderedIds debe contener exactamente los banners no vencidos; recarga la lista',
    [
      {
        path: 'orderedIds',
        code: 'BANNER_REORDER_MISMATCH',
        message: 'El conjunto no coincide con los banners no vencidos',
      },
    ],
  );
export const limitReached = () =>
  unprocessable(
    'BANNER_LIMIT_REACHED',
    `Hay demasiados banners no vencidos (máximo ${MAX_NON_EXPIRED_BANNERS})`,
    [
      {
        path: 'endsAt',
        code: 'BANNER_LIMIT_REACHED',
        message: 'Se alcanzó el máximo de banners no vencidos',
      },
    ],
  );

const fail400 = (message: string): never => {
  throw new BadRequestException([message]);
};

// ---------- normalización ----------

/** Minúsculas y recorte; formato inválido => 400 (el DTO ya filtra lo evidente). */
export function normalizeCode(raw: string): string {
  const code = raw.trim().toLowerCase();
  if (!CODE_PATTERN.test(code)) return fail400('code con formato inválido');
  return code;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Invisibles que no aportan texto (ancho cero, unión, word joiner, guion blando, BOM): se eliminan (B2). */
const INVISIBLE_CHARS = /\u200B|\u200C|\u200D|\u2060|\u00AD|\uFEFF/g;

function oneLine(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(INVISIBLE_CHARS, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Motivo del cambio de estado: una línea, sin NUL/bidi (400), en blanco => `null`. */
export function normalizeReason(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  assertCleanText('reason', raw);
  const text = oneLine(raw);
  if (text === '') return null;
  if (text.length > REASON_MAX) return fail400(`reason supera ${REASON_MAX} caracteres`);
  return text;
}

/**
 * Texto plano de una línea: rechaza NUL y controles bidireccionales (como F15), NFC, controles a espacio, espacios
 * colapsados, invisibles de ancho cero eliminados y recorte. En blanco => `null` (ausente). Más largo que el tope => 400.
 */
export function normalizeText(
  field: BannerTextField,
  raw: string | null | undefined,
  label: string = field,
): string | null {
  if (raw === undefined || raw === null) return null;
  assertCleanText(label, raw);
  const text = oneLine(raw);
  if (text === '') return null;
  if (text.length > TEXT_MAX[field])
    return fail400(`${label} supera ${TEXT_MAX[field]} caracteres`);
  return text;
}

export interface TextInput {
  title?: string | null;
  subtitle?: string | null;
  ctaLabel?: string | null;
  imageAlt?: string | null;
}

const EMPTY_TEXT: BannerText = { title: null, subtitle: null, ctaLabel: null, imageAlt: null };
export const isTextEmpty = (t: BannerText): boolean =>
  t.title === null && t.subtitle === null && t.ctaLabel === null && t.imageAlt === null;

/** Texto completo (alta): lo omitido queda ausente. */
export function textFromInput(locale: string, input: TextInput | null | undefined): BannerText {
  if (!input) return { ...EMPTY_TEXT };
  return {
    title: normalizeText('title', input.title, `translations.${locale}.title`),
    subtitle: normalizeText('subtitle', input.subtitle, `translations.${locale}.subtitle`),
    ctaLabel: normalizeText('ctaLabel', input.ctaLabel, `translations.${locale}.ctaLabel`),
    imageAlt: normalizeText('imageAlt', input.imageAlt, `translations.${locale}.imageAlt`),
  };
}

/** Parche normalizado de un idioma: solo las claves enviadas (`null`/en blanco = borrar el campo). */
export type TextPatch = Partial<BannerText>;

export function textPatchOf(locale: string, input: TextInput): TextPatch {
  const patch: TextPatch = {};
  for (const field of ['title', 'subtitle', 'ctaLabel', 'imageAlt'] as const) {
    if (input[field] !== undefined)
      patch[field] = normalizeText(field, input[field], `translations.${locale}.${field}`);
  }
  return patch;
}

/** Aplica el parche campo a campo: lo omitido NO se reemplaza. */
export const applyTextPatch = (before: BannerText | null, patch: TextPatch): BannerText => ({
  ...(before ?? EMPTY_TEXT),
  ...patch,
});

export interface CtaInput {
  type: BannerCtaType;
  categoryId?: string | null;
  productId?: string | null;
  page?: string | null;
}

/** Forma cruda del destino (la página aún no está validada contra la lista blanca). */
export interface RawCta {
  type: BannerCtaType;
  categoryId: string | null;
  productId: string | null;
  page: string | null;
}

export const rawCtaOf = (input: CtaInput): RawCta => ({
  type: input.type,
  categoryId: input.categoryId ?? null,
  productId: input.productId ?? null,
  page: input.page ?? null,
});

export function parseInstantOrNull(field: string, raw: string | null | undefined): Date | null {
  if (raw === undefined || raw === null) return null;
  return parseInstantField(field, raw);
}

// ---------- reglas (422) ----------

/** CTA estructurado: una referencia por tipo, página en lista blanca, sin enlaces externos ni rutas de texto. */
export function validateCta(raw: RawCta): BannerCta {
  const violations: ErrorViolation[] = [];
  const mismatch = (path: string, message: string): void => {
    violations.push({ path, code: 'FIELD_MISMATCH', message });
  };
  const only = (kept: 'categoryId' | 'productId' | 'page' | null): void => {
    for (const field of ['categoryId', 'productId', 'page'] as const) {
      if (field !== kept && raw[field] !== null)
        mismatch(`cta.${field}`, `${field} no corresponde al tipo ${raw.type}`);
    }
  };
  switch (raw.type) {
    case 'CATEGORY':
      if (raw.categoryId === null) mismatch('cta.categoryId', 'categoryId es obligatorio');
      only('categoryId');
      break;
    case 'PRODUCT':
      if (raw.productId === null) mismatch('cta.productId', 'productId es obligatorio');
      only('productId');
      break;
    case 'PAGE':
      if (raw.page === null) mismatch('cta.page', 'page es obligatorio');
      else if (!(BANNER_PAGES as readonly string[]).includes(raw.page)) {
        violations.push({
          path: 'cta.page',
          code: 'TARGET_UNKNOWN',
          message: 'La página no está en la lista permitida',
        });
      }
      only('page');
      break;
    default:
      only(null);
  }
  if (violations.length > 0) throw ctaInvalid(violations);
  return {
    type: raw.type,
    categoryId: raw.categoryId,
    productId: raw.productId,
    page: raw.page as BannerPage | null,
  };
}

export function assertPeriod(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt !== null && endsAt !== null && endsAt.getTime() <= startsAt.getTime())
    throw periodInvalid();
}

/** `es.title` y `es.imageAlt` obligatorios (la BD lo exige a la fila `es`; la fila misma la impone el servicio). */
export function assertTranslations(es: BannerText): void {
  const violations: ErrorViolation[] = [];
  if (es.title === null)
    violations.push({
      path: 'translations.es.title',
      code: 'REQUIRED',
      message: 'El título en español es obligatorio',
    });
  if (es.imageAlt === null)
    violations.push({
      path: 'translations.es.imageAlt',
      code: 'REQUIRED',
      message: 'El texto alternativo en español es obligatorio',
    });
  if (violations.length > 0) throw translationInvalid(violations);
}

/** `ALL` sin ids; `SELECTED` con al menos uno => 422 `BANNER_SCOPE_INVALID`. */
export function assertScopeShape(scope: BannerScope, ids: readonly string[]): void {
  if (scope === 'ALL' && ids.length > 0)
    throw scopeInvalid('branchIds debe omitirse o ir vacío con branchScope=ALL');
  if (scope === 'SELECTED' && ids.length === 0)
    throw scopeInvalid('branchIds es obligatorio y no vacío con branchScope=SELECTED');
}

export function validateDraft(draft: BannerDraft): BannerDraft {
  assertScopeShape(draft.branchScope, draft.branchIds);
  assertPeriod(draft.startsAt, draft.endsAt);
  assertTranslations(draft.translations.es);
  return draft;
}

/** ¿La promoción cubre el alcance del banner? (`ALL` exige promoción `ALL`; `SELECTED` exige subconjunto). */
export function promotionCoversBanner(
  promotionBranchIds: readonly string[],
  bannerScope: BannerScope,
  bannerBranchIds: readonly string[],
): boolean {
  if (promotionBranchIds.length === 0) return true;
  if (bannerScope === 'ALL') return false;
  return bannerBranchIds.every((id) => promotionBranchIds.includes(id));
}

// ---------- alcance y tiempo ----------

/** ¿El banner aplica a alguna sucursal del alcance? (`branchIds` vacío = todas). */
export function touches(scope: GrantScope, branchIds: readonly string[]): boolean {
  if (scope.allBranches) return true;
  if (branchIds.length === 0) return scope.branchIds.length > 0;
  return branchIds.some((id) => scope.branchIds.includes(id));
}

/** ¿El alcance cubre TODAS las sucursales del banner? (`ALL` exige alcance global). */
export function covers(scope: GrantScope, branchIds: readonly string[]): boolean {
  if (scope.allBranches) return true;
  if (branchIds.length === 0) return false;
  return branchIds.every((id) => scope.branchIds.includes(id));
}

export const isExpired = (endsAt: Date | null, nowMs: number): boolean =>
  endsAt !== null && endsAt.getTime() <= nowMs;

/** INACTIVE > EXPIRED > SCHEDULED > PUBLISHED (spec D5). */
export function lifecycleOf(
  b: { active: boolean; startsAt: Date | null; endsAt: Date | null },
  nowMs: number,
): BannerLifecycle {
  if (!b.active) return 'INACTIVE';
  if (isExpired(b.endsAt, nowMs)) return 'EXPIRED';
  if (b.startsAt !== null && b.startsAt.getTime() > nowMs) return 'SCHEDULED';
  return 'PUBLISHED';
}

// ---------- diff y auditoría (sin PII) ----------

const sameList = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const sameDate = (a: Date | null, b: Date | null): boolean =>
  (a === null && b === null) || (a !== null && b !== null && a.getTime() === b.getTime());
const sameText = (a: BannerText | null, b: BannerText | null): boolean =>
  a === null || b === null
    ? a === b
    : a.title === b.title &&
      a.subtitle === b.subtitle &&
      a.ctaLabel === b.ctaLabel &&
      a.imageAlt === b.imageAlt;
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export interface DraftDiff {
  scalars: {
    imageAssetId?: string;
    cta?: BannerCta;
    promotionId?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    sortOrder?: number;
  };
  branchIds?: string[];
  translations?: { es?: BannerText; en?: BannerText | null };
  oldValues: AuditValues;
  newValues: AuditValues;
}

/** Cambios entre el estado actual y el borrador; `null` si no hay ninguno (idempotente). */
export function diffDraft(before: BannerDraft, after: BannerDraft): DraftDiff | null {
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  const diff: DraftDiff = { scalars: {}, oldValues, newValues };
  if (before.imageAssetId !== after.imageAssetId) {
    diff.scalars.imageAssetId = after.imageAssetId;
    oldValues['imageAssetId'] = before.imageAssetId;
    newValues['imageAssetId'] = after.imageAssetId;
  }
  const b = before.cta;
  const a = after.cta;
  if (
    b.type !== a.type ||
    b.categoryId !== a.categoryId ||
    b.productId !== a.productId ||
    b.page !== a.page
  ) {
    diff.scalars.cta = a;
    Object.assign(oldValues, {
      ctaType: b.type,
      ctaCategoryId: b.categoryId,
      ctaProductId: b.productId,
      ctaPage: b.page,
    });
    Object.assign(newValues, {
      ctaType: a.type,
      ctaCategoryId: a.categoryId,
      ctaProductId: a.productId,
      ctaPage: a.page,
    });
  }
  if (before.promotionId !== after.promotionId) {
    diff.scalars.promotionId = after.promotionId;
    oldValues['promotionId'] = before.promotionId;
    newValues['promotionId'] = after.promotionId;
  }
  if (!sameDate(before.startsAt, after.startsAt)) {
    diff.scalars.startsAt = after.startsAt;
    oldValues['startsAt'] = iso(before.startsAt);
    newValues['startsAt'] = iso(after.startsAt);
  }
  if (!sameDate(before.endsAt, after.endsAt)) {
    diff.scalars.endsAt = after.endsAt;
    oldValues['endsAt'] = iso(before.endsAt);
    newValues['endsAt'] = iso(after.endsAt);
  }
  if (before.sortOrder !== after.sortOrder) {
    diff.scalars.sortOrder = after.sortOrder;
    oldValues['sortOrder'] = before.sortOrder;
    newValues['sortOrder'] = after.sortOrder;
  }
  if (before.branchScope !== after.branchScope || !sameList(before.branchIds, after.branchIds)) {
    diff.branchIds = after.branchIds;
    oldValues['branchScope'] = before.branchScope;
    newValues['branchScope'] = after.branchScope;
    oldValues['branchIds'] = [...before.branchIds].sort();
    newValues['branchIds'] = [...after.branchIds].sort();
  }
  const changedText: string[] = [];
  for (const locale of ['es', 'en'] as const) {
    const x = before.translations[locale];
    const y = after.translations[locale];
    if (sameText(x, y)) continue;
    diff.translations = { ...(diff.translations ?? {}), [locale]: y };
    for (const field of ['title', 'subtitle', 'ctaLabel', 'imageAlt'] as const) {
      if ((x?.[field] ?? null) !== (y?.[field] ?? null)) changedText.push(`${locale}.${field}`);
    }
  }
  if (changedText.length > 0) newValues['changedTextFields'] = changedText;
  const changed =
    Object.keys(diff.scalars).length > 0 ||
    diff.branchIds !== undefined ||
    diff.translations !== undefined;
  return changed ? diff : null;
}

export const createdAudit = (draft: BannerDraft): AuditValues => ({
  code: draft.code,
  imageAssetId: draft.imageAssetId,
  ctaType: draft.cta.type,
  ctaCategoryId: draft.cta.categoryId,
  ctaProductId: draft.cta.productId,
  ctaPage: draft.cta.page,
  branchScope: draft.branchScope,
  branchIds: [...draft.branchIds].sort(),
  promotionId: draft.promotionId,
  startsAt: iso(draft.startsAt),
  endsAt: iso(draft.endsAt),
  sortOrder: draft.sortOrder,
  active: draft.active,
  locales: draft.translations.en ? ['es', 'en'] : ['es'],
  titleEs: draft.translations.es.title,
  titleEn: draft.translations.en?.title ?? null,
});
