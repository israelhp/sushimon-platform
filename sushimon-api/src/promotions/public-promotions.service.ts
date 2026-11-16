import { Inject, Injectable } from '@nestjs/common';
import { BranchOffersService } from '../branch-products/branch-offers.service.js';
import type { BranchOffer } from '../branch-products/branch-products.types.js';
import { CategoriesQueryService } from '../categories/categories-query.service.js';
import type {
  StorePromotionDto,
  StorePromotionItemDto,
  StorePromotionListDto,
} from './dto/promotion-responses.dto.js';
import { computeLineDiscount } from './promotion-evaluator.js';
import { centsToDecimal } from './promotion-money.js';
import { branchNotFound } from './promotion-policy.js';
import { HORIZON_MS, type PromotionTiming } from './promotion-schedule.js';
import { PromotionTimeService } from './promotion-time.service.js';
import { PromotionsRepository } from './promotions.repository.js';
import type { ProductBasics, StoreCandidateRecord } from './promotions.types.js';

/** Tope de promociones devueltas; se leen hasta `LOAD_LIMIT` para calcular `nextChangeAt` con todas. */
export const MAX_STORE_PROMOTIONS = 100;
export const LOAD_LIMIT = 200;
export const MAX_STORE_ITEMS = 50;
const MAX_RESOLVE_CHUNK = 200;
/** Lotes de ids para `findProductBasics` (evita parámetros ilimitados). */
export const BASICS_CHUNK = 1000;
/** Productos candidatos a mostrar por promoción (el tope de `items` es {@link MAX_STORE_ITEMS}). */
const MAX_ITEM_CANDIDATES = MAX_STORE_ITEMS;

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * Lectura pública de promociones de una sucursal (spec F15, «Público»): solo informativa. NUNCA devuelve `code`; una
 * promoción con código sale con `requiresCode=true` y sin `kind`, `value`, `productIds` ni `items`. Los precios de
 * `items` son INDICATIVOS (cantidad 1, precio de sucursal F13, esa promoción por sí sola) y se calculan con
 * `computeLineDiscount`, la misma función del evaluador que usará F19.
 */
@Injectable()
export class PublicPromotionsService {
  constructor(
    @Inject(PromotionsRepository) private readonly repo: PromotionsRepository,
    @Inject(PromotionTimeService) private readonly time: PromotionTimeService,
    @Inject(BranchOffersService) private readonly offers: BranchOffersService,
    @Inject(CategoriesQueryService) private readonly categories: CategoriesQueryService,
  ) {}

  async list(branchId: string, state: 'live' | 'upcoming'): Promise<StorePromotionListDto> {
    const now = this.time.now();
    const nowMs = now.getTime();
    const branch = await this.repo.findBranchStatus(branchId);
    if (!branch?.active) throw branchNotFound();

    const loaded = await this.repo.findCandidates({
      branchId,
      startsBefore: new Date(nowMs + HORIZON_MS),
      endsAfter: now,
      codes: 'all',
      omitCouponProducts: true,
      limit: LOAD_LIMIT + 1,
    });
    const loadedTruncated = loaded.length > LOAD_LIMIT;
    const candidates = loaded.slice(0, LOAD_LIMIT);

    const shared = this.time.sharedFor(nowMs);
    const analyzed = candidates.map((c) => ({ c, t: this.time.timing(c, nowMs, shared) }));
    const changes = analyzed.flatMap(({ t }) => (t.nextChangeAt === null ? [] : [t.nextChangeAt]));
    const nextChangeAt = changes.length > 0 ? Math.min(...changes) : null;

    const matching = analyzed
      .filter(({ t }) => (state === 'live' ? t.live : t.upcoming))
      .sort(
        (a, b) =>
          a.c.startsAt.getTime() - b.c.startsAt.getTime() ||
          (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0),
      );
    const truncated = loadedTruncated || matching.length > MAX_STORE_PROMOTIONS;
    const shown = matching.slice(0, MAX_STORE_PROMOTIONS);

    const itemsByPromotion = await this.indicativeItems(
      branchId,
      shown.map((s) => s.c),
    );
    return {
      branchId,
      generatedAt: now.toISOString(),
      nextChangeAt: iso(nextChangeAt),
      truncated,
      items: shown.map(({ c, t }) => this.view(c, t, state, itemsByPromotion.get(c.id))),
    };
  }

