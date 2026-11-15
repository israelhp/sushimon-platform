import { Inject, Injectable } from '@nestjs/common';
import { MAX_FAVORITES_PER_CUSTOMER } from './favorites.constants.js';
import { FavoritesRepository } from './favorites.repository.js';

/** Token del lector de favoritos que consumirá F17 (`GET /v1/me/storefront`). */
export const CUSTOMER_FAVORITES_READER = Symbol('CUSTOMER_FAVORITES_READER');

export interface CustomerFavoritesReader {
  /** Ids de producto favoritos (≤ 200), más recientes primero. Recibe el id de `customers`, no el de Auth. */
  getFavoriteProductIds(customerId: string): Promise<string[]>;
}

/** Sin catálogo: una sola consulta por el índice de listado. */
@Injectable()
export class PrismaCustomerFavoritesReader implements CustomerFavoritesReader {
  constructor(@Inject(FavoritesRepository) private readonly repo: FavoritesRepository) {}

  getFavoriteProductIds(customerId: string): Promise<string[]> {
    return this.repo.listProductIds(customerId, MAX_FAVORITES_PER_CUSTOMER);
  }
}
