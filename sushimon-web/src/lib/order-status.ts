import type {
  DeliveryProvider,
  DeliveryStatus,
  DraftOrder,
  DraftOrderStatus,
} from '@/lib/data-access/models';
import { can, type Grants } from '@/lib/permissions';

/**
 * Máquina ÚNICA de estados de pedido + mapeos a los estados/etiquetas de cada prototipo.
 * La usan el adaptador mock (para rechazar transiciones inválidas con 409) y la UI (para decidir
 * qué acción mostrar). En http, la validación definitiva es del servidor.
 */

export const ORDER_TRANSITIONS: Record<DraftOrderStatus, readonly DraftOrderStatus[]> = {
  received: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['on_the_way', 'delivered', 'cancelled'],
  on_the_way: ['delivered'],
  delivered: [],
  rejected: [],
  cancelled: [],
};

export const TERMINAL_ORDER_STATUSES: readonly DraftOrderStatus[] = [
  'delivered',
  'rejected',
  'cancelled',
];

/** Quién origina la transición: personal (PATCH status) o logística (despacho/avance). */
export type TransitionSource = 'staff' | 'logistics';

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

type OrderLike = Pick<DraftOrder, 'status' | 'fulfillment' | 'payment' | 'delivery'>;
type BranchOf = Partial<Pick<DraftOrder, 'branchId'>>;

export function isPaymentSettledForAcceptance(order: Pick<DraftOrder, 'payment'>): boolean {
  return order.payment.method === 'cash' || order.payment.status === 'approved';
}

export function checkTransition(
  order: OrderLike,
  to: DraftOrderStatus,
  source: TransitionSource = 'staff',
  reason?: string,
): TransitionCheck {
  const from = order.status;
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `Transición inválida: ${from} → ${to}` };
  }
  if ((to === 'rejected' || to === 'cancelled') && !reason?.trim()) {
    return { ok: false, reason: 'Indica el motivo' };
  }
  if (to === 'accepted' && !isPaymentSettledForAcceptance(order)) {
    return { ok: false, reason: 'El pago con tarjeta aún no está aprobado' };
  }
  if (to === 'on_the_way') {
    if (order.fulfillment !== 'delivery') return { ok: false, reason: 'Solo pedidos a domicilio' };
    if (source !== 'logistics') return { ok: false, reason: 'Se marca en camino al despachar' };
  }
  if (to === 'delivered' && order.fulfillment === 'delivery' && source !== 'logistics') {
    return { ok: false, reason: 'La entrega a domicilio la confirma la logística' };
  }
  if (to === 'cancelled' && order.delivery && order.delivery.status !== 'failed') {
    return { ok: false, reason: 'El pedido ya tiene logística en curso' };
  }
  return { ok: true };
}

export function canTransition(
  order: OrderLike,
  to: DraftOrderStatus,
  source: TransitionSource = 'staff',
): boolean {
  return checkTransition(order, to, source, 'x').ok;
}

// ── Logística ──────────────────────────────────────────────────────────────────────────────

export const DELIVERY_SEQUENCE: Record<DeliveryProvider, readonly DeliveryStatus[]> = {
  pedidosya: ['searching', 'assigned', 'picking_up', 'picked_up', 'on_the_way', 'delivered'],
  own: ['assigned', 'on_the_way', 'delivered'],
};

export function nextDeliveryStatus(
  provider: DeliveryProvider,
  current: DeliveryStatus,
): DeliveryStatus | null {
  const seq = DELIVERY_SEQUENCE[provider];
  const i = seq.indexOf(current);
  return i < 0 || i >= seq.length - 1 ? null : (seq[i + 1] ?? null);
}

/** Estado de pedido que implica cada estado logístico (null = no cambia). */
export function orderStatusForDelivery(
  provider: DeliveryProvider,
  status: DeliveryStatus,
): DraftOrderStatus | null {
  if (status === 'delivered') return 'delivered';
  if (provider === 'pedidosya' && status === 'picked_up') return 'on_the_way';
  if (provider === 'own' && status === 'on_the_way') return 'on_the_way';
  return null;
}

