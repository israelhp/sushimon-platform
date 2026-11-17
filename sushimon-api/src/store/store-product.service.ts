import { Inject, Injectable } from '@nestjs/common';
import { BranchOffersService } from '../branch-products/branch-offers.service.js';
import { CLOCK, type Clock } from '../branch-schedule/clock.js';
import { BranchesQueryService } from '../branches/branches-query.service.js';
import { notFound } from '../products/product-policy.js';
import { ProductsQueryService } from '../products/products-query.service.js';
import type { PublicProductDetailView } from '../products/products.types.js';
import {
  PublicPromotionsService,
  type IndicativePromotion,
} from '../promotions/public-promotions.service.js';
import { translateStoreDbError } from './store-db-errors.js';
import { MAX_DETAIL_PROMOTIONS, storeBranchNotFound } from './store-policy.js';

/** Ficha pública; con `branchId` añade la oferta de la sucursal y las promociones indicativas (aditivo, F17). */
export interface StoreProductDetailView extends PublicProductDetailView {
  offer?: { branchId: string; price: string; available: boolean };
  promotions?: IndicativePromotion[];
  generatedAt?: string;
  nextChangeAt?: string | null;
}

/**
 * Ficha de producto (F11/F12) más la oferta de sucursal (F13) y las promociones indicativas (F15). Sin `branchId` es
 * IDÉNTICA a la anterior. Consultas con `branchId`: las 4 de la ficha + sucursal (en paralelo con ellas) + oferta + candidatas.
 */
@Injectable()
export class StoreProductService {
  constructor(
    @Inject(ProductsQueryService) private readonly products: ProductsQueryService,
    @Inject(BranchesQueryService) private readonly branches: BranchesQueryService,
    @Inject(BranchOffersService) private readonly offers: BranchOffersService,
    @Inject(PublicPromotionsService) private readonly promotions: PublicPromotionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getDetail(slug: string, branchId?: string): Promise<StoreProductDetailView> {
    try {
      const at = this.clock.now();
      const [product, branch] = await Promise.all([
        this.products.findVisibleBySlug(slug),
        branchId === undefined ? Promise.resolve(null) : this.branches.getStatus(branchId),
      ]);
      if (!product) throw notFound();
      if (branchId === undefined) return product;
      if (!branch?.active) throw storeBranchNotFound();
      const resolved = (await this.offers.resolve(branchId, [product.id])).get(product.id);
      if (!resolved) throw notFound();
      const found = await this.promotions.findIndicativeForProducts(
        branchId,
        [{ id: product.id, price: resolved.price, available: resolved.available }],
        { now: at },
      );
      return {
        ...product,
        offer: { branchId, price: resolved.price, available: resolved.available },
        promotions: (found.byProduct.get(product.id) ?? []).slice(0, MAX_DETAIL_PROMOTIONS),
        generatedAt: this.clock.now().toISOString(),
        nextChangeAt: found.nextChangeAt,
      };
    } catch (error) {
      throw translateStoreDbError(error);
    }
  }
}
