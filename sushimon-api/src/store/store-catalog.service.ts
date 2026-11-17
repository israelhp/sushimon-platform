import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { BranchesQueryService } from '../branches/branches-query.service.js';
import { CLOCK, type Clock } from '../branch-schedule/clock.js';
import { CategoriesQueryService } from '../categories/categories-query.service.js';
import { indexVisibleTree, subtreeIdsBySlug } from '../products/product-policy.js';
import {
  PublicPromotionsService,
  type IndicativePromotion,
} from '../promotions/public-promotions.service.js';
import { StoreCatalogRepository } from './store-catalog.repository.js';
import type { CardFilter, MenuSort, SortDirection } from './store-catalog.types.js';
import { translateStoreDbError } from './store-db-errors.js';
import {
  buildSearchPatterns,
  matchingCategoryIds,
  normalizeSearchText,
  storeBranchNotFound,
} from './store-policy.js';
import { toCard, type StoreCardsPageView, type StoreCardView } from './store-views.js';

export interface StoreMenuInput {
  branchId?: string;
  categorySlug?: string;
  available?: boolean;
  sort: MenuSort;
  order: SortDirection;
  page: number;
  pageSize: number;
}

export interface StoreSearchInput {
  q: string;
  branchId?: string;
  categorySlug?: string;
  available?: boolean;
  page: number;
  pageSize: number;
}

const availableNeedsBranch = (): never => {
  throw new BadRequestException(['available=true exige branchId']);
};

/**
 * Menú paginado y búsqueda pública (F17). COMPOSICIÓN: la visibilidad sale de `CategoriesQueryService` (F10), el precio y
 * la disponibilidad de sucursal de UNA consulta compuesta (F13, ver `StoreCatalogRepository`), las promociones
 * indicativas de `PublicPromotionsService` (F15, una consulta por página) y la sucursal de `BranchesQueryService` (F07).
 * Consultas por solicitud: sucursal ∥ categorías, tarjetas (+ conteo si la página queda vacía y `page > 1`) y
 * candidatas de promoción: ≤ 5, constantes con 10 o 100 productos.
 */
@Injectable()
export class StoreCatalogService {
  constructor(
    @Inject(StoreCatalogRepository) private readonly repo: StoreCatalogRepository,
    @Inject(CategoriesQueryService) private readonly categories: CategoriesQueryService,
    @Inject(BranchesQueryService) private readonly branches: BranchesQueryService,
    @Inject(PublicPromotionsService) private readonly promotions: PublicPromotionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async menu(input: StoreMenuInput): Promise<StoreCardsPageView> {
    try {
      return await this.run({
        branchId: input.branchId,
        categorySlug: input.categorySlug,
        availableOnly: input.available === true,
        sort: input.sort,
        order: input.order,
        page: input.page,
        pageSize: input.pageSize,
        q: null,
      });
    } catch (error) {
      throw translateStoreDbError(error);
    }
  }

  async search(input: StoreSearchInput): Promise<StoreCardsPageView> {
    const text = normalizeSearchText(input.q);
    try {
      return await this.run({
        branchId: input.branchId,
        categorySlug: input.categorySlug,
        availableOnly: input.available === true,
        sort: 'relevance',
        order: 'asc',
        page: input.page,
        pageSize: input.pageSize,
        q: text,
      });
    } catch (error) {
      throw translateStoreDbError(error);
    }
  }

  private async run(args: {
    branchId: string | undefined;
    categorySlug: string | undefined;
    availableOnly: boolean;
    sort: CardFilter['sort'];
    order: SortDirection;
    page: number;
    pageSize: number;
    q: string | null;
  }): Promise<StoreCardsPageView> {
    const branchId = args.branchId ?? null;
    if (args.availableOnly && branchId === null) availableNeedsBranch();
    const at = this.clock.now();
    const [branch, tree] = await Promise.all([
      branchId === null ? Promise.resolve(null) : this.branches.getStatus(branchId),
      this.categories.findVisibleTree(),
    ]);
    if (branchId !== null && !branch?.active) throw storeBranchNotFound();

    const visible = indexVisibleTree(tree);
    let categoryIds = [...visible.keys()]; // depth-first = orden del árbol
    if (args.categorySlug !== undefined) {
      const subtree = subtreeIdsBySlug(tree, args.categorySlug);
      const allowed = new Set(subtree ?? []);
      categoryIds = categoryIds.filter((id) => allowed.has(id));
    }
    const patterns = args.q === null ? null : buildSearchPatterns(args.q);
    const filter: CardFilter = {
      branchId,
      categoryIds,
      availableOnly: args.availableOnly,
      sort: args.sort,
      order: args.order,
      search:
        patterns === null
          ? null
          : {
              contains: patterns.contains,
              prefix: patterns.prefix,
              categoryIds: matchingCategoryIds(
                categoryIds.map((id) => ({ id, name: visible.get(id)?.ref.name ?? '' })),
                patterns.folded,
              ),
            },
      limit: args.pageSize,
      offset: (args.page - 1) * args.pageSize,
    };

    const { rows, total: counted } = await this.repo.findCards(filter);
    const total = counted ?? (args.page > 1 ? await this.repo.countCards(filter) : 0);

    let promos = new Map<string, IndicativePromotion[]>();
    let nextChangeAt: string | null = null;
    if (branchId !== null && rows.length > 0) {
      const found = await this.promotions.findIndicativeForProducts(
        branchId,
        rows.map((r) => ({ id: r.id, price: r.price, available: r.available })),
        { now: at },
      );
      promos = found.byProduct;
      nextChangeAt = found.nextChangeAt;
    }
    const items: StoreCardView[] = [];
    for (const row of rows) {
      const card = toCard(row, visible, promos.get(row.id)?.[0] ?? null);
      if (card) items.push(card);
    }
    return {
      branchId,
      items,
      page: args.page,
      pageSize: args.pageSize,
      total,
      generatedAt: this.clock.now().toISOString(),
      nextChangeAt,
    };
  }
}
