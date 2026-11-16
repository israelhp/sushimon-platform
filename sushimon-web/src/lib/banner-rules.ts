import type {
  BannerCtaType,
  BannerHiddenReason,
  BannerLifecycle,
  BannerLocale,
  BannerPage,
} from '@/lib/data-access/models';
import { PROMOTION_HORIZON_DAYS } from './promotion-rules';

/**
 * F16 — Reglas PURAS de banners (spec 017, ADR-0022). Las usan el adaptador mock (para emular al servidor), el formulario del
 * backoffice (aviso previo) y el carrusel (resolución cerrada del destino). La autoridad es la API; la tienda NUNCA decide qué
 * banner se publica: muestra lo que devuelve `GET /v1/store/banners`. Sin React ni red.
 *
 * - Vigencia: instantes `[startsAt, endsAt)` (fin exclusivo, ambos extremos opcionales). `America/Guatemala` solo al MOSTRAR.
 * - Estado derivado (no es columna): INACTIVE > EXPIRED > SCHEDULED > PUBLISHED.
 * - Texto: idioma pedido con respaldo POR CAMPO a `es`; una cadena en blanco cuenta como ausente.
 */

// ── Límites del contrato ───────────────────────────────────────────────────────────────────

export const BANNER_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const BANNER_TITLE_MAX = 80;
export const BANNER_SUBTITLE_MAX = 160;
export const BANNER_CTA_LABEL_MAX = 40;
export const BANNER_ALT_MAX = 200;
export const BANNER_SORT_MAX = 9999;
export const BANNER_SEARCH_MAX = 80;
export const BANNER_PAGE_MAX = 200;
export const BANNER_PAGE_SIZE_MAX = 100;
/** Banners no vencidos admitidos (alta o reactivación por encima => 422 `BANNER_LIMIT_REACHED`). */
export const BANNER_NOT_EXPIRED_MAX = 100;
/** Máximo que devuelve la tienda. */
export const STORE_BANNERS_MAX = 10;
export const BANNER_BRANCHES_MAX = 20;
/** Horizonte de `nextChangeAt` (el mismo que F15). */
export const BANNER_HORIZON_DAYS = PROMOTION_HORIZON_DAYS;

/** Imagen de banner (perfil de optimización del navegador): proporción 3:1, lado largo ≤ 1920 px y ≤ 1 MiB. */
export const BANNER_IMAGE_MAX_BYTES = 1024 * 1024;
export const BANNER_IMAGE_MAX_SIDE_PX = 1920;
export const BANNER_ASPECT_RATIO = 3;

export const BANNER_LOCALES: readonly BannerLocale[] = ['es', 'en'];
export const isBannerLocale = (value: unknown): value is BannerLocale =>
  value === 'es' || value === 'en';

// ── CTA estructurado (lista cerrada; sin EXTERNAL) ─────────────────────────────────────────

export const BANNER_CTA_TYPES: readonly BannerCtaType[] = [
  'NONE',
  'MENU',
  'PROMOTIONS',
  'CATEGORY',
  'PRODUCT',
  'PAGE',
];
export const BANNER_PAGES: readonly BannerPage[] = ['CAREERS', 'TRACK_ORDER', 'INCIDENTS'];

export const isBannerCtaType = (value: unknown): value is BannerCtaType =>
  typeof value === 'string' && (BANNER_CTA_TYPES as readonly string[]).includes(value);
export const isBannerPage = (value: unknown): value is BannerPage =>
  typeof value === 'string' && (BANNER_PAGES as readonly string[]).includes(value);

/** Cadena de texto sin controles ni marcas bidireccionales (misma política que `name/description` de F15). */
const DISALLOWED_TEXT = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;
/** Invisibles (ancho cero, unión, guion blando, BOM, unión de palabras): no se admiten en los textos y un texto solo de ellos cuenta como vacío. */
const INVISIBLE_TEXT = /[\u200b\u200c\u200d\u2060\u00ad\ufeff]/;
const INVISIBLE_TEXT_ALL = /[\u200b\u200c\u200d\u2060\u00ad\ufeff]/g;
const CONTROL_TEXT_ALL = new RegExp(DISALLOWED_TEXT.source, 'g');
export const hasDisallowedBannerChars = (value: string): boolean =>
  DISALLOWED_TEXT.test(value) || INVISIBLE_TEXT.test(value);

/** Motivo de un cambio de estado: se descartan controles, bidi e invisibles; `undefined` si queda vacío. Máx. 200. */
export function sanitizeReason(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const clean = value
    .replace(CONTROL_TEXT_ALL, '')
    .replace(INVISIBLE_TEXT_ALL, '')
    .trim()
    .slice(0, 200);
  return clean === '' ? undefined : clean;
}

/** Normaliza un código (recorta y pasa a minúsculas). */
export const normalizeBannerCode = (code: string): string => code.trim().toLowerCase();

// ── Vigencia y estado derivado ─────────────────────────────────────────────────────────────

