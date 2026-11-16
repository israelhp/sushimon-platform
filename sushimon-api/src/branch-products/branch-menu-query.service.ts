import { Inject, Injectable } from '@nestjs/common';
import { CategoriesQueryService } from '../categories/categories-query.service.js';
import { branchNotFound } from './branch-product-policy.js';
import { BranchProductsRepository } from './branch-products.repository.js';
import type { StoreBranchMenuView } from './branch-products.types.js';

/**
 * Overlay público de UNA sucursal (spec F13 D4): tres lecturas constantes (sucursal, categorías visibles F10 y
 * productos activos con `LEFT JOIN branch_products` de ESA sucursal). Nunca toca datos de otra sucursal.
 */
@Injectable()
export class BranchMenuQueryService {
  constructor(
    @Inject(BranchProductsRepository) private readonly repo: BranchProductsRepository,
    @Inject(CategoriesQueryService) private readonly categories: CategoriesQueryService,
  ) {}

  async getMenu(branchId: string): Promise<StoreBranchMenuView> {
    const [branch, categoryIds] = await Promise.all([
      this.repo.findBranchStatus(branchId),
      this.categories.getVisibleIds(),
    ]);
    if (!branch?.active) throw branchNotFound();
    const rows = await this.repo.findOverlay(branchId, categoryIds);
    return {
      branchId,
      items: rows.map((r) => ({
        productId: r.id,
        slug: r.slug,
        price: r.price,
        available: r.available,
      })),
    };
  }
}
