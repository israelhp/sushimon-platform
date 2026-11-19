/**
 * Matriz de transiciones de pedidos (F22, spec 023 §3). Funciones PURAS (sin I/O): la API es la fuente de verdad; la web
 * nunca decide transiciones ni permisos, solo muestra `availableActions`. Reutilizable por F28 (ver `OrderTransitionsService`).
 */

/** Catálogo CERRADO de estados (CHECK de la migración 0018). */
export const ORDER_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTIVE_STATUSES: readonly OrderStatus[] = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
];
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];

export const isOrderStatus = (value: unknown): value is OrderStatus =>
  typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
export const isTerminal = (status: string): boolean =>
  (TERMINAL_STATUSES as readonly string[]).includes(status);

export type OrderCommand =
  'accept' | 'reject' | 'start_preparing' | 'mark_ready' | 'complete' | 'cancel';

export interface CommandSpec {
  command: OrderCommand;
  /** Segmento de ruta `POST /v1/admin/orders/{id}/<route>`. */
  route: string;
  permission: string;
  to: OrderStatus;
  reasonRequired: boolean;
  auditAction: string;
}

/** Tabla de comandos (spec §3.1). `orders.status`/`orders.dispatch` (legados) NO se aceptan. */
export const COMMAND_SPECS: Readonly<Record<OrderCommand, CommandSpec>> = {
  accept: {
    command: 'accept',
    route: 'accept',
    permission: 'orders.accept',
    to: 'accepted',
    reasonRequired: false,
    auditAction: 'order.accepted',
  },
  reject: {
    command: 'reject',
    route: 'reject',
    permission: 'orders.reject',
    to: 'rejected',
    reasonRequired: true,
    auditAction: 'order.rejected',
  },
  start_preparing: {
    command: 'start_preparing',
    route: 'start-preparing',
    permission: 'orders.prepare',
    to: 'preparing',
    reasonRequired: false,
    auditAction: 'order.preparation_started',
  },
  mark_ready: {
    command: 'mark_ready',
    route: 'mark-ready',
    permission: 'orders.prepare',
    to: 'ready',
    reasonRequired: false,
    auditAction: 'order.marked_ready',
  },
  complete: {
    command: 'complete',
    route: 'complete',
    permission: 'orders.complete',
    to: 'picked_up',
    reasonRequired: false,
    auditAction: 'order.completed',
  },
  cancel: {
    command: 'cancel',
    route: 'cancel',
    permission: 'orders.cancel',
    to: 'cancelled',
    reasonRequired: true,
    auditAction: 'order.cancelled',
  },
};

export type ViolationCode =
  | 'ORDER_TERMINAL'
  | 'ORDER_FULFILLMENT_MISMATCH'
  | 'ORDER_SOURCE_INVALID'
  | 'ORDER_DISPATCH_NOT_AVAILABLE'
  | 'ORDER_PROVIDER_BLOCKED_EXTERNAL'
  | 'ORDER_CANCEL_NOT_ALLOWED';

export type TransitionVerdict = { ok: true } | { ok: false; code: ViolationCode };

/** Hechos del pedido que decide la matriz (todo viene de la fila de `orders`, nunca del cliente). */
export interface TransitionFacts {
  fulfillmentType: string;
  deliveryProvider: string | null;
}

export interface EvaluateOptions {
  /**
   * Solo F28: permite `ready → on_the_way` y `on_the_way → delivered` en entrega propia (`OWN`). En F22 es siempre
   * `false` (ningún comando despacha). `PEDIDOSYA` nunca se permite (`BLOCKED_EXTERNAL`).
   */
  allowOwnDispatch?: boolean;
}

const OK: TransitionVerdict = { ok: true };
const fail = (code: ViolationCode): TransitionVerdict => ({ ok: false, code });

/** Pares del grafo (spec §3.2, sin matices de modalidad). */
const EDGES: Readonly<Record<string, readonly OrderStatus[]>> = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['cancelled', 'picked_up', 'on_the_way'],
  on_the_way: ['delivered'],
};