/** Regla de despacho del prototipo: listo + domicilio + sin logística activa + rol ≠ cocina. */
export function canDispatch(order: OrderLike & BranchOf, grants?: Grants | null): boolean {
  const roleOk = grants === undefined ? true : can(grants, 'deliveries.assign', order.branchId);
  return (
    roleOk &&
    order.status === 'ready' &&
    order.fulfillment === 'delivery' &&
    (!order.delivery || order.delivery.status === 'failed')
  );
}

// ── Mapeo a la tienda pública ──────────────────────────────────────────────────────────────

/** Claves de estado de la tienda (mensajes `status.*` del prototipo) + estados finales. */
export type StoreOrderStateKey =
  | 'awaiting_payment'
  | 'payment_review'
  | 'paid_pending_acceptance'
  | 'pending_acceptance'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export function toStoreOrderState(
  order: Pick<DraftOrder, 'status' | 'payment'>,
): StoreOrderStateKey {
  const { status, payment } = order;
  if (status === 'rejected' || status === 'cancelled') return status;
  if (status === 'delivered') return 'completed';
  if (payment.method === 'card' && (payment.status === 'pending' || payment.status === 'declined'))
    return 'awaiting_payment';
  if (payment.method === 'card' && payment.status === 'review') return 'payment_review';
  if (status === 'received') {
    return payment.method === 'card' ? 'paid_pending_acceptance' : 'pending_acceptance';
  }
  return 'in_progress';
}

export interface StoreTrackingStep {
  /** 'delivery' usa los 6 pasos `status.steps`; 'pickup' los 5 de `status.stepsPickup`. */
  variant: 'delivery' | 'pickup';
  total: number;
  /**
   * Igual que el `progress` del prototipo: los pasos con índice < progress están completos y el
   * paso `progress` es el actual. progress === total → todo completo.
   */
  progress: number;
  /** true si el paso 2 debe decir "Pago al recibir" (efectivo o tarjeta no aprobada). */
  payOnDelivery: boolean;
  /** Pedido detenido (rechazado/cancelado): la UI muestra el aviso en lugar del avance. */
  halted: boolean;
}

export function toStoreTrackingStep(
  order: Pick<DraftOrder, 'status' | 'fulfillment' | 'payment'>,
): StoreTrackingStep {
  const variant = order.fulfillment === 'delivery' ? 'delivery' : 'pickup';
  const total = variant === 'delivery' ? 6 : 5;
  const paid = order.payment.method === 'card' && order.payment.status === 'approved';
  const byStatus: Record<DraftOrderStatus, number> = {
    received: paid ? 2 : 1,
    accepted: 2,
    preparing: 2,
    ready: 3,
    on_the_way: 4,
    delivered: total,
    rejected: 0,
    cancelled: 0,
  };
  return {
    variant,
    total,
    progress: byStatus[order.status],
    payOnDelivery: !paid,
    halted: order.status === 'rejected' || order.status === 'cancelled',
  };
}

/** "En curso" para la tienda (punto pulsante vs. palomita verde). */
export function isOrderInProgress(order: Pick<DraftOrder, 'status'>): boolean {
  return !TERMINAL_ORDER_STATUSES.includes(order.status);
}

// ── Mapeo al backoffice ────────────────────────────────────────────────────────────────────

/** Columnas/estados del prototipo del backoffice (ST + cancelado). */
export type BackofficeColumn =
  'nuevo' | 'aceptado' | 'preparacion' | 'listo' | 'en_camino' | 'entregado' | 'cancelado';

export const BACKOFFICE_COLUMNS: readonly Exclude<BackofficeColumn, 'cancelado'>[] = [
  'nuevo',
  'aceptado',
  'preparacion',
  'listo',
  'en_camino',
  'entregado',
];

