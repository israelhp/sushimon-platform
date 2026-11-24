'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useAdminRiders } from '@/features/bo-riders/hooks';
import { useStaffKey, pollOverrideMs } from '@/features/bo-orders/hooks';
import { pollMsFrom, usePolledQuery } from '@/features/polling/use-polled-query';
import { queryKeys } from '@/features/query-keys';
import type {
  AdminDelivery,
  AdminDeliveryCommandResult,
  AdminDeliveryPage,
  AdminDeliverySummary,
  AdminRiderSummary,
} from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import type { DataClient } from '@/lib/data-access/types';
import {
  assignOwnRiderToAdminDelivery,
  cancelAdminDelivery,
  createAdminDelivery,
  getAdminDelivery,
  listAdminDeliveries,
  markAdminDeliveryDelivered,
  markAdminDeliveryPickedUp,
  returnAdminDeliveryToBranch,
  unassignRiderFromAdminDelivery,
  type AdminDeliveryFilters,
} from '@/services/admin-deliveries';
import {
  ELIGIBLE_RIDERS_LIMIT,
  MAX_BUSY_RETRIES,
  applyCurrent,
  busyDelayMs,
  classifyDeliveryError,
  isDeliveriesBusy,
  eligibleRiders,
} from './delivery-model';

/**
 * F28 (spec 029 §13): consultas y comandos de entregas propias. Las claves llevan a la PERSONA (`staffKey`) y los filtros/el id:
 * nunca se mezclan datos entre personas ni sucursales y el contenido (PII del detalle) no se persiste en el navegador. Refresco
 * DIRIGIDO: la primera página del listado se sondea con intervalo acotado y pausa con la pestaña oculta; el detalle abierto se
 * refresca con `refetchInterval` acotado (también pausado en segundo plano) y TODO comando invalida listas y detalle. SIN
 * actualización optimista: nada se da por hecho hasta que el servidor responde. Reintento automático solo de LECTURAS con 503.
 */

/** Intervalo del detalle abierto (ms): acotado y mayor que el de la lista para no duplicar carga. */
export const DETAIL_REFRESH_MS = 30_000;

const retryBusy = (count: number, error: unknown) =>
  isDeliveriesBusy(error) && count < MAX_BUSY_RETRIES;

interface MorePages {
  keyId: string;
  items: AdminDeliverySummary[];
  nextCursor: string | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Listado por cursor: la PRIMERA página se sondea (pausa con la pestaña oculta); «Cargar más» añade páginas con `cursor` (keyset
 * estable). `reset` descarta las páginas extra tras un comando (la fila pudo cambiar de estado o salir del filtro).
 */
export function useAdminDeliveryList(
  filters: AdminDeliveryFilters,
  { poll = true, enabled = true }: { poll?: boolean; enabled?: boolean } = {},
) {
  const client = useDataClient();
  const staffKey = useStaffKey();
  const queryKey = queryKeys.backoffice.adminDeliveries.list(staffKey, filters);
  const keyId = JSON.stringify(queryKey);
  const first = usePolledQuery<AdminDeliveryPage>({
    queryKey,
    enabled: staffKey !== null && enabled,
    poll,
    fetcher: (signal) => listAdminDeliveries(client, filters, null, signal),
    intervalMs: () => pollMsFrom(undefined, pollOverrideMs()),
  });
  const [more, setMore] = useState<MorePages | null>(null);
  const extra = more && more.keyId === keyId ? more : null;

  const firstItems = first.data?.items;
  const extraItems = extra?.items;
  const items = useMemo(() => {
    const head = firstItems ?? [];
    const firstIds = new Set(head.map((d) => d.id));
    return [...head, ...(extraItems ?? []).filter((d) => !firstIds.has(d.id))];
  }, [firstItems, extraItems]);
  const nextCursor = extra ? extra.nextCursor : (first.data?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    const cursor = extra ? extra.nextCursor : (first.data?.nextCursor ?? null);
    if (!cursor || extra?.loading) return;
    const base: MorePages = extra ?? {
      keyId,
      items: [],
      nextCursor: cursor,
      loading: false,
      error: null,
    };
    setMore({ ...base, loading: true, error: null });
    try {
      const page = await listAdminDeliveries(client, filters, cursor);
      setMore({
        keyId,
        items: [...base.items, ...page.items],
        nextCursor: page.nextCursor,
        loading: false,
        error: null,
      });
    } catch (error) {
      setMore({ ...base, loading: false, error: error as Error });
    }
  }, [client, filters, first.data?.nextCursor, extra, keyId]);

  const reset = useCallback(() => setMore(null), []);

  return {
    ...first,
    items,
    nextCursor,
    loadingMore: extra?.loading ?? false,
    moreError: extra?.error ?? null,
    loadMore,
    reset,
  };
}

/** Detalle con historial y, solo si `contactVisible`, contacto y dirección (PII; sin caché larga). Se refresca con intervalo acotado. */
export function useAdminDelivery(id: string | null) {
  const client = useDataClient();
  const staffKey = useStaffKey();
  return useQuery<AdminDelivery, Error>({
    queryKey: queryKeys.backoffice.adminDeliveries.detail(staffKey, id ?? ''),
    queryFn: ({ signal }) => getAdminDelivery(client, id ?? '', signal),
    enabled: staffKey !== null && id !== null,
    retry: retryBusy,
    retryDelay: (_n, error) => busyDelayMs(error),
    gcTime: 60_000,
    staleTime: 0,
    refetchOnWindowFocus: false,
    // Pausa con la pestaña oculta (`refetchIntervalInBackground` es `false` por defecto) y se detiene ante un error de negocio.
    refetchInterval: (query) => (query.state.status === 'error' ? false : DETAIL_REFRESH_MS),
  });
}

