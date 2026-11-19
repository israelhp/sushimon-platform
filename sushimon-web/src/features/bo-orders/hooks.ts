'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useDemoSession } from '@/features/session/demo-session';
import { pollMsFrom, usePolledQuery } from '@/features/polling/use-polled-query';
import { queryKeys } from '@/features/query-keys';
import { invalidateOrders } from '@/features/orders/hooks';
import { useDataClient } from '@/lib/data-access/provider';
import type {
  AdminOrderBoard,
  AdminOrderDetail,
  AdminOrderPage,
  AdminOrderSummary,
  AdminOrderTransitionResult,
} from '@/lib/data-access/models';
import {
  getAdminOrder,
  getAdminOrderBoard,
  listAdminOrders,
  runAdminOrderCommand,
  type AdminOrderCommandArgs,
  type AdminOrderListFilters,
} from '@/services/admin-orders';

/**
 * F22 (spec 023 §10): hooks de pedidos REALES del backoffice. Todas las claves llevan a la PERSONA (`staffKey`) y la sucursal o los
 * filtros; no hay `keepPreviousData`: al cambiar de sucursal se ve un esqueleto, nunca el tablero anterior. Ocultar UI por permiso
 * es cosmético: la API decide (401/403/404).
 */

/** Intervalo solo para pruebas (`NEXT_PUBLIC_BO_ORDERS_POLL_MS`), acotado igual a [10, 60] s. No es un secreto ni autorización. */
export function pollOverrideMs(
  raw: string | undefined = process.env.NEXT_PUBLIC_BO_ORDERS_POLL_MS,
) {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const intervalOf = (data: { pollAfterSeconds?: number } | undefined) =>
  pollMsFrom(data?.pollAfterSeconds, pollOverrideMs());

export function useStaffKey(): string | null {
  return useDemoSession().staff?.userId ?? null;
}

/** Tablero agregado de la sucursal (`branchId` = null/undefined → todas las autorizadas). `poll=false` solo observa. */
export function useAdminOrderBoard(branchId: string | null | undefined, { poll = true } = {}) {
  const client = useDataClient();
  const staffKey = useStaffKey();
  return usePolledQuery<AdminOrderBoard>({
    queryKey: queryKeys.backoffice.adminOrders.board(staffKey, branchId),
    enabled: staffKey !== null,
    poll,
    fetcher: (signal) => getAdminOrderBoard(client, branchId ?? undefined, signal),
    intervalMs: intervalOf,
  });
}

interface MorePages {
  keyId: string;
  items: AdminOrderSummary[];
  nextCursor: string | null;
  loading: boolean;
  error: Error | null;
}

/** Listado paginado por cursor: la PRIMERA página se sondea; «Cargar más» añade páginas con `cursor` (keyset estable). */
export function useAdminOrderList(
  filters: AdminOrderListFilters,
  { poll = true, enabled = true }: { poll?: boolean; enabled?: boolean } = {},
) {
  const client = useDataClient();
  const staffKey = useStaffKey();
  const queryKey = queryKeys.backoffice.adminOrders.list(staffKey, filters);
  const keyId = JSON.stringify(queryKey);
  const first = usePolledQuery<AdminOrderPage>({
    queryKey,
    enabled: staffKey !== null && enabled,
    poll,
    fetcher: (signal) => listAdminOrders(client, filters, null, signal),
    intervalMs: () => pollMsFrom(undefined, pollOverrideMs()),
  });
  const [more, setMore] = useState<MorePages | null>(null);
  const extra = more && more.keyId === keyId ? more : null;

  const firstIds = new Set((first.data?.items ?? []).map((o) => o.id));
  const items = [
    ...(first.data?.items ?? []),
    ...(extra?.items ?? []).filter((o) => !firstIds.has(o.id)),
  ];
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
      const page = await listAdminOrders(client, filters, cursor);
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

  return {
    ...first,
    items,
    nextCursor,
    loadingMore: extra?.loading ?? false,
    moreError: extra?.error ?? null,
    loadMore,
  };
}

/**
 * Detalle completo (con historial). No sondea: se refresca al abrir, tras un comando (la invalidación lo cubre) y cuando el
 * `updatedAt` de su tarjeta cambia (lo comprueba el drawer contra el tablero).
 */
export function useAdminOrderDetail(id: string | null) {
  const client = useDataClient();
  const staffKey = useStaffKey();
  return useQuery<AdminOrderDetail, Error>({
    queryKey: queryKeys.backoffice.adminOrders.detail(staffKey, id ?? ''),
    queryFn: ({ signal }) => getAdminOrder(client, id ?? '', signal),
    enabled: staffKey !== null && id !== null,
    retry: false,
    gcTime: 60_000,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });
}

/**
 * Comando de transición. SIN actualización optimista: el estado lo decide el servidor. Tras CADA resultado (éxito, 409, 422…) se
 * invalidan tablero, listado y detalle; en un éxito se mezcla en el detalle la tarjeta CONFIRMADA por el servidor.
 */
export function useAdminOrderCommand() {
  const client = useDataClient();
  const qc = useQueryClient();
  const staffKey = useStaffKey();
  return useMutation<AdminOrderTransitionResult, Error, AdminOrderCommandArgs>({
    mutationFn: (args) => runAdminOrderCommand(client, args),
    onSuccess: (result, args) => {
      qc.setQueryData<AdminOrderDetail>(
        queryKeys.backoffice.adminOrders.detail(staffKey, args.id),
        (detail) => (detail ? { ...detail, ...result.order } : detail),
      );
    },
    onSettled: () => {
      invalidateOrders(qc);
    },
  });
}
