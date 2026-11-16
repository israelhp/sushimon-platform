import { Inject, Injectable } from '@nestjs/common';
import { MediaUrlService } from '../media/media-url.service.js';
import { HORIZON_MS } from '../promotions/promotion-schedule.js';
import { branchNotFound } from './banner-policy.js';
import { translateBannerDbError } from './banner-db-errors.js';
import { selectStoreBanners } from './banner-selection.js';
import { BannersReadRepository } from './banners-read.repository.js';
import { BannersTimeService } from './banners-time.service.js';
import type { ActiveBanners, FindActiveBannersInput } from './banners.types.js';

/** Banners no vencidos que puede haber (tope de la API: 100); se leen todos para calcular `nextChangeAt`. */
export const LOAD_LIMIT = 200;

/**
 * Lector público REUTILIZABLE de banners (spec D10). Lo consume `GET /v1/store/banners` y, después, F17 (agregado de la
 * tienda) importando solo este proveedor exportado. No conoce nada administrativo. Solo elegibles AHORA (máx. 10), con
 * respaldo `es` por campo, imagen pública permanente, sin datos de promoción. Una sucursal inexistente o inactiva es
 * 404 `BRANCH_NOT_FOUND`; la falta de base pública de imágenes oculta el banner (nunca 5xx).
 */
@Injectable()
export class PublicBannersReader {
  constructor(
    @Inject(BannersReadRepository) private readonly repo: BannersReadRepository,
    @Inject(BannersTimeService) private readonly time: BannersTimeService,
    @Inject(MediaUrlService) private readonly urls: MediaUrlService,
  ) {}

  async findActiveBanners(input: FindActiveBannersInput): Promise<ActiveBanners> {
    const branchId = input.branchId ?? null;
    try {
      if (branchId !== null) {
        const branch = await this.repo.findBranchStatus(branchId);
        if (!branch?.active) throw branchNotFound();
      }
      const now = this.time.now();
      const nowMs = now.getTime();
      const candidates = await this.repo.findStoreCandidates({
        branchId,
        now,
        horizon: new Date(nowMs + HORIZON_MS),
        limit: LOAD_LIMIT,
      });
      const promotionIds = [
        ...new Set(candidates.flatMap((c) => (c.promotionId === null ? [] : [c.promotionId]))),
      ];
      const promotions = await this.repo.findLinkedPromotions(promotionIds);
      const { items, nextChangeAt } = selectStoreBanners({
        candidates,
        promotions,
        branchId,
        locale: input.locale,
        nowMs,
        timeZone: this.time.timeZone,
        imageUrl: (key) => this.urls.tryPublicUrl(key),
      });
      return {
        items,
        nextChangeAt: nextChangeAt === null ? null : new Date(nextChangeAt).toISOString(),
        generatedAt: now.toISOString(),
      };
    } catch (error) {
      throw translateBannerDbError(error);
    }
  }
}
