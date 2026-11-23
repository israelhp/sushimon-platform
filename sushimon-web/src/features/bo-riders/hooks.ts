'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicBranches } from '@/features/branches/hooks';
import { queryKeys } from '@/features/query-keys';
import { useStaffKey } from '@/features/bo-orders/hooks';
import type {
  AdminRider,
  AdminRiderPage,
  CreateRiderRequest,
  RiderAvailability,
  UpdateRiderRequest,
  UpdateRiderStatusRequest,
} from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { riderOperationalState } from '@/lib/rider-rules';
import {
  createAdminRider,
  getAdminRider,
  listAdminRiders,
  setAdminRiderAvailability,
  setAdminRiderStatus,
  updateAdminRider,
  type AdminRiderFilters,
} from '@/services/admin-riders';
import { MAX_BUSY_RETRIES, busyDelayMs, isRidersBusy } from './rider-model';

/**
 * F27 (spec 028 §12): consultas y comandos de motoristas propios. Las claves llevan a la PERSONA (`staffKey`) y los filtros/ el
 * id, así que cambiar de sucursal/filtros cambia la clave y nunca se mezclan datos entre personas. Sin persistencia del
 * contenido (PII) en el navegador. Reintento AUTOMÁTICO solo del 503 `RIDERS_BUSY` y acotado (2 veces, respetando `Retry-After`);
 * el resto de errores se muestra y la persona decide. Ocultar acciones es cosmético: la API decide (403/404).
 */

/**
 * Sucursales activas (id + nombre) del contrato REAL de F07 (`GET /v1/branches`). El shell sigue con la fuente MOCK_ONLY
 * de operaciones, que en modo http llega vacía; aquí no se depende de ella. El alcance por persona lo da `can(permiso, id)`.
 */
export function useRiderBranches(): readonly { id: string; name: string }[] {
  const query = usePublicBranches();
  return query.data ?? [];
}

const retryBusy = (count: number, error: unknown) =>
  isRidersBusy(error) && count < MAX_BUSY_RETRIES;

/** Listado paginado (`riders.read`). Mantiene la página anterior mientras llega la nueva (sin parpadeo al filtrar). */
export function useAdminRiders(filters: AdminRiderFilters) {
  const client = useDataClient();
  const staffKey = useStaffKey();
  return useQuery<AdminRiderPage, Error>({
    queryKey: queryKeys.backoffice.adminRiders.list(staffKey, filters),
    queryFn: ({ signal }) => listAdminRiders(client, filters, signal),
    enabled: staffKey !== null,
    placeholderData: (previous) => previous,
    retry: retryBusy,
    retryDelay: (_n, error) => busyDelayMs(error),
    refetchOnWindowFocus: false,
  });
}

/** Detalle con teléfono completo y placa (`riders.read`). Sin caché larga: es PII. */
export function useAdminRider(id: string | null, enabled = true) {
  const client = useDataClient();
  const staffKey = useStaffKey();
  return useQuery<AdminRider, Error>({
    queryKey: queryKeys.backoffice.adminRiders.detail(staffKey, id ?? ''),
    queryFn: ({ signal }) => getAdminRider(client, id ?? '', signal),
    enabled: staffKey !== null && id !== null && enabled,
    retry: retryBusy,
    retryDelay: (_n, error) => busyDelayMs(error),
    gcTime: 60_000,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** Tras CADA resultado (éxito, 409, 404…) se refrescan listas y detalle: ante un conflicto el estado real cambió. */
function useRiderSettled() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.backoffice.adminRiders.all });
}

export function useCreateRider() {
  const client = useDataClient();
  const staffKey = useStaffKey();
  const qc = useQueryClient();
  const settled = useRiderSettled();
  return useMutation<AdminRider, Error, CreateRiderRequest>({
    mutationFn: (input) => createAdminRider(client, input),
    onSuccess: (created) =>
      qc.setQueryData(queryKeys.backoffice.adminRiders.detail(staffKey, created.id), created),
    onSettled: settled,
  });
}

export function useUpdateRider() {
  const client = useDataClient();
  const staffKey = useStaffKey();
  const qc = useQueryClient();
  const settled = useRiderSettled();
  return useMutation<AdminRider, Error, { id: string; input: UpdateRiderRequest }>({
    mutationFn: ({ id, input }) => updateAdminRider(client, id, input),
    onSuccess: (rider) =>
      qc.setQueryData(queryKeys.backoffice.adminRiders.detail(staffKey, rider.id), rider),
    onSettled: settled,
  });
}

/** Activar/desactivar (idempotente: el reintento de `RIDERS_BUSY` es seguro). */
export function useSetRiderStatus() {
  const client = useDataClient();
  const staffKey = useStaffKey();
  const qc = useQueryClient();
  const settled = useRiderSettled();
  return useMutation<AdminRider, Error, { id: string; input: UpdateRiderStatusRequest }>({
    mutationFn: ({ id, input }) => setAdminRiderStatus(client, id, input),
    retry: retryBusy,
    retryDelay: (_n, error) => busyDelayMs(error),
    onSuccess: (rider) =>
      qc.setQueryData(queryKeys.backoffice.adminRiders.detail(staffKey, rider.id), rider),
    onSettled: settled,
  });
}

interface AvailabilityContext {
  lists: [readonly unknown[], AdminRiderPage | undefined][];
  detail: AdminRider | undefined;
}

/**
 * Disponibilidad manual con actualización OPTIMISTA y reversión en error (spec §12). El servidor decide: tras el resultado se
 * refresca todo. Nunca fija `BUSY` (no existe en `RiderAvailability`).
 */
export function useSetRiderAvailability() {
  const client = useDataClient();
  const staffKey = useStaffKey();
  const qc = useQueryClient();
  const settled = useRiderSettled();
  return useMutation<
    AdminRider,
    Error,
    { id: string; availability: RiderAvailability },
    AvailabilityContext
  >({
    mutationFn: ({ id, availability }) => setAdminRiderAvailability(client, id, { availability }),
    retry: retryBusy,
    retryDelay: (_n, error) => busyDelayMs(error),
    onMutate: async ({ id, availability }) => {
      const listsKey = queryKeys.backoffice.adminRiders.lists(staffKey);
      const detailKey = queryKeys.backoffice.adminRiders.detail(staffKey, id);
      await qc.cancelQueries({ queryKey: queryKeys.backoffice.adminRiders.all });
      const lists = qc.getQueriesData<AdminRiderPage>({ queryKey: listsKey });
      const detail = qc.getQueryData<AdminRider>(detailKey);
      const patch = <
        T extends {
          active: boolean;
          busy: boolean;
          availability: RiderAvailability;
          operationalState: string;
        },
      >(
        r: T,
      ): T => ({
        ...r,
        availability,
        operationalState: riderOperationalState(r.active, availability, r.busy),
      });
      for (const [key, page] of lists) {
        if (!page) continue;
        qc.setQueryData<AdminRiderPage>(key, {
          ...page,
          items: page.items.map((r) => (r.id === id ? patch(r) : r)),
        });
      }
      if (detail) qc.setQueryData<AdminRider>(detailKey, patch(detail));
      return { lists, detail };
    },
    onError: (_error, { id }, context) => {
      for (const [key, page] of context?.lists ?? []) qc.setQueryData(key, page);
      if (context?.detail) {
        qc.setQueryData(queryKeys.backoffice.adminRiders.detail(staffKey, id), context.detail);
      }
    },
    onSuccess: (rider) =>
      qc.setQueryData(queryKeys.backoffice.adminRiders.detail(staffKey, rider.id), rider),
    onSettled: settled,
  });
}