  private view(
    c: StoreCandidateRecord,
    t: PromotionTiming,
    state: 'live' | 'upcoming',
    items: StorePromotionItemDto[] | undefined,
  ): StorePromotionDto {
    const requiresCode = c.code !== null;
    const selected = c.hasProducts;
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      requiresCode,
      isHappyHour: !requiresCode && c.schedule.length > 0,
      dineInOnly: c.dineInOnly,
      state,
      ...(requiresCode ? {} : { kind: c.kind, value: c.value }),
      validFrom: c.startsAt.toISOString(),
      validUntil: c.endsAt.toISOString(),
      schedule: c.schedule.map((s) => ({
        weekday: s.weekday,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      })),
      nextStartsAt: iso(t.nextStartsAt),
      nextEndsAt: state === 'live' ? iso(t.nextEndsAt) : null,
      productScope: selected ? 'SELECTED' : 'ALL',
      ...(selected && !requiresCode ? { productIds: [...c.productIds] } : {}),
      ...(items ? { items } : {}),
    };
  }

  private async findBasicsChunked(ids: readonly string[]): Promise<ProductBasics[]> {
    const out: ProductBasics[] = [];
    for (let i = 0; i < ids.length; i += BASICS_CHUNK) {
      out.push(...(await this.repo.findProductBasics(ids.slice(i, i + BASICS_CHUNK))));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Precios indicativos de las automáticas con productos seleccionados: dos lecturas + F13 por tandas, sin N+1. */
  private async indicativeItems(
    branchId: string,
    promotions: readonly StoreCandidateRecord[],
  ): Promise<Map<string, StorePromotionItemDto[]>> {
    const wanted = promotions.filter((p) => p.code === null && p.productIds.length > 0);
    const out = new Map<string, StorePromotionItemDto[]>();
    if (wanted.length === 0) return out;
    // Solo se necesitan, por promoción, los productos que podrían mostrarse: se recortan ANTES de leer.
    const shownIds = [
      ...new Set(wanted.flatMap((p) => p.productIds.slice(0, MAX_ITEM_CANDIDATES))),
    ];
    const [basics, visibleCategories] = await Promise.all([
      this.findBasicsChunked(shownIds),
      this.categories.getVisibleIds(),
    ]);
    const visibleCategory = new Set(visibleCategories);
    const visible = basics.filter((b) => b.active && visibleCategory.has(b.categoryId));
    const offers = new Map<string, BranchOffer>();
    const visibleIds = visible.map((v) => v.id);
    for (let i = 0; i < visibleIds.length; i += MAX_RESOLVE_CHUNK) {
      const chunk = await this.offers.resolve(branchId, visibleIds.slice(i, i + MAX_RESOLVE_CHUNK));
      for (const [id, offer] of chunk) offers.set(id, offer);
    }
    for (const p of wanted) {
      const inPromotion = new Set(p.productIds.slice(0, MAX_ITEM_CANDIDATES));
      const items: StorePromotionItemDto[] = [];
      for (const product of visible) {
        if (items.length >= MAX_STORE_ITEMS) break;
        if (!inPromotion.has(product.id)) continue;
        const offer = offers.get(product.id);
        if (!offer?.available) continue;
        const { discountCents, finalCents } = computeLineDiscount(p.kind, p.value, offer.price, 1);
        if (discountCents <= 0) continue;
        items.push({
          productId: product.id,
          regularPrice: offer.price,
          promoPrice: centsToDecimal(finalCents),
        });
      }
      out.set(p.id, items);
    }
    return out;
  }
}
