'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useDataClient } from '@/lib/data-access/provider';
import { isApiError } from '@/lib/data-access/errors';
import { PRODUCT_SEARCH_MAX } from '@/lib/product-rules';
import { listCategories } from '@/services/store';
import { getStoreProduct, listStoreProducts } from '@/services/products';
import { queryKeys } from '../query-keys';
import { useStoreBranchMenu } from '../branch-products/hooks';
import { useOptionalOrderMode } from '../order-mode/order-mode-context';
import {
  applyBranchMenu,
  loadCatalog,
  type CatalogProduct,
  type ProductFilters,
} from './catalog-product';

/** Categorías visibles (incluye la de acceso a Happy Hour, `kind: 'happy_hour'`). */
export function useCategories() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.catalog.categories,
    queryFn: () => listCategories(client),
  });
}

/**
 * Catálogo completo de la tienda: los productos visibles de `GET /v1/store/products` (F11, todas las páginas) COMBINADOS con el
 * overlay de la sucursal elegida `GET /v1/store/menu?branchId=` (F13: precio efectivo y `available`). Lo comparten menú, ficha,
 * carrito, checkout, favoritos y reorden, por eso el precio nunca es el de otra sucursal.
 * - Sin sucursal: precios base (F11) y todo «disponible».
 * - Con sucursal: mientras el overlay carga el catálogo sigue «pendiente»; si el overlay FALLA, se muestran los precios base
 *   y `overlayFailed=true` (la pantalla avisa y el servidor recalcula al pedir). Lo que el overlay no trae no se oferta.
 */
export function useProducts(filters: ProductFilters = {}) {
  const client = useDataClient();
  const selected = useOptionalOrderMode()?.mode.branchId ?? null;
  const branchId = filters.branchId === undefined ? selected : filters.branchId;
  const base = useQuery<CatalogProduct[]>({
    queryKey: queryKeys.catalog.products(),
    queryFn: () => loadCatalog(client),
  });
  const menu = useStoreBranchMenu(branchId);
  const data = useMemo(() => {
    if (!base.data) return undefined;
    return branchId && menu.data ? applyBranchMenu(base.data, menu.data) : base.data;
  }, [base.data, branchId, menu.data]);
  const overlayFailed = Boolean(branchId) && menu.isError;
  const { refetch: refetchBase } = base;
  const { refetch: refetchMenu } = menu;
  return {
    data,
    isPending: base.isPending || (Boolean(branchId) && menu.isPending),
    isError: base.isError,
    error: base.error,
    /** F13: el overlay de la sucursal falló: se muestran precios base con aviso. */
    overlayFailed,
    branchId,
    refetch: () => Promise.all([refetchBase(), branchId ? refetchMenu() : Promise.resolve()]),
  };
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
