'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Order } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  advanceOrderDemo,
  createIncident,
  createOrder,
  getOrder,
  lookupOrder,
  payWithCard,
} from '@/services/orders';
import { customerOrdersPredicate, queryKeys } from '../query-keys';

/** Invalida todo lo derivado de pedidos (detalle, cliente, backoffice, reportes, panel). */
export function invalidateOrders(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: queryKeys.orders.all });
  void qc.invalidateQueries({ predicate: customerOrdersPredicate });
  void qc.invalidateQueries({ queryKey: ['backoffice', 'dashboard'] });
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

const seedDetail = (order: Order, qc: QueryClient) =>
  qc.setQueryData(queryKeys.orders.detail(order.id), order);

/** Seguimiento de un pedido. `refetchInterval` opcional para refrescar el estado. */
export function useOrder(
  id: string | null | undefined,
  options: { refetchInterval?: number } = {},
) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.orders.detail(id ?? ''),
    queryFn: () => getOrder(client, id as string),
    enabled: !!id,
    refetchInterval: options.refetchInterval,
  });
}

/** Crea el pedido (body CreateOrderRequest; el servidor calcula totales). */
export function useCreateOrder() {
  const client = useDataClient();
  return useOrderMutation(
    (input: Parameters<typeof createOrder>[1]) => createOrder(client, input),
    seedDetail,
  );
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
