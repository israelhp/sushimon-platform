import { Inject, Injectable, Logger } from '@nestjs/common';
import { isUuid } from '../branch-products/branch-product-policy.js';
import { normalizeCouponCode, type EvaluatorPromotion } from './promotion-evaluator.js';
import { CODE_PATTERN } from './promotion-policy.js';
import { PromotionsRepository } from './promotions.repository.js';

/** Tope de candidatas leídas por evaluación (spec F15). */
export const MAX_CANDIDATES = 200;
const WARN_EVERY_MS = 60_000;

/**
 * Carga las promociones candidatas de una sucursal para el evaluador (lo llamará F19). Solo lectura, UNA consulta
 * (las hijas viajan agregadas): sin N+1. Devuelve las `active` de esa sucursal (propias y «todas») con
 * `starts_at <= at < ends_at`, automáticas más la del cupón enviado (comparación normalizada). Una promoción con
 * código sin el código NUNCA se devuelve. No evalúa horario semanal ni modo: eso lo hace el evaluador.
 */
@Injectable()
export class PromotionCandidatesService {
  private readonly logger = new Logger(PromotionCandidatesService.name);

  /** Último `warn` por sucursal: como máximo uno por minuto (con tráfico alto sería ruido en cada cotización). */
  private readonly lastWarn = new Map<string, number>();

  private shouldWarn(branchId: string): boolean {
    const now = Date.now();
    const last = this.lastWarn.get(branchId);
    if (last !== undefined && now - last < WARN_EVERY_MS) return false;
    if (this.lastWarn.size >= 1_000) this.lastWarn.clear();
    this.lastWarn.set(branchId, now);
    return true;
  }

  constructor(@Inject(PromotionsRepository) private readonly repo: PromotionsRepository) {}

  /**
   * `truncated=true` si había más de {@link MAX_CANDIDATES} candidatas y se recortó: F19 NO debe tratarlo como
   * «cupón inválido» en silencio (el cupón pedido va primero y nunca se recorta, pero las automáticas sí podrían).
   */
  async load(
    branchId: string,
    at: Date,
    couponCode?: string | null,
  ): Promise<{ promotions: EvaluatorPromotion[]; truncated: boolean }> {
    if (!isUuid(branchId) || !(at instanceof Date) || Number.isNaN(at.getTime())) {
      return { promotions: [], truncated: false };
    }
    const normalized = normalizeCouponCode(couponCode);
    // Un código con formato imposible no puede existir: se evalúa como «sin cupón» y el evaluador lo reportará UNKNOWN.
    const coupon = normalized !== null && CODE_PATTERN.test(normalized) ? normalized : null;
    const rows = await this.repo.findCandidates({
      branchId,
      startsBefore: at,
      endsAfter: at,
      codes: { coupon },
      omitCouponProducts: false,
      limit: MAX_CANDIDATES + 1,
    });
    const truncated = rows.length > MAX_CANDIDATES;
    // Sin PII ni códigos de cupón en el log.
    if (truncated && this.shouldWarn(branchId)) {
      this.logger.warn(
        `Candidatas de promoción truncadas (branch=${branchId}, tope=${MAX_CANDIDATES})`,
      );
    }
    const promotions = rows.slice(0, MAX_CANDIDATES).map((r) => ({
      id: r.id,
      code: r.code,
      kind: r.kind,
      value: r.value,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      dineInOnly: r.dineInOnly,
      active: r.active,
      branchIds: r.branchIds.length === 0 ? ('ALL' as const) : r.branchIds,
      productIds: r.productIds.length === 0 ? ('ALL' as const) : r.productIds,
      schedule: r.schedule,
    }));
    return { promotions, truncated };
  }
}
