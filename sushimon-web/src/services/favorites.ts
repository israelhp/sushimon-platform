import type { CustomerFavorites } from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';
import type { DataClient } from '@/lib/data-access/types';

/**
 * F06 — Favoritos del cliente autenticado (spec 010). El propietario sale SIEMPRE de la sesión (JWT en http): ningún
 * método recibe ni envía un `customerId`. PUT/DELETE no llevan cuerpo y son idempotentes (204).
 *
 * Errores por `code` (nunca por `message`): 404 `PRODUCT_NOT_FOUND`, 422 `FAVORITES_LIMIT_REACHED`,
 * 503 `CATALOG_UNAVAILABLE` (único 5xx con `code`), 429 `RATE_LIMITED`, 401 sin sesión.
 */

/** Tamaño por defecto de la página de Mis favoritos (el servidor admite hasta 50). */
export const FAVORITES_PAGE_SIZE = 20;

export interface FavoritesPageQuery {
  page: number;
  /** 0 = solo `favoriteProductIds`/`total` (sin `items` ni consulta al catálogo): sirve a TODOS los corazones. */
  pageSize: number;
}

export const listMyFavorites = (
  client: DataClient,
  query: FavoritesPageQuery,
  signal?: AbortSignal,
) => client.get<CustomerFavorites>(paths.myFavorites(), { query: { ...query }, signal });

/** Solo los ids (y `total`/`limit`): una única consulta compartida por todas las tarjetas. */
export const listMyFavoriteIds = (client: DataClient, signal?: AbortSignal) =>
  listMyFavorites(client, { page: 1, pageSize: 0 }, signal);

export const addMyFavorite = (client: DataClient, productId: string): Promise<void> =>
  client.put<void>(paths.myFavorite(productId));

export const removeMyFavorite = (client: DataClient, productId: string): Promise<void> =>
  client.delete<void>(paths.myFavorite(productId));
