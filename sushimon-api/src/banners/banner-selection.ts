import {
  analyzeTiming,
  HORIZON_MS,
  sharedTimingOf,
  type PromotionTiming,
  type SharedTiming,
} from '../promotions/promotion-schedule.js';
import {
  BANNER_TEXT_FIELDS,
  MAX_STORE_BANNERS,
  type BannerLocale,
  type BannerText,
  type BannerTextField,
  type LinkedPromotion,
  type StoreBannerView,
  type StoreCandidate,
} from './banners.types.js';

/**
 * Selección PURA de los banners públicos (spec F16 D5-D7, casos B1-B17): sin I/O ni reloj (recibe el instante). Usa solo
 * las funciones puras de `promotion-schedule.ts` de F15 (`analyzeTiming`), no el evaluador ni el módulo de promociones.
 */

export interface SelectionInput {
  candidates: readonly StoreCandidate[];
  promotions: ReadonlyMap<string, LinkedPromotion>;
  /** `null` = sin sucursal (solo banners `ALL`, y promociones `ALL`). */
  branchId: string | null;
  locale: BannerLocale;
  nowMs: number;
  timeZone: string;
  /** URL pública permanente de la clave (`MediaUrlService.tryPublicUrl`); `null` sin base pública. */
  imageUrl: (objectKey: string) => string | null;
}

export interface SelectionResult {
  items: StoreBannerView[];
  /** ms UTC del próximo cambio por tiempo (<= horizonte), o `null`. */
  nextChangeAt: number | null;
}

const present = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t === '' ? null : t;
};

/** Orden público: `sort_order`, `created_at`, `id` (determinista; el empate no depende de la inserción). */
export function compareCandidates(a: StoreCandidate, b: StoreCandidate): number {
  return (
    a.sortOrder - b.sortOrder ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** ¿La traducción `es` es publicable? (título e imagen alt no vacíos). */
export const hasValidSpanish = (es: BannerText | null): es is BannerText =>
  es !== null && present(es.title) !== null && present(es.imageAlt) !== null;

/**
 * Texto en el idioma pedido con respaldo POR CAMPO a `es`. Un campo vacío cuenta como ausente. `fallbackFields` lista
 * los campos cuyo texto vino en español porque faltaba en el idioma pedido (solo si hay texto que mostrar).
 */
export function resolveText(
  locale: BannerLocale,
  es: BannerText,
  en: BannerText | null,
): {
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  imageAlt: string;
  fallbackFields: BannerTextField[];
} {
  const fallbackFields: BannerTextField[] = [];
  const pick = (field: BannerTextField): string | null => {
    if (locale === 'en') {
      const own = present(en?.[field]);
      if (own !== null) return own;
      const fallback = present(es[field]);
      if (fallback !== null) fallbackFields.push(field);
      return fallback;
    }
    return present(es[field]);
  };
  const out = {
    title: pick('title') as string,
    subtitle: pick('subtitle'),
    ctaLabel: pick('ctaLabel'),
    imageAlt: pick('imageAlt') as string,
  };
  return { ...out, fallbackFields: BANNER_TEXT_FIELDS.filter((f) => fallbackFields.includes(f)) };
}

export function selectStoreBanners(input: SelectionInput): SelectionResult {
  const { nowMs, branchId } = input;
  const horizon = nowMs + HORIZON_MS;
  const changes: number[] = [];
  const visible: { c: StoreCandidate; url: string; es: BannerText }[] = [];
  let shared: SharedTiming | undefined;
  // Varios banners pueden vincular la misma promoción: su vigencia se calcula una vez por solicitud.
  const timings = new Map<string, PromotionTiming>();

  for (const c of [...input.candidates].sort(compareCandidates)) {
    // --- elegibilidad estática (no depende del reloj) ---
    if (!hasValidSpanish(c.translations.es)) continue; // B13
    const url = input.imageUrl(c.imageObjectKey);
    if (url === null) continue; // B14: sin base pública no se publica y sin 5xx
    if (c.targetActive === false) continue; // B15
    let promotion: LinkedPromotion | null = null;
    if (c.promotionId !== null) {
      promotion = input.promotions.get(c.promotionId) ?? null;
      if (!promotion) continue;
      // B9: la promoción debe aplicar a la sucursal consultada (sin sucursal, solo si es para todas).
      const applies =
        promotion.branchIds.length === 0 ||
        (branchId !== null && promotion.branchIds.includes(branchId));
      if (!applies) continue;
    }

    // --- próximos cambios por tiempo (fechas del banner y vigencia de su promoción) ---
    for (const t of [c.startsAt, c.endsAt]) {
      if (t === null) continue;
      const ms = t.getTime();
      if (ms > nowMs && ms <= horizon) changes.push(ms);
    }
    let promoLive = true;
    if (promotion) {
      shared ??= sharedTimingOf(nowMs, input.timeZone);
      let timing = timings.get(promotion.id);
      if (!timing) {
        timing = analyzeTiming(promotion, nowMs, input.timeZone, shared);
        timings.set(promotion.id, timing);
      }
      promoLive = timing.live;
      if (timing.nextChangeAt !== null) changes.push(timing.nextChangeAt);
    }

    // --- elegibilidad por tiempo: [startsAt, endsAt) (B1-B3) ---
    if (c.startsAt !== null && c.startsAt.getTime() > nowMs) continue;
    if (c.endsAt !== null && c.endsAt.getTime() <= nowMs) continue;
    if (!promoLive) continue; // B8
    visible.push({ c, url, es: c.translations.es });
  }

  const items = visible.slice(0, MAX_STORE_BANNERS).map(({ c, url, es }): StoreBannerView => {
    const text = resolveText(input.locale, es, c.translations.en);
    return {
      id: c.id,
      title: text.title,
      subtitle: text.subtitle,
      ctaLabel: text.ctaLabel,
      imageAlt: text.imageAlt,
      image: { url, mimeType: c.imageMimeType },
      cta: {
        type: c.ctaType,
        categorySlug: c.ctaType === 'CATEGORY' ? c.categorySlug : null,
        productId: c.ctaType === 'PRODUCT' ? c.productId : null,
        page: c.ctaType === 'PAGE' ? c.page : null,
      },
      fallbackFields: text.fallbackFields,
    };
  });
  return { items, nextChangeAt: changes.length > 0 ? Math.min(...changes) : null };
}
