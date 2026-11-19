'use client';

import { useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/data-access/errors';
import type { DraftOrder, OrderCreated, OrderDetail } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  advanceOrderDemo,
  createIncident,
  createOrder,
  getDraftOrder,
  getOrder,
  getOrderTracking,
  prepareDraftCardOrder,
  lookupOrder,
  payWithCard,
} from '@/services/orders';
import { useCustomerScope } from '../session/customer-scope';
import { customerOrdersPredicate, queryKeys } from '../query-keys';
import { useTrackingPolling, type TrackingPollState } from '../tracking/use-tracking-poll';

const noopSubscribe = () => () => {};

/** Invalida todo lo derivado de pedidos (detalle, cliente, backoffice, reportes, panel). */
export function invalidateOrders(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: queryKeys.orders.all });
  void qc.invalidateQueries({ predicate: customerOrdersPredicate });
  void qc.invalidateQueries({ queryKey: ['backoffice', 'dashboard'] });
  // F22: tablero, listado y detalle REALES del backoffice (los cambios del mock legado y del pedido demo también los afectan).
  void qc.invalidateQueries({ queryKey: queryKeys.backoffice.adminOrders.all });
}

function useOrderMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  onOrder?: (result: TResult, qc: QueryClient) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      onOrder?.(result, qc);
      invalidateOrders(qc);
    },
  });
}

const seedDetail = (order: DraftOrder, qc: QueryClient) =>
  qc.setQueryData(queryKeys.orders.detail(order.id), order);

/** Seguimiento de un pedido. `refetchInterval` opcional para refrescar el estado. */
export function useOrder(
  id: string | null | undefined,
  options: { refetchInterval?: number } = {},
) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.orders.detail(id ?? ''),
    queryFn: () => getDraftOrder(client, id as string),
    enabled: !!id,
    refetchInterval: options.refetchInterval,
  });
}

/**
 * F20: crea el pedido real (`POST /v1/orders`). NO usa `useMutation`: la caché de TanStack conservaría el cuerpo (contacto,
 * dirección) y la respuesta (credencial de invitado) hasta el `gcTime`. El cuerpo y la clave viven solo en la llamada; con éxito
 * se invalida lo derivado de pedidos. Reintentar es decisión de `usePlaceOrder` (misma clave).
 */
export function useCreateOrder() {
  const client = useDataClient();
  const qc = useQueryClient();
  return {
    create: async (
      input: Parameters<typeof createOrder>[1],
      idempotencyKey: string,
      signal?: AbortSignal,
    ): Promise<OrderCreated> => {
      const created = await createOrder(client, input, idempotencyKey, signal);
      invalidateOrders(qc);
      return created;
    },
  };
}

/** 🎭 Solo mock: pedido BORRADOR enlazado al recién creado (id = `displayNumber`) para la confirmación/pasarela simulada. */
export function useDraftOrderLoader() {
  const client = useDataClient();
  return {
    load: (id: string, forCard: boolean): Promise<DraftOrder> =>
      forCard ? prepareDraftCardOrder(client, id) : getDraftOrder(client, id),
  };
}

/**
 * F20: pedido REAL por UUID (`GET /v1/orders/{id}`), con la sesión del dueño o la credencial de invitado (`X-Order-Token`).
 * Sin reintentos: un 404/401 es definitivo (otra pestaña, token vencido). La credencial no entra en la clave de caché.
 */
export function useOrderDetail(
  id: string | null | undefined,
  guestToken: string | null,
  options: { once?: boolean; enabled?: boolean } = {},
) {
  const client = useDataClient();
  const identity = useCustomerScope();
  const scope = identity.state === 'ready' ? identity.scope : null;
  return useQuery<OrderDetail, ApiError>({
    queryKey: queryKeys.orders.placed(scope, id ?? ''),
    queryFn: ({ signal }) => getOrder(client, id as string, { guestToken, signal }),
    enabled: !!id && identity.state !== 'pending' && options.enabled !== false,
    retry: false,
    gcTime: 60_000,
    // F21 `once`: el resumen del seguimiento se consulta UNA vez (el polling usa solo `getOrderTracking`).
    ...(options.once
      ? { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false }
      : {}),
  });
}

export interface OrderTrackingResult extends TrackingPollState {
  /** La identidad del cliente aún se está resolviendo: no se ha decidido si hay acceso. */
  pending: boolean;
  /** Invitado sin credencial ni sesión (otra pestaña/dispositivo, token vencido): NO se hizo ninguna solicitud. */
  noCredentials: boolean;
}

/**
 * F21: seguimiento REAL por UUID (`GET /v1/orders/{id}/tracking`) con polling controlado (`useTrackingPolling`). Misma autorización
 * que `useOrderDetail`: sesión del dueño o credencial de invitado en `X-Order-Token`. Sin sesión NI credencial no se emite la
 * solicitud (acceso perdido). NO usa `useOrder` (borrador simulado). La credencial no entra en la clave ni se persiste nada.
 */
export function useOrderTracking(
  id: string | null | undefined,
  guestToken: string | null,
): OrderTrackingResult {
  const client = useDataClient();
  const identity = useCustomerScope();
  const scope = identity.state === 'ready' ? identity.scope : null;
  // Hasta hidratar no se decide el acceso (la credencial vive en `sessionStorage`): evita un desajuste servidor/cliente.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const resolved = identity.state !== 'pending' && mounted;
  const hasCredentials = !!guestToken || identity.state === 'ready';
  const poll = useTrackingPolling({
    queryKey: queryKeys.orders.tracking(scope, id ?? ''),
    enabled: !!id && resolved && hasCredentials,
    fetcher: (signal) => getOrderTracking(client, id as string, { guestToken, signal }),
  });
  return { ...poll, pending: !resolved, noCredentials: !!id && resolved && !hasCredentials };
}

/** Consulta de invitado (número + teléfono). Un 404 no revela si el pedido existe. */
export function useLookupOrder() {
  const client = useDataClient();
  return useOrderMutation(
    (input: Parameters<typeof lookupOrder>[1]) => lookupOrder(client, input),
    seedDetail,
  );
}

/**
 * Pago con tarjeta en la pasarela NeoNet SIMULADA.
 * SEGURIDAD: NO usa `useMutation`: TanStack Query conserva las `variables` de cada mutación en su caché
 * (PAN/CVV incluidos) hasta el `gcTime`. Aquí el cuerpo solo vive en la llamada: se envía, se descarta
 * y solo se invalida lo derivado de pedidos con el resultado (sin datos de tarjeta).
 */
export function usePayWithCard() {
  const client = useDataClient();
  const qc = useQueryClient();
  return {
    pay: async (input: Parameters<typeof payWithCard>[1]) => {
      const result = await payWithCard(client, input);
      invalidateOrders(qc);
      return result;
    },
  };
}

/** Reporte de incidencia de un pedido. */
export function useCreateIncident() {
  const client = useDataClient();
  return useOrderMutation((input: Parameters<typeof createIncident>[1]) =>
    createIncident(client, input),
  );
}

/** 🎭 "Ver siguiente estado (simulación)". Solo ofrecer si `useIsSimulation()`. */
export function useAdvanceOrderDemo() {
  const client = useDataClient();
  return useOrderMutation((id: string) => advanceOrderDemo(client, id), seedDetail);
}

/** true si los datos vienen del adaptador mock (mostrar insignias y acciones de simulación). */
export function useIsSimulation(): boolean {
  return useDataClient().kind === 'mock';
}
