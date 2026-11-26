'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import type {
  CreateCategoryRequest,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from '@/lib/data-access/models';
import {
  createAdminCategory,
  deleteAdminCategory,
  listAdminCategories,
  listStoreCategories,
  reorderAdminCategories,
  updateAdminCategory,
  type CategoryFilters,
} from '@/services/categories';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { invalidateStoreAggregates } from '../store/invalidate';

/**
 * F10 — Hooks de categorías. El árbol público no requiere sesión y se refresca poco (el servidor lo cachea 60 s). La lista
 * admin solo corre con sesión de personal (la API decide: 401/403). Toda mutación invalida el prefijo `categories`.
 */
const STORE_STALE_MS = 60_000;

/** Árbol público de categorías visibles (`GET /v1/store/categories`). */
export function useStoreCategories() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.categories.store,
    queryFn: () => listStoreCategories(client),
    staleTime: STORE_STALE_MS,
  });
}

/** Lista plana del backoffice (activas e inactivas, depth-first). */
export function useAdminCategories(filters: CategoryFilters = {}) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.categories.admin(filters),
    queryFn: () => listAdminCategories(client, filters),
    enabled: Boolean(staff),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.categories.all }),
      invalidateStoreAggregates(qc),
    ]);
}

export function useCreateCategory() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateCategoryRequest) => createAdminCategory(client, input),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCategoryRequest }) =>
      updateAdminCategory(client, id, input),
    onSuccess: invalidate,
  });
}

export function useReorderCategories() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ReorderCategoriesRequest) => reorderAdminCategories(client, input),
    onSuccess: invalidate,
  });
}

/** ADR-0034: borra una categoría sin uso. Invalida lo mismo que editar (admin, árbol público, menú y bootstrap). */
export function useDeleteCategory() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteAdminCategory(client, id),
    onSuccess: invalidate,
  });
}
