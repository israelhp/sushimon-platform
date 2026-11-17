'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import type {
  CreateModifierGroupRequest,
  CreateModifierRequest,
  UpdateModifierGroupRequest,
  UpdateModifierRequest,
} from '@/lib/data-access/models';
import {
  createAdminModifier,
  createAdminModifierGroup,
  getAdminModifierGroup,
  getAdminProductModifiers,
  listAdminModifierGroups,
  reorderAdminModifiers,
  replaceAdminProductModifierGroups,
  updateAdminModifier,
  updateAdminModifierGroup,
  type ModifierGroupFilters,
} from '@/services/modifiers';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { invalidateStoreAggregates } from '../store/invalidate';

/**
 * F12 — Hooks de modificadores del backoffice. Las lecturas solo corren con sesión de personal (la API decide: 401/403).
 * Toda mutación invalida el prefijo `modifiers` (grupos, detalle, asociaciones) y las fichas públicas de la tienda
 * (`products.storeDetails`: los `modifierGroups` viajan en la ficha). La lista de grupos conserva la página anterior.
 */
export function useAdminModifierGroups(filters: ModifierGroupFilters = {}, enabled = true) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.modifiers.groups(filters),
    queryFn: () => listAdminModifierGroups(client, filters),
    enabled: Boolean(staff) && enabled,
    placeholderData: keepPreviousData,
  });
}

/** Detalle de un grupo con TODAS sus opciones (activas e inactivas). */
export function useAdminModifierGroup(id: string | null) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.modifiers.group(id ?? ''),
    queryFn: () => getAdminModifierGroup(client, id as string),
    enabled: Boolean(staff) && Boolean(id),
  });
}

/** Grupos asociados a un producto (activos e inactivos), con opciones. */
export function useAdminProductModifiers(productId: string | null) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.modifiers.product(productId ?? ''),
    queryFn: () => getAdminProductModifiers(client, productId as string),
    enabled: Boolean(staff) && Boolean(productId),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.modifiers.all }),
      invalidateStoreAggregates(qc),
    ]);
}

export function useCreateModifierGroup() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateModifierGroupRequest) => createAdminModifierGroup(client, input),
    onSuccess: invalidate,
  });
}

export function useUpdateModifierGroup() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateModifierGroupRequest }) =>
      updateAdminModifierGroup(client, id, input),
    onSuccess: invalidate,
  });
}

export function useCreateModifier() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ groupId, input }: { groupId: string; input: CreateModifierRequest }) =>
      createAdminModifier(client, groupId, input),
    onSuccess: invalidate,
  });
}

export function useUpdateModifier() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateModifierRequest }) =>
      updateAdminModifier(client, id, input),
    onSuccess: invalidate,
  });
}

export function useReorderModifiers() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ groupId, orderedIds }: { groupId: string; orderedIds: string[] }) =>
      reorderAdminModifiers(client, groupId, { orderedIds }),
    onSuccess: invalidate,
  });
}

/** REEMPLAZA la lista de grupos de un producto (≤ 10). */
export function useReplaceProductModifierGroups() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ productId, groupIds }: { productId: string; groupIds: string[] }) =>
      replaceAdminProductModifierGroups(client, productId, groupIds),
    onSuccess: invalidate,
  });
}
