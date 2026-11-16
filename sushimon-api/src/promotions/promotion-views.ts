import type { GrantScope } from '../identity/identity.types.js';
import type { AdminPromotionDto, AdminPromotionSummaryDto } from './dto/promotion-responses.dto.js';
import type { LocalClock } from './promotion-schedule.js';
import type { PromotionTimeService } from './promotion-time.service.js';
import type { PromotionRecord } from './promotions.types.js';

/** Vistas administrativas (contrato `AdminPromotionSummary` / `AdminPromotion`). Puras salvo el reloj ya resuelto. */

/** ¿La promoción aplica a alguna sucursal del alcance? (`branchIds` vacío = todas). */
export function touches(scope: GrantScope, branchIds: readonly string[]): boolean {
  if (scope.allBranches) return true;
  if (branchIds.length === 0) return scope.branchIds.length > 0;
  return branchIds.some((id) => scope.branchIds.includes(id));
}

/** ¿El alcance cubre TODAS las sucursales de la promoción? (`ALL` exige alcance global). */
export function covers(scope: GrantScope, branchIds: readonly string[]): boolean {
  if (scope.allBranches) return true;
  if (branchIds.length === 0) return false;
  return branchIds.every((id) => scope.branchIds.includes(id));
}

export interface ViewContext {
  nowMs: number;
  /** Hora local de `nowMs`, calculada una vez por solicitud. */
  clock: LocalClock;
  time: PromotionTimeService;
  /** Recorta `branches` de la respuesta. */
  trimScope: GrantScope;
  /** Calcula `editable`. */
  updateScope: GrantScope;
}

export function summaryOf(r: PromotionRecord, ctx: ViewContext): AdminPromotionSummaryDto {
  const branchIds = r.branches.map((b) => b.id);
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    kind: r.kind,
    value: r.value,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    dineInOnly: r.dineInOnly,
    active: r.active,
    lifecycle: ctx.time.lifecycle(r, ctx.nowMs),
    liveNow: ctx.time.liveNow(r, ctx.nowMs, ctx.clock),
    branchScope: r.branches.length === 0 ? 'ALL' : 'SELECTED',
    branches: r.branches
      .filter((b) => ctx.trimScope.allBranches || ctx.trimScope.branchIds.includes(b.id))
      .map((b) => ({ id: b.id, name: b.name })),
    productScope: r.productCount === 0 ? 'ALL' : 'SELECTED',
    productCount: r.productCount,
    scheduleCount: r.schedule.length,
    editable: covers(ctx.updateScope, branchIds),
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function detailOf(r: PromotionRecord, ctx: ViewContext): AdminPromotionDto {
  return {
    ...summaryOf(r, ctx),
    products: r.products.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    schedule: r.schedule.map((s) => ({
      weekday: s.weekday,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
    })),
  };
}
