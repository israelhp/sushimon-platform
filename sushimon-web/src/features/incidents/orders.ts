import type { Order } from '@/lib/data-access/models';

/** Pedidos que ofrece el Reclamo (igual que el prototipo). */
export const MAX_INCIDENT_ORDERS = 5;

/** Pone primero el pedido indicado (`?pedido=`) y limita a {@link MAX_INCIDENT_ORDERS}. */
export function arrangeIncidentOrders(
  orders: readonly Order[],
  highlightId: string | null,
): Order[] {
  const list = highlightId
    ? [...orders.filter((o) => o.id === highlightId), ...orders.filter((o) => o.id !== highlightId)]
    : [...orders];
  return list.slice(0, MAX_INCIDENT_ORDERS);
}

/** Incidencias abiertas (sin resolver) del pedido: avisa antes de abrir otra. */
export function openIncidents(order: Pick<Order, 'incidents'>) {
  return order.incidents.filter((i) => i.status !== 'resolved');
}
