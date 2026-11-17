'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import type { UpdateProductRequest } from '@/lib/data-access/models';
import {
  createAdminProduct,
  listAdminProducts,
  updateAdminProduct,
  type AdminProductFilters,
  type CreateProductInput,
} from '@/services/products';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { invalidateStoreAggregates } from '../store/invalidate';

/**
 * F11 — Hooks de productos del backoffice. La lista solo corre con sesión de personal (la API decide: 401/403) y conserva la
 * página anterior mientras llega la siguiente. Toda mutación invalida `products` y el catálogo unido de la tienda (`catalog`).
 */
export function useAdminProducts(filters: AdminProductFilters = {}) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.products.admin(filters),
    queryFn: () => listAdminProducts(client, filters),
    enabled: Boolean(staff),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.products.all }),
      qc.invalidateQueries({ queryKey: queryKeys.catalog.all }),
      invalidateStoreAggregates(qc),
    ]);
}

export function useCreateProduct() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateProductInput) => createAdminProduct(client, input),
    onSuccess: invalidate,
  });
}

export function useUpdateProduct() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProductRequest }) =>
      updateAdminProduct(client, id, input),
    onSuccess: invalidate,
  });
}
