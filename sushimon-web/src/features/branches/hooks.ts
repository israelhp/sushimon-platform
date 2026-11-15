'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  CreateBranchRequest,
  UpdateBranchRequest,
  UpdateBranchStatusRequest,
} from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  createAdminBranch,
  getAdminBranch,
  getPublicBranch,
  listAdminBranches,
  listPublicBranches,
  setAdminBranchStatus,
  updateAdminBranch,
  type AdminBranchFilters,
} from '@/services/branches';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';

/**
 * F07 — Hooks de sucursales (contrato `/v1/branches` y `/v1/admin/branches`). Los hooks admin solo corren con sesión
 * de personal; ocultar UI es cosmético: la API decide (JWT + permiso `branches` + aal2).
 */

/** Sucursales activas (público): para el selector de la tienda. */
export function usePublicBranches() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.store.publicBranches,
    queryFn: () => listPublicBranches(client),
  });
}

export function usePublicBranch(id: string | null) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.store.publicBranch(id ?? ''),
    queryFn: () => getPublicBranch(client, id as string),
    enabled: !!id,
  });
}

export function useAdminBranches(filters: AdminBranchFilters = {}) {
  const client = useDataClient();
  const enabled = !!useDemoSession().staff;
  return useQuery({
    queryKey: queryKeys.backoffice.adminBranches(filters),
    queryFn: () => listAdminBranches(client, filters),
    enabled,
    // Mantiene la página anterior mientras llega la nueva (sin parpadeo al filtrar/paginar).
    placeholderData: (previous) => previous,
  });
}

export function useAdminBranch(id: string | null) {
  const client = useDataClient();
  const enabled = !!useDemoSession().staff && !!id;
  return useQuery({
    queryKey: queryKeys.backoffice.adminBranch(id ?? ''),
    queryFn: () => getAdminBranch(client, id as string),
    enabled,
  });
}

/**
 * Claves a invalidar tras una mutación (sin invalidar toda la app):
 * - crear: lista admin + lista pública + operación simulada (aparece la nueva fila);
 * - actualizar: detalle admin + listas admin + públicas (nombre/dirección/teléfono) + operación;
 * - estado: lo mismo y, además, la cobertura de entrega (el conjunto de sucursales activas cambió).
 */
export function branchInvalidationKeys(
  kind: 'create' | 'update' | 'status',
  id?: string,
): QueryKey[] {
  const keys: QueryKey[] = [
    queryKeys.backoffice.adminBranchLists,
    queryKeys.store.publicBranches,
    queryKeys.store.branchOperations,
  ];
  if (kind !== 'create' && id) keys.push(queryKeys.backoffice.adminBranch(id));
  if (kind === 'status') keys.push(queryKeys.deliveryCoverage.all);
  return keys;
}

function useBranchMutation<TArgs, TResult>(
  kind: 'create' | 'update' | 'status',
  fn: (args: TArgs) => Promise<TResult>,
  idOf: (args: TArgs) => string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Se espera el refetch: mientras tanto la mutación sigue «pendiente» y la UI no repite la acción.
    onSuccess: (_data, args) =>
      Promise.all(
        branchInvalidationKeys(kind, idOf(args)).map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

export function useCreateBranch() {
  const client = useDataClient();
  return useBranchMutation(
    'create',
    (input: CreateBranchRequest) => createAdminBranch(client, input),
    () => undefined,
  );
}

export function useUpdateBranch() {
  const client = useDataClient();
  return useBranchMutation(
    'update',
    ({ id, input }: { id: string; input: UpdateBranchRequest }) =>
      updateAdminBranch(client, id, input),
    (args) => args.id,
  );
}

export function useSetBranchStatus() {
  const client = useDataClient();
  return useBranchMutation(
    'status',
    ({ id, input }: { id: string; input: UpdateBranchStatusRequest }) =>
      setAdminBranchStatus(client, id, input),
    (args) => args.id,
  );
}
