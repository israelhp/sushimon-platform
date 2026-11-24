import type {
  AdminDeliveryAction,
  AdminDeliveryActionState,
  AdminDeliveryStatus,
  StaffPermission,
} from '@/lib/data-access/models';
import type { MockStore } from './store';
import type { AdminDeliveryRecord } from './fixtures/admin-deliveries';
import { ADMIN_DELIVERY_SEEDS } from './fixtures/admin-deliveries';

/**
 * F28 (spec 029 §3.2, §4.2, §6) — REGLAS simuladas de entregas propias: la MISMA tabla de comandos y `availableActions` que la API
 * real (`delivery-policy.ts`). La web NUNCA las consulta (usa `availableActions` del servidor): solo el mock y sus pruebas. Sin I/O.
 */

export const OPEN_STATUSES: readonly AdminDeliveryStatus[] = [
  'pending',
  'assigned',
  'picked_up',
  'delivered',
];
/** Con una de estas la API muestra contacto y dirección del cliente (§8); en `delivered|returned|cancelled` son `null`. */
export const CONTACT_STATUSES: readonly AdminDeliveryStatus[] = [
  'pending',
  'assigned',
  'picked_up',
];
/** El motorista cuenta como OCUPADO hasta registrar el retorno. */
export const OCCUPYING_STATUSES: readonly AdminDeliveryStatus[] = [
  'assigned',
  'picked_up',
  'delivered',
];
/** Con una de estas, el pedido NO se puede cancelar ni rechazar (`ORDER_HAS_ACTIVE_DELIVERY`). */
export const ORDER_BLOCKING_STATUSES: readonly AdminDeliveryStatus[] = [
  'pending',
  'assigned',
  'picked_up',
];
export const DISPATCHABLE_ORDER_STATUSES = ['accepted', 'preparing', 'ready'] as const;

export type DeliveryCommand =
  'assign' | 'unassign' | 'mark_picked_up' | 'mark_delivered' | 'return_to_branch' | 'cancel';

export interface DeliveryCommandSpec {
  route: string;
  /** Permisos que el personal debe tener EN LA SUCURSAL de la entrega (todos). La base es el primero. */
  permissions: readonly StaffPermission[];
  from: readonly AdminDeliveryStatus[];
  to: AdminDeliveryStatus;
  reason: 'none' | 'optional' | 'required';
  order?: { expected: 'ready' | 'on_the_way'; to: 'on_the_way' | 'delivered' };
}

export const COMMAND_SPECS: Record<DeliveryCommand, DeliveryCommandSpec> = {
  assign: {
    route: 'assign-own-rider',
    permissions: ['deliveries.assign', 'riders.assign'],
    from: ['pending', 'assigned'],
    to: 'assigned',
    reason: 'none',
  },
  unassign: {
    route: 'unassign-rider',
    permissions: ['deliveries.assign'],
    from: ['assigned'],
    to: 'pending',
    reason: 'optional',
  },
  mark_picked_up: {
    route: 'mark-picked-up',
    permissions: ['deliveries.update'],
    from: ['assigned'],
    to: 'picked_up',
    reason: 'none',
    order: { expected: 'ready', to: 'on_the_way' },
  },
  mark_delivered: {
    route: 'mark-delivered',
    permissions: ['deliveries.update'],
    from: ['picked_up'],
    to: 'delivered',
    reason: 'none',
    order: { expected: 'on_the_way', to: 'delivered' },
  },
  return_to_branch: {
    route: 'return-to-branch',
    permissions: ['deliveries.update'],
    from: ['delivered'],
    to: 'returned',
    reason: 'none',
  },
  cancel: {
    route: 'cancel',
    permissions: ['deliveries.update'],
    from: ['pending', 'assigned'],
    to: 'cancelled',
    reason: 'required',
  },
};

const ACTION_COMMAND: Record<AdminDeliveryAction, DeliveryCommand> = {
  assign_rider: 'assign',
  reassign_rider: 'assign',
  unassign_rider: 'unassign',
  mark_picked_up: 'mark_picked_up',
  mark_delivered: 'mark_delivered',
  return_to_branch: 'return_to_branch',
  cancel: 'cancel',
};

