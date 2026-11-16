import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { loadLinkedPromotions } from './linked-promotions.query.js';
import type {
  BannerCtaType,
  BannerPage,
  BannerText,
  LinkedPromotion,
  StoreCandidate,
} from './banners.types.js';

interface RawTranslation {
  locale: string;
  title: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  imageAlt: string | null;
}

interface RawCandidate {
  id: string;
  sort_order: number;
  created_at: Date;
  starts_at: Date | null;
  ends_at: Date | null;
  cta_type: string;
  cta_page: string | null;
  cta_product_id: string | null;
  promotion_id: string | null;
  category_slug: string | null;
  target_active: boolean | null;
  object_key: string;
  mime_type: string;
  translations: RawTranslation[];
}

export interface CandidateQuery {
  /** `null` = sin sucursal (solo banners de todas las sucursales). */
  branchId: string | null;
  now: Date;
  /** Banners que empiezan hasta este instante (para `nextChangeAt`). */
  horizon: Date;
  limit: number;
}

const textOf = (t: RawTranslation | undefined): BannerText | null =>
  t ? { title: t.title, subtitle: t.subtitle, ctaLabel: t.ctaLabel, imageAlt: t.imageAlt } : null;

/**
 * Lectura pública de banners (F16 D10/D11): DOS consultas (candidatos con traducciones, imagen y destino; y las
 * promociones vinculadas) y cómputo en memoria. No conoce nada administrativo: `PublicBannersReader` lo usa solo a él.
 */
@Injectable()
export class BannersReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findBranchStatus(id: string): Promise<{ id: string; active: boolean } | null> {
    return this.prisma.branch.findUnique({ where: { id }, select: { id: true, active: true } });
  }

  /**
   * Candidatos: activos, no vencidos, que empiezan dentro del horizonte, de la sucursal (o de todas), con imagen READY
   * de tipo BANNER_IMAGE y fila `es` válida. El filtro fino por tiempo, promoción y destino lo hace
   * `selectStoreBanners` (pura). Orden `sort_order, created_at, id`.
   */
  async findStoreCandidates(q: CandidateQuery): Promise<StoreCandidate[]> {
    const rows = await this.prisma.$queryRaw<RawCandidate[]>`
      SELECT b.id::text AS id, b.sort_order, b.created_at, b.starts_at, b.ends_at, b.cta_type, b.cta_page,
             b.cta_product_id::text AS cta_product_id, b.promotion_id::text AS promotion_id,
             c.slug AS category_slug,
             CASE b.cta_type WHEN 'CATEGORY' THEN c.active WHEN 'PRODUCT' THEN p.active ELSE NULL END AS target_active,
             ma.object_key, ma.mime_type,
             COALESCE((SELECT json_agg(json_build_object('locale', t.locale, 'title', t.title, 'subtitle', t.subtitle,
                                                         'ctaLabel', t.cta_label, 'imageAlt', t.image_alt))
                         FROM app.banner_translations t WHERE t.banner_id = b.id), '[]'::json) AS translations
        FROM app.banners b
        JOIN app.media_assets ma ON ma.id = b.image_asset_id AND ma.status = 'READY' AND ma.kind = 'BANNER_IMAGE'
        LEFT JOIN app.categories c ON c.id = b.cta_category_id
        LEFT JOIN app.products p ON p.id = b.cta_product_id
       WHERE b.active
         AND (b.ends_at IS NULL OR b.ends_at > ${q.now}::timestamptz)
         AND (b.starts_at IS NULL OR b.starts_at <= ${q.horizon}::timestamptz)
         AND (NOT EXISTS (SELECT 1 FROM app.banner_branches b0 WHERE b0.banner_id = b.id)
              OR (${q.branchId}::uuid IS NOT NULL
                  AND EXISTS (SELECT 1 FROM app.banner_branches b1
                               WHERE b1.banner_id = b.id AND b1.branch_id = ${q.branchId}::uuid)))
         AND EXISTS (SELECT 1 FROM app.banner_translations te
                      WHERE te.banner_id = b.id AND te.locale = 'es' AND te.title IS NOT NULL AND te.image_alt IS NOT NULL)
       ORDER BY b.sort_order ASC, b.created_at ASC, b.id ASC
       LIMIT ${q.limit}::int`;
    return rows.map((r) => ({
      id: r.id,
      sortOrder: Number(r.sort_order),
      createdAt: r.created_at,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      ctaType: r.cta_type as BannerCtaType,
      categorySlug: r.category_slug,
      productId: r.cta_product_id,
      page: r.cta_page as BannerPage | null,
      targetActive: r.target_active,
      promotionId: r.promotion_id,
      imageObjectKey: r.object_key,
      imageMimeType: r.mime_type,
      translations: {
        es: textOf(r.translations.find((t) => t.locale === 'es')),
        en: textOf(r.translations.find((t) => t.locale === 'en')),
      },
    }));
  }

  /** Tiempo de las promociones vinculadas a los candidatos (sin código ni descuento). */
  findLinkedPromotions(ids: readonly string[]): Promise<Map<string, LinkedPromotion>> {
    return loadLinkedPromotions(this.prisma, ids);
  }
}
