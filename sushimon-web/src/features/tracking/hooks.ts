'use client';

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Order } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { getOrder } from '@/services/orders';
import { useMyOrders } from '../account/hooks';
import { useLastOrder } from '../orders/last-order';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { useVerifiedOrderIds } from './verified-orders';

export interface OrdersByIds {
  orders: Order[];
  isPending: boolean;
  refetch: () => void;
}

/**
 * Carga pedidos sueltos por número. Cada uno pasa por `GET /v1/orders/:id`, así que el servidor decide
 * cuáles puede ver esta sesión: los que respondan 404 simplemente no aparecen.
 */
export function useOrdersByIds(ids: readonly string[], enabled = true): OrdersByIds {
  const client = useDataClient();
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.orders.detail(id),
      queryFn: () => getOrder(client, id),
      enabled,
      retry: false,
    })),
  });
  const orders = results.flatMap((r) => (r.data ? [r.data] : []));
  const isPending = enabled && results.some((r) => r.isPending);
  return { orders, isPending, refetch: () => results.forEach((r) => void r.refetch()) };
}

export interface IncidentOrders {
  orders: Order[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Pedidos entre los que el cliente puede elegir al reportar un problema: con sesión, los de su cuenta;
 * como invitado, los que consultó con número + teléfono en esta pestaña y el último que hizo en este
 * dispositivo. Más recientes primero (la pantalla muestra solo los más recientes). Es solo una
 * comodidad: el servidor vuelve a decidir qué puede ver cada sesión.
 */
export function useIncidentOrders(): IncidentOrders {
  const { customer } = useDemoSession();
  const mine = useMyOrders();
  const verified = useVerifiedOrderIds();
  const last = useLastOrder();
  const guestIds = useMemo(() => {
    const ids = new Set(verified);
    if (!customer && last.order) ids.add(last.order.id);
    return [...ids];
  }, [verified, last.order, customer]);
  const guest = useOrdersByIds(guestIds, !customer);

  const source = customer ? (mine.data ?? []) : guest.orders;
  const orders = [...source].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    orders,
    isPending: customer ? mine.isPending : guest.isPending,
    isError: customer ? mine.isError : false,
    refetch: customer ? () => void mine.refetch() : guest.refetch,
  };
}