function actionsExisting(status: AdminDeliveryStatus): AdminDeliveryAction[] {
  switch (status) {
    case 'pending':
      return ['assign_rider', 'cancel'];
    case 'assigned':
      return ['reassign_rider', 'unassign_rider', 'mark_picked_up', 'cancel'];
    case 'picked_up':
      return ['mark_delivered'];
    case 'delivered':
      return ['return_to_branch'];
    default:
      return [];
  }
}

/** `availableActions` como las calcularía el servidor. `NO_PERMISSION` tiene prioridad sobre `ORDER_NOT_READY`. */
export function availableDeliveryActionsFor(
  delivery: Pick<AdminDeliveryRecord, 'status'>,
  orderStatus: string,
  can: (permission: StaffPermission) => boolean,
): AdminDeliveryActionState[] {
  return actionsExisting(delivery.status).map((action): AdminDeliveryActionState => {
    if (!COMMAND_SPECS[ACTION_COMMAND[action]].permissions.every((p) => can(p))) {
      return { action, enabled: false, disabledReason: 'NO_PERMISSION' };
    }
    if (action === 'mark_picked_up' && orderStatus !== 'ready') {
      return { action, enabled: false, disabledReason: 'ORDER_NOT_READY' };
    }
    return { action, enabled: true, disabledReason: null };
  });
}

export type OrderEligibilityCode =
  'ORDER_STATUS_NOT_DISPATCHABLE' | 'ORDER_NOT_DELIVERY' | 'ORDER_PROVIDER_NOT_OWN';

/** Razones por las que un pedido NO admite entrega propia (vacío = elegible). */
export function orderEligibilityViolations(order: {
  status: string;
  fulfillmentType: string;
  deliveryProvider: string | null;
}): OrderEligibilityCode[] {
  const out: OrderEligibilityCode[] = [];
  if (!(DISPATCHABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    out.push('ORDER_STATUS_NOT_DISPATCHABLE');
  }
  if (order.fulfillmentType !== 'DELIVERY') out.push('ORDER_NOT_DELIVERY');
  else if (order.deliveryProvider !== 'OWN') out.push('ORDER_PROVIDER_NOT_OWN');
  return out;
}

/** Estado público grueso del seguimiento del cliente (`delivery.status`): nunca datos del motorista. */
export function publicDeliveryStatus(
  status: string | null | undefined,
): 'PENDING' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | null {
  switch (status) {
    case 'pending':
      return 'PENDING';
    case 'assigned':
      return 'ASSIGNED';
    case 'picked_up':
      return 'PICKED_UP';
    case 'delivered':
    case 'returned':
      return 'DELIVERED';
    default:
      return null;
  }
}

/** Entregas del store (los stores persistidos antes de F28 no traen la colección: se siembra al primer uso, determinista). */
export function deliveriesOf(
  store: MockStore,
  scenario: string = 'default',
): AdminDeliveryRecord[] {
  store.adminDeliveries ??= scenario === 'empty' ? [] : structuredClone([...ADMIN_DELIVERY_SEEDS]);
  return store.adminDeliveries;
}

export const deliveryOfOrder = (
  store: MockStore,
  orderId: string,
): AdminDeliveryRecord | undefined => store.adminDeliveries?.find((d) => d.orderId === orderId);

/** ¿Tiene el pedido una entrega que impide cancelarlo/rechazarlo? */
export const hasBlockingDelivery = (store: MockStore, orderId: string): boolean => {
  const found = deliveryOfOrder(store, orderId);
  return found !== undefined && ORDER_BLOCKING_STATUSES.includes(found.status);
};

/** Motoristas con una entrega que los ocupa (derivado, como `findBusy` real). */
export const busyRiderIds = (store: MockStore): Set<string> =>
  new Set(
    (store.adminDeliveries ?? [])
      .filter((d) => d.riderId !== null && OCCUPYING_STATUSES.includes(d.status))
      .map((d) => d.riderId as string),
  );
