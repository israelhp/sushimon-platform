'use client';

import { useQuery } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import {
  listCategories,
  listProducts,
  listPromotions,
  type ProductFilters,
} from '@/services/store';
import { queryKeys } from '../query-keys';

/** Categorías visibles (incluye la de acceso a Happy Hour, `kind: 'happy_hour'`). */
export function useCategories() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.catalog.categories,
    queryFn: () => listCategories(client),
  });
}

/** Menú; `available` refleja la sucursal indicada (o cualquiera activa si no se indica). */
export function useProducts(filters: ProductFilters = {}) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.catalog.products(filters),
    queryFn: () => listProducts(client, filters),
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