export interface BannerWindow {
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

/** INACTIVE > EXPIRED (`endsAt <= ahora`) > SCHEDULED (`startsAt > ahora`) > PUBLISHED. */
export function bannerLifecycle(b: BannerWindow, at: Date): BannerLifecycle {
  const t = at.getTime();
  if (!b.active) return 'INACTIVE';
  if (b.endsAt !== null && t >= Date.parse(b.endsAt)) return 'EXPIRED';
  if (b.startsAt !== null && t < Date.parse(b.startsAt)) return 'SCHEDULED';
  return 'PUBLISHED';
}

/** ¿Venció por fecha (`endsAt <= ahora`), esté o no activo? Es lo que excluye del reordenado y del tope de 100. */
export const isBannerExpiredByDate = (b: Pick<BannerWindow, 'endsAt'>, at: Date): boolean =>
  b.endsAt !== null && at.getTime() >= Date.parse(b.endsAt);

/** Etiquetas de los motivos de ocultación (orden de precedencia del mock; el contrato no fija uno). */
export const HIDDEN_REASONS: readonly BannerHiddenReason[] = [
  'PROMOTION_NOT_LIVE',
  'CTA_TARGET_INACTIVE',
  'IMAGE_UNAVAILABLE',
];

/**
 * Próximo instante (≤ 14 días) en que cambia el conjunto publicado por tiempo: inicio/fin de los banners activos y los
 * `extra` (cambios de vigencia de las promociones vinculadas). `null` si no hay.
 */
export function bannersNextChange(
  banners: readonly Pick<BannerWindow, 'startsAt' | 'endsAt'>[],
  extra: readonly (Date | null)[],
  at: Date,
): Date | null {
  const t = at.getTime();
  const limit = t + BANNER_HORIZON_DAYS * 86_400_000;
  let best: number | null = null;
  const consider = (ms: number) => {
    if (Number.isFinite(ms) && ms > t && ms <= limit && (best === null || ms < best)) best = ms;
  };
  for (const b of banners) {
    if (b.startsAt !== null) consider(Date.parse(b.startsAt));
    if (b.endsAt !== null) consider(Date.parse(b.endsAt));
  }
  for (const d of extra) if (d) consider(d.getTime());
  return best === null ? null : new Date(best);
}

// ── Texto por idioma con respaldo por campo ────────────────────────────────────────────────

export type BannerTextField = 'title' | 'subtitle' | 'ctaLabel' | 'imageAlt';
export const BANNER_TEXT_FIELDS: readonly BannerTextField[] = [
  'title',
  'subtitle',
  'ctaLabel',
  'imageAlt',
];

export interface BannerTexts {
  title: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  imageAlt: string | null;
}

export const EMPTY_TEXTS: BannerTexts = {
  title: null,
  subtitle: null,
  ctaLabel: null,
  imageAlt: null,
};

/** Cadena recortada; en blanco —o solo invisibles— = ausente (`null`). */
export const cleanText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.replace(INVISIBLE_TEXT_ALL, '').trim() === '' ? null : trimmed;
};

/** ¿La traducción `es` es publicable? (título e imagen alt presentes). Sin ella el banner no se publica (B13). */
export const hasValidSpanish = (es: BannerTexts | null | undefined): boolean =>
  Boolean(es && cleanText(es.title) && cleanText(es.imageAlt));

export interface ResolvedTexts {
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  imageAlt: string;
  /** Campos cuyo texto vino en español porque faltaba en el idioma pedido (la web marca `lang="es"`). */
  fallbackFields: BannerTextField[];
}

/**
 * Respaldo POR CAMPO: se usa el valor del idioma pedido si existe y no está vacío; si no, el de `es`. Un campo opcional que
 * tampoco existe en `es` queda `null` y NO cuenta como respaldo. Requiere `es` válido (si no, `null`).
 */
export function resolveTexts(
  es: BannerTexts,
  en: BannerTexts | null,
  locale: BannerLocale,
): ResolvedTexts | null {
  if (!hasValidSpanish(es)) return null;
  const fallbackFields: BannerTextField[] = [];
  const pick = (field: BannerTextField): string | null => {
    const spanish = cleanText(es[field]);
    if (locale === 'es') return spanish;
    const wanted = cleanText(en?.[field]);
    if (wanted !== null) return wanted;
    if (spanish !== null) fallbackFields.push(field);
    return spanish;
  };
  const title = pick('title');
  const subtitle = pick('subtitle');
  const ctaLabel = pick('ctaLabel');
  const imageAlt = pick('imageAlt');
  return {
    title: title as string,
    subtitle,
    ctaLabel,
    imageAlt: imageAlt as string,
    fallbackFields,
  };
}

// ── Orden ──────────────────────────────────────────────────────────────────────────────────

export interface Sortable {
  id: string;
  sortOrder: number;
  createdAt: string;
}

/** Orden de la tienda y de la lista admin por prioridad: `sortOrder`, `createdAt`, `id` (determinista; el empate es legal). */
export const compareByPriority = (a: Sortable, b: Sortable): number =>
  a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Mueve `id` una posición (`up` = antes) dentro de `ids`; devuelve el MISMO orden si ya está en el borde o no existe. */
export function moveId(ids: readonly string[], id: string, direction: 'up' | 'down'): string[] {
  const from = ids.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as string);
  return next;
}