/**
 * Evalúa un par `from → to` para un pedido (spec §3.2, tabla EXACTA). Orden: terminal → `on_the_way → cancelled` →
 * par fuera del grafo → matices de modalidad/proveedor.
 */
export function evaluateTransition(
  from: string,
  to: string,
  facts: TransitionFacts,
  options: EvaluateOptions = {},
): TransitionVerdict {
  if (isTerminal(from)) return fail('ORDER_TERMINAL');
  const isDelivery = facts.fulfillmentType === 'DELIVERY';
  if (from === 'on_the_way' && to === 'cancelled') {
    return fail(isDelivery ? 'ORDER_CANCEL_NOT_ALLOWED' : 'ORDER_SOURCE_INVALID');
  }
  if (!(EDGES[from] ?? []).includes(to as OrderStatus)) return fail('ORDER_SOURCE_INVALID');

  if (from === 'ready' && to === 'picked_up' && isDelivery) {
    return fail('ORDER_FULFILLMENT_MISMATCH');
  }
  if (from === 'ready' && to === 'on_the_way') {
    if (!isDelivery) return fail('ORDER_FULFILLMENT_MISMATCH');
    return dispatchVerdict(facts, options);
  }
  if (from === 'on_the_way' && to === 'delivered') {
    if (!isDelivery) return fail('ORDER_SOURCE_INVALID');
    return dispatchVerdict(facts, options);
  }
  return OK;
}

function dispatchVerdict(facts: TransitionFacts, options: EvaluateOptions): TransitionVerdict {
  if (facts.deliveryProvider === 'PEDIDOSYA') return fail('ORDER_PROVIDER_BLOCKED_EXTERNAL');
  return options.allowOwnDispatch === true ? OK : fail('ORDER_DISPATCH_NOT_AVAILABLE');
}

// ---------- acciones disponibles (servidor => web) ----------

export type AdminOrderActionName = OrderCommand | 'dispatch';
export type ActionDisabledReason =
  'NO_PERMISSION' | 'DISPATCH_NOT_AVAILABLE' | 'PROVIDER_BLOCKED_EXTERNAL';

export interface ActionState {
  action: AdminOrderActionName;
  enabled: boolean;
  disabledReason: ActionDisabledReason | null;
}

/** Acciones que EXISTEN para un estado y modalidad (spec §4.2). */
function actionsExisting(status: string, fulfillmentType: string): AdminOrderActionName[] {
  switch (status) {
    case 'pending':
      return ['accept', 'reject', 'cancel'];
    case 'accepted':
      return ['start_preparing', 'cancel'];
    case 'preparing':
      return ['mark_ready', 'cancel'];
    case 'ready':
      return fulfillmentType === 'DELIVERY' ? ['cancel', 'dispatch'] : ['complete', 'cancel'];
    default:
      return [];
  }
}

/**
 * Lista de acciones para ESTE personal y ESTE pedido. `canDo(permiso)` debe resolver el permiso EN LA SUCURSAL DEL PEDIDO.
 * `dispatch` jamás está habilitada en F22.
 */
export function availableActionsFor(
  order: { status: string; fulfillmentType: string; deliveryProvider: string | null },
  canDo: (permission: string) => boolean,
): ActionState[] {
  return actionsExisting(order.status, order.fulfillmentType).map((action): ActionState => {
    if (action === 'dispatch') {
      return {
        action,
        enabled: false,
        disabledReason:
          order.deliveryProvider === 'PEDIDOSYA'
            ? 'PROVIDER_BLOCKED_EXTERNAL'
            : 'DISPATCH_NOT_AVAILABLE',
      };
    }
    const allowed = canDo(COMMAND_SPECS[action].permission);
    return { action, enabled: allowed, disabledReason: allowed ? null : 'NO_PERMISSION' };
  });
}
