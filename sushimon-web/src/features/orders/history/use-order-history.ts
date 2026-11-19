'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import type { MyOrderPage } from '@/lib/data-access/models';
import { listMyOrders } from '@/services/orders';
import { queryKeys } from '../../query-keys';
import { useCustomerScope } from '../../session/customer-scope';
import {
  mergePages,
  rangeProblem,
  toListFilters,
  type HistoryGate,
  type OrderHistoryFilters,
} from './history-model';

/** Valor del `scope` sin identidad: la consulta queda deshabilitada y nunca se llena. */
const NO_SCOPE = 'none';

/**
 * F23 (spec 024 §9.2) — Historial REAL del cliente (`GET /v1/me/orders`) con cursor y «Cargar más».
 *  - La clave lleva la IDENTIDAD y los filtros (`['customer', scope, 'orders', 'history', filtros]`): otra cuenta jamás lee la caché
 *    ajena y `useCustomerCacheGuard` la descarta al cerrar sesión o cambiar de cuenta. Sin `keepPreviousData` entre filtros.
 *  - SIN sesión (o con la identidad aún resolviéndose) NO se emite ninguna solicitud (la API respondería 401).
 *  - Sin sondeo: se refresca al montar, al volver el foco y tras crear un pedido (`invalidateOrders`). `gcTime` 60 s, sin reintentos
 *    automáticos (un 429/503 se muestra con «Reintentar» y la espera de `Retry-After`).
 *  - Un rango de fechas inválido no se envía (la pantalla lo explica); el servidor igualmente lo validaría (400).
 */
export function useMyOrderHistory(filters: OrderHistoryFilters) {
  const client = useDataClient();
  const identity = useCustomerScope();
  const scope = identity.state === 'ready' ? identity.scope : NO_SCOPE;
  const validRange = rangeProblem(filters.from, filters.to) === null;
  const query = useInfiniteQuery<MyOrderPage>({
    queryKey: queryKeys.customer.orders.history(scope, filters),
    queryFn: ({ pageParam, signal }) =>
      listMyOrders(client, toListFilters(filters), pageParam as string | null, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: identity.state === 'ready' && validRange,
    gcTime: 60_000,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const gate: HistoryGate =
    identity.state === 'ready' ? 'ready' : identity.state === 'pending' ? 'pending' : 'signed-out';
  return { ...query, gate, rows: mergePages(query.data?.pages), validRange };
}