export function toBackofficeColumn(order: Pick<DraftOrder, 'status'>): BackofficeColumn {
  const map: Record<DraftOrderStatus, BackofficeColumn> = {
    received: 'nuevo',
    accepted: 'aceptado',
    preparing: 'preparacion',
    ready: 'listo',
    on_the_way: 'en_camino',
    delivered: 'entregado',
    rejected: 'cancelado',
    cancelled: 'cancelado',
  };
  return map[order.status];
}

/** Columna del backoffice → estados del contrato (para filtros). */
export function fromBackofficeColumn(column: BackofficeColumn): DraftOrderStatus[] {
  const map: Record<BackofficeColumn, DraftOrderStatus[]> = {
    nuevo: ['received'],
    aceptado: ['accepted'],
    preparacion: ['preparing'],
    listo: ['ready'],
    en_camino: ['on_the_way'],
    entregado: ['delivered'],
    cancelado: ['rejected', 'cancelled'],
  };
  return map[column];
}

export const BACKOFFICE_STATUS_LABEL: Record<BackofficeColumn, string> = {
  nuevo: 'Nuevo',
  aceptado: 'Aceptado',
  preparacion: 'En preparación',
  listo: 'Listo para despacho',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/** Estado logístico como lo muestra el backoffice (LOG_ST / OWN_ST + "sin repartidor"). */
export type BackofficeLogisticsKey =
  | 'none'
  | 'buscando'
  | 'asignado'
  | 'a_recoger'
  | 'recogido'
  | 'en_camino'
  | 'entregado'
  | 'fallido';

export function toBackofficeLogistics(
  order: Pick<DraftOrder, 'delivery' | 'status'>,
): BackofficeLogisticsKey {
  if (!order.delivery) return order.status === 'delivered' ? 'entregado' : 'none';
  const map: Record<DeliveryStatus, BackofficeLogisticsKey> = {
    searching: 'buscando',
    assigned: 'asignado',
    picking_up: 'a_recoger',
    picked_up: 'recogido',
    on_the_way: 'en_camino',
    delivered: 'entregado',
    failed: 'fallido',
  };
  return map[order.delivery.status];
}

export const BACKOFFICE_LOGISTICS_LABEL: Record<BackofficeLogisticsKey, string> = {
  none: 'Sin repartidor',
  buscando: 'Buscando repartidor',
  asignado: 'Repartidor asignado',
  a_recoger: 'En camino a recoger',
  recogido: 'Pedido recogido',
  en_camino: 'En camino al cliente',
  entregado: 'Entregado',
  fallido: 'Sin repartidor disponible',
};

export type BackofficeNextAction = 'accept' | 'prepare' | 'ready' | 'dispatch' | 'deliver';

/** Siguiente acción principal del prototipo (botón de la tarjeta/fila). */
export function nextBackofficeAction(
  order: OrderLike & BranchOf,
  grants: Grants,
): BackofficeNextAction | null {
  const allowed = (permission: Parameters<typeof can>[1]) =>
    can(grants, permission, order.branchId);
  if (order.status === 'received' && allowed('orders.accept')) return 'accept';
  if (order.status === 'accepted' && allowed('orders.prepare')) return 'prepare';
  if (order.status === 'preparing' && allowed('orders.complete')) return 'ready';
  if (order.status === 'ready' && order.fulfillment === 'delivery') {
    return canDispatch(order, grants) ? 'dispatch' : null;
  }
  if (order.status === 'ready' && allowed('orders.complete')) return 'deliver';
  return null;
}

/** Acción → estado destino (para `PATCH /status`); 'dispatch' usa su propia ruta. */
export const NEXT_ACTION_STATUS: Record<
  Exclude<BackofficeNextAction, 'dispatch'>,
  DraftOrderStatus
> = {
  accept: 'accepted',
  prepare: 'preparing',
  ready: 'ready',
  deliver: 'delivered',
};
