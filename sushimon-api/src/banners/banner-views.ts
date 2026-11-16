import type { GrantScope } from '../identity/identity.types.js';
import { isLive, lifecycleOf as promotionLifecycleOf } from '../promotions/promotion-schedule.js';
import { covers, lifecycleOf, promotionCoversBanner } from './banner-policy.js';
import type { BannerHiddenReason, BannerRecord, BannerText } from './banners.types.js';
import type { AdminBannerDto, AdminBannerSummaryDto } from './dto/banner-responses.dto.js';

/** Vistas administrativas (contrato `AdminBannerSummary` / `AdminBanner`). Puras: reciben el reloj ya resuelto. */

export interface ViewContext {
  nowMs: number;
  timeZone: string;
  /** Recorta `branches` de la respuesta. */
  trimScope: GrantScope;
  /** Calcula `editable`. */
  updateScope: GrantScope;
  /** URL pública permanente; `null` sin base pública. */
  imageUrl: (objectKey: string) => string | null;
}

/**
 * Motivo por el que un banner `PUBLISHED` no se muestra ahora (spec D7/D3/D2) o `null`. Para el admin la promoción debe
 * cubrir el alcance del banner (cada sucursal que el banner cubre) y estar vigente ahora.
 */
export function hiddenReasonOf(r: BannerRecord, ctx: ViewContext): BannerHiddenReason | null {
  if (r.promotion) {
    const scope = r.branches.length === 0 ? 'ALL' : 'SELECTED';
    const covered = promotionCoversBanner(
      r.promotion.branchIds,
      scope,
      r.branches.map((b) => b.id),
    );
    if (!covered || !isLive(r.promotion, ctx.nowMs, ctx.timeZone)) return 'PROMOTION_NOT_LIVE';
  }
  if (r.cta.targetActive === false) return 'CTA_TARGET_INACTIVE';
  if (ctx.imageUrl(r.image.objectKey) === null) return 'IMAGE_UNAVAILABLE';
  return null;
}

const textOf = (t: BannerText | null) =>
  t === null
    ? null
    : { title: t.title, subtitle: t.subtitle, ctaLabel: t.ctaLabel, imageAlt: t.imageAlt };

export function summaryOf(r: BannerRecord, ctx: ViewContext): AdminBannerSummaryDto {
  const branchIds = r.branches.map((b) => b.id);
  const lifecycle = lifecycleOf(r, ctx.nowMs);
  const hiddenReason = lifecycle === 'PUBLISHED' ? hiddenReasonOf(r, ctx) : null;
  return {
    id: r.id,
    code: r.code,
    title: r.translations.es?.title ?? '',
    image: {
      assetId: r.image.assetId,
      url: ctx.imageUrl(r.image.objectKey),
      mimeType: r.image.mimeType,
      sizeBytes: r.image.sizeBytes,
    },
    cta: {
      type: r.cta.type,
      categoryId: r.cta.categoryId,
      productId: r.cta.productId,
      page: r.cta.page,
      targetLabel: r.cta.targetLabel,
      targetActive: r.cta.targetActive,
    },
    branchScope: r.branches.length === 0 ? 'ALL' : 'SELECTED',
    branches: r.branches
      .filter((b) => ctx.trimScope.allBranches || ctx.trimScope.branchIds.includes(b.id))
      .map((b) => ({ id: b.id, name: b.name })),
    // Referencia mínima: NUNCA el código ni el descuento de un cupón.
    promotion: r.promotion
      ? {
          id: r.promotion.id,
          name: r.promotion.name,
          lifecycle: promotionLifecycleOf(r.promotion, ctx.nowMs),
        }
      : null,
    startsAt: r.startsAt ? r.startsAt.toISOString() : null,
    endsAt: r.endsAt ? r.endsAt.toISOString() : null,
    active: r.active,
    sortOrder: r.sortOrder,
    lifecycle,
    visibleNow: lifecycle === 'PUBLISHED' && hiddenReason === null,
    hiddenReason,
    hasEnglish: r.translations.en?.title != null,
    editable: covers(ctx.updateScope, branchIds),
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function detailOf(r: BannerRecord, ctx: ViewContext): AdminBannerDto {
  return {
    ...summaryOf(r, ctx),
    translations: {
      es: textOf(r.translations.es) ?? {
        title: null,
        subtitle: null,
        ctaLabel: null,
        imageAlt: null,
      },
      en: textOf(r.translations.en),
    },
  };
}
