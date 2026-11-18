import type { DeliveryStatus, DraftOrder, OrderStatusEvent } from '@/lib/data-access/models';
import type { Grants } from '@/lib/permissions';
import {
  BACKOFFICE_COLUMNS,
  DELIVERY_SEQUENCE,
  TERMINAL_ORDER_STATUSES,
  nextBackofficeAction,
  toBackofficeColumn,
  toBackofficeLogistics,
  type BackofficeColumn,
  type BackofficeLogisticsKey,
  type BackofficeNextAction,
} from '@/lib/order-status';
import { localTime, minutesBetween } from '@/lib/time';

/**
 * Lógica pura de presentación de pedidos del backoffice (decoración `deco` del prototipo). Nada lee el reloj:
 * el "ahora" llega por parámetro (`useNow`).
 */

export type OrderTypeFilter = 'todos' | 'delivery' | 'pickup';
export type OrderStatusFilter = 'todos' | BackofficeColumn;

/** Minutos desde que se creó el pedido (nunca negativo). */
export function minutesSince(order: Pick<DraftOrder, 'createdAt'>, now: Date | null): number {
  return now ? Math.max(0, minutesBetween(order.createdAt, now)) : 0;
}

/** Pedido nuevo sin aceptar hace más de 5 minutos (etiqueta roja del prototipo). */
export function isLate(order: Pick<DraftOrder, 'status' | 'createdAt'>, now: Date | null): boolean {
  return order.status === 'received' && minutesSince(order, now) > 5;
}

export type WaitParts =
  | { kind: 'now' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'hours'; hours: number; minutes: number };

export function waitParts(minutes: number): WaitParts {
  if (minutes < 1) return { kind: 'now' };
  if (minutes < 60) return { kind: 'minutes', minutes };
  return { kind: 'hours', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

export const orderCode = (order: Pick<DraftOrder, 'id'>) => `#${order.id}`;

export const itemCount = (order: Pick<DraftOrder, 'lines'>) =>
  order.lines.reduce((sum, line) => sum + line.quantity, 0);

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function orderTime(order: Pick<DraftOrder, 'createdAt'>): string {
  return localTime(new Date(order.createdAt));
}

export const isTerminal = (order: Pick<DraftOrder, 'status'>) =>
  TERMINAL_ORDER_STATUSES.includes(order.status);

/** Pedidos "en curso": nuevo → en camino (excluye entregados y cancelados). */
export const isActive = (order: Pick<DraftOrder, 'status'>) => !isTerminal(order);

export function matchesSearch(order: Pick<DraftOrder, 'id' | 'customer'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || order.id.toLowerCase().includes(q) || order.customer.name.toLowerCase().includes(q);
}

export interface OrderFilters {
  query: string;
  type: OrderTypeFilter;
  /** undefined = todas. */
  branchId: string | undefined;
}

export function filterOrders(orders: readonly DraftOrder[], filters: OrderFilters): DraftOrder[] {
  return orders.filter(
    (o) =>
      (filters.type === 'todos' || o.fulfillment === filters.type) &&
      (!filters.branchId || o.branchId === filters.branchId) &&
      matchesSearch(o, filters.query),
  );
}

/** Orden del tablero: las columnas activas muestran primero lo más antiguo; "Entregado", lo más reciente. */
export function sortForColumn(
  column: BackofficeColumn,
  orders: readonly DraftOrder[],
): DraftOrder[] {
  const sorted = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return column === 'entregado' ? sorted.reverse() : sorted;
}

export function groupByColumn(
  orders: readonly DraftOrder[],
): Record<BackofficeColumn, DraftOrder[]> {
  const groups: Record<BackofficeColumn, DraftOrder[]> = {
    nuevo: [],
    aceptado: [],
    preparacion: [],
    listo: [],
    en_camino: [],
    entregado: [],
    cancelado: [],
  };
  for (const order of orders) groups[toBackofficeColumn(order)].push(order);
  for (const column of Object.keys(groups) as BackofficeColumn[]) {
    groups[column] = sortForColumn(column, groups[column]);
  }
  return groups;
}

/** Orden de la tabla: lo más reciente primero. */
export function sortForTable(orders: readonly DraftOrder[]): DraftOrder[] {
  return [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function countByColumn(orders: readonly DraftOrder[]): Record<BackofficeColumn, number> {
  const g = groupByColumn(orders);
  return Object.fromEntries(
    (Object.keys(g) as BackofficeColumn[]).map((k) => [k, g[k].length]),
  ) as Record<BackofficeColumn, number>;
}

export type StepState = 'done' | 'cur' | '';

/** Barra de avance del detalle (el recoger en tienda omite "En camino"). */
export function progressSteps(
  order: Pick<DraftOrder, 'status' | 'fulfillment'>,
): { column: BackofficeColumn; state: StepState }[] {
  const sequence = BACKOFFICE_COLUMNS.filter(
    (c) => order.fulfillment === 'delivery' || c !== 'en_camino',
  );
  const current = (sequence as readonly BackofficeColumn[]).indexOf(toBackofficeColumn(order));
  return sequence.map((column, i) => ({
    column,
    state: i < current ? 'done' : i === current ? (column === 'entregado' ? 'done' : 'cur') : '',
  }));
}

const LOGISTICS_KEY: Record<DeliveryStatus, BackofficeLogisticsKey> = {
  searching: 'buscando',
  assigned: 'asignado',
  picking_up: 'a_recoger',
  picked_up: 'recogido',
  on_the_way: 'en_camino',
  delivered: 'entregado',
  failed: 'fallido',
};

export const logisticsKeyFor = (status: DeliveryStatus): BackofficeLogisticsKey =>
  LOGISTICS_KEY[status];

/** Línea de seguimiento logístico (PedidosYa: 6 pasos; repartidor propio: 3). */
export function trackSteps(
  delivery: NonNullable<DraftOrder['delivery']>,
): { key: BackofficeLogisticsKey; state: StepState }[] {
  const sequence = DELIVERY_SEQUENCE[delivery.provider];
  const current = sequence.indexOf(delivery.status);
  return sequence.map((status, i) => ({
    key: logisticsKeyFor(status),
    state:
      i < current || (i === current && status === 'delivered')
        ? 'done'
        : i === current
          ? 'cur'
          : '',
  }));
}

export { toBackofficeLogistics };

/** Eventos del historial, del más reciente al más antiguo (como el prototipo). */
export function historyNewestFirst(order: Pick<DraftOrder, 'history'>): OrderStatusEvent[] {
  return [...order.history].reverse();
}

export function nextAction(order: DraftOrder, grants: Grants): BackofficeNextAction | null {
  return nextBackofficeAction(order, grants);
}

/** Cocina no puede despachar: ve un aviso informativo cuando el pedido a domicilio está listo. */
export function dispatchBlockedForRole(order: DraftOrder, grants: Grants): boolean {
  return (
    order.status === 'ready' &&
    order.fulfillment === 'delivery' &&
    (!order.delivery || order.delivery.status === 'failed') &&
    nextBackofficeAction(order, grants) !== 'dispatch'
  );
}
