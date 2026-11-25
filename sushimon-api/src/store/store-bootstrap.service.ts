import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { StoreBannerView } from '../banners/banners.types.js';
import { PublicBannersReader } from '../banners/public-banners.reader.js';
import { BranchAvailabilityService } from '../branch-schedule/branch-availability.service.js';
import type { BranchAvailabilityDto } from '../branch-schedule/dto/branch-schedule-responses.dto.js';
import { CLOCK, type Clock } from '../branch-schedule/clock.js';
import { BranchesQueryService } from '../branches/branches-query.service.js';
import type { PublicBranchView } from '../branches/branches.types.js';
import { CategoriesQueryService } from '../categories/categories-query.service.js';
import { indexVisibleTree } from '../products/product-policy.js';
import { PublicPromotionsService } from '../promotions/public-promotions.service.js';
import type { StorePromotionDto } from '../promotions/dto/promotion-responses.dto.js';
import { STORE_DB_GATE, type StoreDbGate } from './concurrency.js';
import { StoreCatalogRepository } from './store-catalog.repository.js';
import { translateStoreDbError } from './store-db-errors.js';
import {
  earliestIso,
  MAX_BOOTSTRAP_BANNERS,
  MAX_BOOTSTRAP_CATEGORIES,
  MAX_BOOTSTRAP_PROMOTIONS,
  storeBranchNotFound,
} from './store-policy.js';
import type { StoreCardView } from './store-views.js';

/** Una advertencia por sección y minuto por proceso (una sección que falla de forma persistente no inunda el log). */
const WARN_EVERY_MS = 60_000;

export type StoreBootstrapSection = 'availability' | 'featured' | 'promotions' | 'banners';

export interface StoreBootstrapView {
  generatedAt: string;
  nextChangeAt: string | null;
  branchId: string | null;
  branch: PublicBranchView | null;
  availability: BranchAvailabilityDto | null;
  categories: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    hasChildren: boolean;
  }[];
  featured: StoreCardView[];
  promotions: StorePromotionDto[];
  banners: StoreBannerView[];
  productCount: number;
  degraded: StoreBootstrapSection[];
}

/**
 * Agregado de arranque del Inicio (F17, ADR-0023). COMPOSICIÓN sin reglas propias: cada sección sale del lector de su
 * módulo. Críticas (fallo => error): sucursal, categorías, `productCount`. Opcionales e independientes (fallo => 200 con
 * la sección vacía y su nombre en `degraded`): `availability`, `promotions`, `banners` (`featured` no tiene fuente: P23).
 * Concurrencia acotada por `STORE_CONCURRENCY` (el pool tiene pocas conexiones).
 */
@Injectable()
export class StoreBootstrapService {
  private readonly logger = new Logger(StoreBootstrapService.name);
  private readonly lastWarn = new Map<string, number>();

  constructor(
    @Inject(BranchesQueryService) private readonly branches: BranchesQueryService,
    @Inject(CategoriesQueryService) private readonly categories: CategoriesQueryService,
    @Inject(StoreCatalogRepository) private readonly catalog: StoreCatalogRepository,
    @Inject(BranchAvailabilityService) private readonly availability: BranchAvailabilityService,
    @Inject(PublicPromotionsService) private readonly promotions: PublicPromotionsService,
    @Inject(PublicBannersReader) private readonly banners: PublicBannersReader,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORE_DB_GATE) private readonly gate: StoreDbGate,
  ) {}

  private async loadBranch(id: string): Promise<PublicBranchView> {
    try {
      return await this.branches.getPublicById(id);
    } catch (error) {
      if (error instanceof NotFoundException) throw storeBranchNotFound();
      throw error;
    }
  }

  async getBootstrap(input: { branchId?: string }): Promise<StoreBootstrapView> {
    try {
      return await this.build(input);
    } catch (error) {
      throw translateStoreDbError(error);
    }
  }

  private async build(input: { branchId?: string }): Promise<StoreBootstrapView> {
    const branchId = input.branchId ?? null;
    const at = this.clock.now();
    // Etapa 1 (críticas, en paralelo): sucursal y árbol de categorías.
    const [branch, tree] = await Promise.all([
      branchId === null ? Promise.resolve(null) : this.loadBranch(branchId),
      this.categories.findVisibleTree(),
    ]);
    const visibleIds = [...indexVisibleTree(tree).keys()];

    // Etapa 2: contador (crítico) y secciones opcionales; como mucho `concurrency` lecturas a la vez.
    const limit = <T>(task: () => Promise<T>) => this.gate.run(task);
    const [count, availability, promotions, banners] = await Promise.allSettled([
      limit(() => this.catalog.countVisible(visibleIds)),
      limit(() =>
        branchId === null ? Promise.resolve(null) : this.availability.getPublic(branchId),
      ),
      limit(() =>
        branchId === null
          ? Promise.resolve(null)
          : this.promotions.list(branchId, 'live', {
              compact: true,
              limit: MAX_BOOTSTRAP_PROMOTIONS,
              branchValidated: true,
              now: at,
            }),
      ),
      limit(() => this.banners.findActiveBanners()),
    ]);
    if (count.status === 'rejected') throw count.reason;

    const degraded: StoreBootstrapSection[] = [];
    const ok = <T>(name: StoreBootstrapSection, result: PromiseSettledResult<T>): T | null => {
      if (result.status === 'fulfilled') return result.value;
      degraded.push(name);
      const reason = result.reason as { name?: unknown } | null;
      const nowMs = Date.now();
      if (nowMs - (this.lastWarn.get(name) ?? 0) >= WARN_EVERY_MS) {
        this.lastWarn.set(name, nowMs);
        this.logger.warn(
          `Sección del Inicio degradada: ${name} (${typeof reason?.name === 'string' ? reason.name : 'error'})`,
        );
      }
      return null;
    };
    const availabilityView = ok('availability', availability);
    const promotionList = ok('promotions', promotions);
    const bannerList = ok('banners', banners);

    return {
      generatedAt: this.clock.now().toISOString(),
      // Los banners ya no dependen del tiempo (ADR-0033): no intervienen en `nextChangeAt`.
      nextChangeAt: earliestIso([promotionList?.nextChangeAt, availabilityView?.nextTransitionAt]),
      branchId,
      branch,
      availability: availabilityView,
      categories: tree.slice(0, MAX_BOOTSTRAP_CATEGORIES).map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        hasChildren: c.children.length > 0,
      })),
      // P23 (sin decidir): no hay columna ni criterio de destacados; vacío y SIN `degraded` (no es un fallo).
      featured: [],
      promotions: (promotionList?.items ?? []).slice(0, MAX_BOOTSTRAP_PROMOTIONS),
      banners: (bannerList ?? []).slice(0, MAX_BOOTSTRAP_BANNERS),
      productCount: count.value,
      degraded,
    };
  }
}
