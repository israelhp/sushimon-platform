import { Inject, Injectable } from '@nestjs/common';
import { CategoriesQueryService } from '../categories/categories-query.service.js';
import type { AdminCategoryView } from '../categories/categories.types.js';
import {
  buildPublicViews,
  buildSearchPattern,
  indexVisibleTree,
  notFound,
  subtreeIdsBySlug,
  toAdminView,
  toPublicDetail,
} from './product-policy.js';
import { ProductsRepository } from './products.repository.js';
import type {
  AdminProductCategoryView,
  AdminProductPageView,
  AdminProductView,
  ProductSort,
  PublicProductDetailView,
  PublicProductPageView,
  SortOrder,
  VisibleProductSummary,
} from './products.types.js';

export interface PublicProductsQuery {
  categorySlug?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export interface AdminProductsQuery {
  q?: string;
  categoryId?: string;
  active?: boolean;
  sort: ProductSort;
  order: SortOrder;
  page: number;
  pageSize: number;
}

export const toAdminCategory = (view: AdminCategoryView): AdminProductCategoryView => ({
  id: view.id,
  slug: view.slug,
  name: view.name,
  active: view.active,
  effectivelyVisible: view.effectivelyVisible,
});

/**
 * Lecturas de productos. Exportado para favoritos (F06: `ProductsCatalogAdapter`), y para F13/F17. Visible = producto activo
 * Y categoría efectivamente visible (F10). Sin N+1: una lectura de categorías, una de productos (página + total) y una
 * de media por ids.
 */
@Injectable()
export class ProductsQueryService {
  constructor(
    @Inject(ProductsRepository) private readonly repo: ProductsRepository,
    @Inject(CategoriesQueryService) private readonly categories: CategoriesQueryService,
  ) {}

  async getPublicList(query: PublicProductsQuery): Promise<PublicProductPageView> {
    const pattern = buildSearchPattern(query.q);
    const tree = await this.categories.findVisibleTree();
    const visible = indexVisibleTree(tree);
    const empty = { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    let categoryIds = [...visible.keys()];
    if (query.categorySlug !== undefined) {
      const subtree = subtreeIdsBySlug(tree, query.categorySlug);
      if (subtree === null) return empty;
      categoryIds = subtree;
    }
    if (categoryIds.length === 0) return empty;
    const { rows, total } = await this.repo.findPage({
      categoryIds,
      active: true,
      pattern,
      sort: 'name',
      order: 'asc',
      page: query.page,
      pageSize: query.pageSize,
    });
    const media = await this.repo.findMediaByProductIds(rows.map((r) => r.id));
    return {
      items: buildPublicViews(rows, media, visible),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Ficha visible por slug (con ancestros de la categoría); `null` si no existe, está inactiva o su categoría no es visible. */
  async findVisibleBySlug(slug: string): Promise<PublicProductDetailView | null> {
    const [tree, row] = await Promise.all([
      this.categories.findVisibleTree(),
      this.repo.findBySlug(slug),
    ]);
    if (!row?.active) return null;
    const info = indexVisibleTree(tree).get(row.categoryId);
    if (!info) return null;
    const media = await this.repo.findMediaByProductIds([row.id]);
    return toPublicDetail(row, info, media);
  }

  /** Resumen de los productos VISIBLES entre `ids` (los demás faltan del mapa). Una consulta por tabla, sin N+1. */
  async findVisibleSummariesByIds(
    ids: readonly string[],
  ): Promise<Map<string, VisibleProductSummary>> {
    const unique = [...new Set(ids)];
    const out = new Map<string, VisibleProductSummary>();
    if (unique.length === 0) return out;
    const visibleIds = [...indexVisibleTree(await this.categories.findVisibleTree()).keys()];
    if (visibleIds.length === 0) return out;
    const rows = await this.repo.findActiveByIds(unique, visibleIds);
    const media = await this.repo.findMediaByProductIds(
      rows.map((r) => r.id),
      true,
    );
    const first = new Map(media.map((m) => [m.productId, m.url]));
    for (const row of rows) {
      out.set(row.id, {
        id: row.id,
        name: row.name,
        imageUrl: first.get(row.id) ?? null,
        categoryId: row.categoryId,
      });
    }
    return out;
  }

  async listAdmin(query: AdminProductsQuery): Promise<AdminProductPageView> {
    const pattern = buildSearchPattern(query.q);
    const [page, categories] = await Promise.all([
      this.repo.findPage({
        ...(query.categoryId !== undefined ? { categoryIds: [query.categoryId] } : {}),
        ...(query.active !== undefined ? { active: query.active } : {}),
        pattern,
        searchSlug: true,
        searchSku: true,
        sort: query.sort,
        order: query.order,
        page: query.page,
        pageSize: query.pageSize,
      }),
      this.categories.listAdmin({}),
    ]);
    const media = await this.repo.findMediaByProductIds(page.rows.map((r) => r.id));
    const byCategory = new Map(categories.items.map((c) => [c.id, toAdminCategory(c)]));
    const items = page.rows.map((row) => {
      const category = byCategory.get(row.categoryId);
      if (!category) throw new Error('Producto con categoría inexistente');
      return toAdminView(
        row,
        media.filter((m) => m.productId === row.id),
        category,
      );
    });
    return { items, page: query.page, pageSize: query.pageSize, total: page.total };
  }

  async getAdmin(id: string): Promise<AdminProductView> {
    const [row, categories] = await Promise.all([
      this.repo.findById(id),
      this.categories.listAdmin({}),
    ]);
    if (!row) throw notFound();
    const category = categories.items.find((c) => c.id === row.categoryId);
    if (!category) throw new Error('Producto con categoría inexistente');
    const media = await this.repo.findMediaByProductIds([row.id]);
    return toAdminView(row, media, toAdminCategory(category));
  }
}
