'use client';

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type {
  BranchAvailability,
  CreateBranchClosureRequest,
  ReplaceBranchHoursRequest,
  UpdateBranchClosureRequest,
} from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  createAdminBranchClosure,
  deleteAdminBranchClosure,
  getAdminBranchHours,
  getBranchAvailability,
  getBranchHours,
  listAdminBranchClosures,
  replaceAdminBranchHours,
  updateAdminBranchClosure,
  type ClosureFilters,
} from '@/services/branch-schedule';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { nextRefetchDelay } from './refetch';

/**
 * F08 — Hooks de horario, disponibilidad y cierres. La tienda CONSUME la disponibilidad del servidor: aquí no se
 * calcula «abierta ahora». La disponibilidad se refresca en `nextTransitionAt` (un temporizador acotado) y al volver a
 * enfocar la ventana; no hay polling por segundo. Los hooks admin solo corren con sesión de personal (la API decide).
 */

/** Horario semanal público + cierres próximos (sin motivo). Cambia poco: 60 s como la caché pública. */
export function usePublicBranchHours(id: string | null) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.branches.hours(id ?? ''),
    queryFn: () => getBranchHours(client, id as string),
    enabled: !!id,
    staleTime: 60_000,
  });
}

const AVAILABILITY_STALE_MS = 10_000;

/** Disponibilidad de varias sucursales (una consulta por sucursal) con refetch en la próxima transición. */
export function useBranchesAvailability(ids: readonly string[]) {
  const client = useDataClient();
  const queryClient = useQueryClient();
  const idsKey = [...new Set(ids)].sort().join(',');
  const unique = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: queryKeys.branches.availability(id),
      queryFn: () => getBranchAvailability(client, id),
      staleTime: AVAILABILITY_STALE_MS,
      refetchOnWindowFocus: true,
    })),
  });
  const updatedKey = results.map((r) => r.dataUpdatedAt).join(',');

  useEffect(
    () => scheduleTransitionRefetch(queryClient, unique),
    [queryClient, unique, updatedKey],
  );

  const byId = useMemo(() => {
    const map: Record<string, BranchAvailability | undefined> = {};
    unique.forEach((id, i) => {
      map[id] = results[i]?.data;
    });
    return map;
    // `results` cambia de identidad en cada render: se recalcula solo cuando llegan datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique, updatedKey]);

  return {
    byId,
    /** Marca de tiempo de la última respuesta por sucursal (para pruebas y diagnóstico). */
    updatedAtById: Object.fromEntries(unique.map((id, i) => [id, results[i]?.dataUpdatedAt ?? 0])),
    isPending: results.some((r) => r.isPending),
    isError: results.some((r) => r.isError),
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  };
}

/** Agenda un refetch en la menor próxima transición de las sucursales dadas. Devuelve la limpieza. */
function scheduleTransitionRefetch(queryClient: QueryClient, ids: readonly string[]) {
  const delays = ids
    .map((id) => {
      const state = queryClient.getQueryState<BranchAvailability>(
        queryKeys.branches.availability(id),
      );
      return nextRefetchDelay(state?.data, state ? Date.now() - state.dataUpdatedAt : 0);
    })
    .filter((d): d is number => d !== null);
  if (!delays.length) return undefined;
  const timer = setTimeout(
    () => {
      for (const id of ids) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.branches.availability(id),
          exact: true,
        });
      }
    },
    Math.min(...delays),
  );
  return () => clearTimeout(timer);
}

/** Disponibilidad de una sucursal. */
export function useBranchAvailability(id: string | null) {
  const { byId, updatedAtById, isPending, isError, refetch } = useBranchesAvailability(
    id ? [id] : [],
  );
  return {
    data: id ? byId[id] : undefined,
    dataUpdatedAt: id ? (updatedAtById[id] ?? 0) : 0,
    isPending: !!id && isPending,
    isError,
    refetch,
  };
}

// ── Admin ────────────────────────────────────────────────────────────────────────────────

export function useAdminBranchHours(id: string | null) {
  const client = useDataClient();
  const enabled = !!useDemoSession().staff && !!id;
  return useQuery({
    queryKey: queryKeys.backoffice.branchHours(id ?? ''),
    queryFn: () => getAdminBranchHours(client, id as string),
    enabled,
  });
}

export function useAdminBranchClosures(id: string | null, filters: ClosureFilters = {}) {
  const client = useDataClient();
  const enabled = !!useDemoSession().staff && !!id;
  return useQuery({
    queryKey: queryKeys.backoffice.branchClosures(id ?? '', filters),
    queryFn: () => listAdminBranchClosures(client, id as string, filters),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/**
 * Tras guardar horario o cierres: invalida SOLO esa sucursal (horario público, disponibilidad, horario y cierres admin).
 * Se espera el refetch: la mutación sigue «pendiente» hasta tener los datos nuevos.
 */
export function invalidateBranchSchedule(queryClient: QueryClient, branchId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.branches.hours(branchId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.branches.availability(branchId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.backoffice.branchSchedule(branchId) }),
  ]);
}

export function useReplaceBranchHours() {
  const client = useDataClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReplaceBranchHoursRequest }) =>
      replaceAdminBranchHours(client, id, input),
    onSuccess: (_data, { id }) => invalidateBranchSchedule(queryClient, id),
  });
}

export function useCreateBranchClosure() {
  const client = useDataClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateBranchClosureRequest }) =>
      createAdminBranchClosure(client, id, input),
    onSuccess: (_data, { id }) => invalidateBranchSchedule(queryClient, id),
  });
}

export function useUpdateBranchClosure() {
  const client = useDataClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      closureId,
      input,
    }: {
      id: string;
      closureId: string;
      input: UpdateBranchClosureRequest;
    }) => updateAdminBranchClosure(client, id, closureId, input),
    onSuccess: (_data, { id }) => invalidateBranchSchedule(queryClient, id),
  });
}

export function useDeleteBranchClosure() {
  const client = useDataClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, closureId }: { id: string; closureId: string }) =>
      deleteAdminBranchClosure(client, id, closureId),
    onSuccess: (_data, { id }) => invalidateBranchSchedule(queryClient, id),
  });
}
