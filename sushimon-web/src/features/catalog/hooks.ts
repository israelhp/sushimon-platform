'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import { isApiError } from '@/lib/data-access/errors';
import { PRODUCT_SEARCH_MAX } from '@/lib/product-rules';
import { listCategories, listPromotions } from '@/services/store';
import { getStoreProduct, listStoreProducts } from '@/services/products';
import { queryKeys } from '../query-keys';
import { loadCatalog, type CatalogProduct, type ProductFilters } from './catalog-product';

/** Categorías visibles (incluye la de acceso a Happy Hour, `kind: 'happy_hour'`). */
export function useCategories() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.catalog.categories,
    queryFn: () => listCategories(client),
  });
}

/**
 * Catálogo completo de la tienda (F11): los productos visibles de `GET /v1/store/products` (todas las páginas) con lo que
 * F11 no provee SIMULADO (ver `catalog-product.ts`). Lo comparten menú, carrito, checkout, favoritos y reorden.
 */
export function useProducts(filters: ProductFilters = {}) {
  const client = useDataClient();
  return useQuery<CatalogProduct[]>({
    queryKey: queryKeys.catalog.products(filters),
    queryFn: () => loadCatalog(client, filters),
  });
}

const SEARCH_PAGE_SIZE = 20;

/**
 * Búsqueda en el servidor (`q`: nombre, descripción o SKU) con paginación «Ver más». Solo corre con texto (≤ 80); pasa el valor
 * YA con debounce.
 */
export function useStoreProductSearch(q: string) {
  const client = useDataClient();
  const text = q.trim().slice(0, PRODUCT_SEARCH_MAX);
  return useInfiniteQuery({
    queryKey: queryKeys.products.storeSearch(text),
    queryFn: ({ pageParam }) =>
      listStoreProducts(client, { q: text, page: pageParam, pageSize: SEARCH_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    enabled: text.length > 0,
    staleTime: 30_000,
  });
}

/**
 * Ficha pública por slug (`GET /v1/store/products/{slug}`): trae `categoryAncestors` para el breadcrumb. 404
 * `PRODUCT_NOT_FOUND` no se reintenta (inactivo, categoría oculta o inexistente).
 */
export function useStoreProduct(slug: string | null) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.products.storeDetail(slug ?? ''),
    queryFn: () => getStoreProduct(client, slug as string),
    enabled: Boolean(slug),
    staleTime: 30_000,
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 2,
  });
}

/** Promociones activas con `status` (current/scheduled/expired) e ítems de Happy Hour. */
export function usePromotions() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.catalog.promotions,
    queryFn: () => listPromotions(client),
  });
}