/**
 * Motoristas ELEGIBLES de una sucursal para asignar (contrato `GET /v1/admin/riders?branchId&availability=AVAILABLE&active=true`,
 * requiere `riders.read`; reutiliza el servicio de F27). La lista se vuelve a filtrar en cosmético (activo, disponible, sin otra
 * entrega); el servidor revalida con 422 `RIDER_NOT_ELIGIBLE`.
 */
export function useEligibleRiders(
  branchId: string | null,
  currentRiderId: string | null,
  enabled = true,
) {
  const query = useAdminRiders({
    branchId: branchId ?? undefined,
    active: true,
    availability: 'AVAILABLE',
    sort: 'fullName',
    order: 'asc',
    page: 1,
    pageSize: ELIGIBLE_RIDERS_LIMIT,
  });
  const riders: AdminRiderSummary[] =
    enabled && branchId ? eligibleRiders(query.data?.items ?? [], branchId, currentRiderId) : [];
  return { ...query, riders };
}

// ── Comandos ──────────────────────────────────────────────────────────────────────────────

export type DeliveryCommandInput =
  | { kind: 'create'; orderId: string }
  | { kind: 'assign'; id: string; riderId: string; expectedVersion: number }
  | { kind: 'unassign'; id: string; expectedVersion: number; reason?: string }
  | { kind: 'pickedUp'; id: string; expectedVersion: number }
  | { kind: 'delivered'; id: string; expectedVersion: number }
  | { kind: 'return'; id: string; expectedVersion: number }
  | { kind: 'cancel'; id: string; expectedVersion: number; reason: string };

export function runDeliveryCommand(
  client: DataClient,
  input: DeliveryCommandInput,
): Promise<AdminDeliveryCommandResult> {
  switch (input.kind) {
    case 'create':
      return createAdminDelivery(client, input.orderId);
    case 'assign':
      return assignOwnRiderToAdminDelivery(client, input.id, {
        riderId: input.riderId,
        expectedVersion: input.expectedVersion,
      });
    case 'unassign':
      return unassignRiderFromAdminDelivery(client, input.id, {
        expectedVersion: input.expectedVersion,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    case 'pickedUp':
      return markAdminDeliveryPickedUp(client, input.id, {
        expectedVersion: input.expectedVersion,
      });
    case 'delivered':
      return markAdminDeliveryDelivered(client, input.id, {
        expectedVersion: input.expectedVersion,
      });
    case 'return':
      return returnAdminDeliveryToBranch(client, input.id, {
        expectedVersion: input.expectedVersion,
      });
    case 'cancel':
      return cancelAdminDelivery(client, input.id, {
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      });
  }
}

/** Comandos que cambian la ocupación de un motorista (asignar, quitar, cancelar la entrega, retorno). */
const AFFECTS_RIDERS: readonly DeliveryCommandInput['kind'][] = [
  'assign',
  'unassign',
  'cancel',
  'return',
];
/** Comandos que mueven el estado del pedido (recoger, entregar) o lo condicionan (cancelar). */
const AFFECTS_ORDERS: readonly DeliveryCommandInput['kind'][] = ['pickedUp', 'delivered', 'cancel'];

/**
 * Un comando de entrega. SIN actualización optimista. Refresco DIRIGIDO tras cada resultado: el listado y el detalle de entregas
 * siempre; pedidos solo con recoger/entregar/cancelar y motoristas solo con asignar/quitar/cancelar/retorno, y SOLO si el comando
 * se aplicó. Ante un 409 (con `current` se aplica de inmediato) o un `replayed` no se tocó nada más: se relee únicamente la entrega
 * afectada (detalle y listados), sin pedidos ni motoristas.
 */
export function useDeliveryCommand() {
  const client = useDataClient();
  const staffKey = useStaffKey();
  const qc = useQueryClient();
  const keys = queryKeys.backoffice.adminDeliveries;
  return useMutation<AdminDeliveryCommandResult, Error, DeliveryCommandInput>({
    mutationFn: (input) => runDeliveryCommand(client, input),
    onSuccess: (result) => {
      // La respuesta ya trae la fila vigente (resumen): se refleja en el detalle abierto hasta que llegue la relectura.
      qc.setQueryData<AdminDelivery>(keys.detail(staffKey, result.delivery.id), (old) =>
        old ? { ...old, ...result.delivery } : old,
      );
    },
    onError: (error, input) => {
      if (input.kind === 'create') return;
      const classified = classifyDeliveryError(error);
      if (classified.kind === 'stateConflict' && classified.current) {
        qc.setQueryData<AdminDelivery>(keys.detail(staffKey, input.id), (old) =>
          old ? applyCurrent(old, classified.current) : old,
        );
      }
    },
    onSettled: async (result, error, input) => {
      const applied = !error && result !== undefined && !result.transition.replayed;
      if (!applied) {
        // 409/404/422/red o `replayed`: solo la entrega afectada (y sus listados). Sin `id` (crear) basta el listado.
        await Promise.all([
          qc.invalidateQueries({ queryKey: keys.lists(staffKey) }),
          input.kind === 'create'
            ? Promise.resolve()
            : qc.invalidateQueries({ queryKey: keys.detail(staffKey, input.id) }),
        ]);
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.all }),
        AFFECTS_ORDERS.includes(input.kind)
          ? qc.invalidateQueries({ queryKey: queryKeys.backoffice.adminOrders.all })
          : Promise.resolve(),
        AFFECTS_RIDERS.includes(input.kind)
          ? qc.invalidateQueries({ queryKey: queryKeys.backoffice.adminRiders.all })
          : Promise.resolve(),
      ]);
    },
  });
}
