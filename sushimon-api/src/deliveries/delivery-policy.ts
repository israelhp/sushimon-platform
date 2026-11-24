/**
 * Política PURA de entregas propias (F28, spec 029 §3.2 y §4.2; ADR-0032). Sin I/O: la API es la fuente de verdad y la web solo
 * muestra `availableActions`. La tabla de comandos es la MISMA que valida el trigger `deliveries_guard` (migración 0022); una
 * prueba barre todos los pares de estados contra ambos.
 */

export const DELIVERY_STATUSES = [
  'pending',
  'assigned',
  'picked_up',
  'delivered',
  'returned',
  'cancelled',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Entregas ABIERTAS (listado por defecto; filtran sin ventana de fechas). */
export const OPEN_STATUSES: readonly DeliveryStatus[] = [
  'pending',
  'assigned',
  'picked_up',
  'delivered',
];
/** Estados en los que el motorista cuenta como OCUPADO (hasta registrar el retorno). */
export const OCCUPYING_STATUSES: readonly DeliveryStatus[] = ['assigned', 'picked_up', 'delivered'];
/** Estados que impiden cancelar o rechazar el PEDIDO (trigger `orders_open_delivery_guard`). */
export const ORDER_BLOCKING_STATUSES: readonly DeliveryStatus[] = [
  'pending',
  'assigned',
  'picked_up',
];
/** Estados del PEDIDO en los que se puede crear/reabrir/asignar una entrega. */
export const DISPATCHABLE_ORDER_STATUSES = ['accepted', 'preparing', 'ready'] as const;

export const isDeliveryStatus = (value: unknown): value is DeliveryStatus =>
  typeof value === 'string' && (DELIVERY_STATUSES as readonly string[]).includes(value);
export const isOccupying = (status: string): boolean =>
  (OCCUPYING_STATUSES as readonly string[]).includes(status);
export const isOpen = (status: string): boolean =>
  (OPEN_STATUSES as readonly string[]).includes(status);

export const DELIVERY_EVENTS = [
  'created',
  'reopened',
  'rider_assigned',
  'rider_reassigned',
  'rider_unassigned',
  'picked_up',
  'delivered',
  'returned',
  'cancelled',
] as const;
export type DeliveryEvent = (typeof DELIVERY_EVENTS)[number];

export type DeliveryCommand =
  'assign' | 'unassign' | 'mark_picked_up' | 'mark_delivered' | 'return_to_branch' | 'cancel';

export interface DeliveryCommandSpec {
  command: DeliveryCommand;
  /** Segmento de ruta `POST /v1/admin/deliveries/{id}/<route>`. */
  route: string;
  /** Permisos que el personal debe tener EN LA SUCURSAL de la entrega (todos). */
  permissions: readonly string[];
  /** Estados de origen válidos. */
  from: readonly DeliveryStatus[];
  to: DeliveryStatus;
  /** Evento del historial (assign: `rider_assigned` o `rider_reassigned` según el origen). */
  event: DeliveryEvent;
  auditAction: string;
  reason: 'none' | 'optional' | 'required';
  /** Transición del PEDIDO que el comando dispara (misma transacción, vía `OrderTransitionsService`). */
  order?: { expected: string; to: string; auditAction: string };
}

/** Tabla de comandos (spec §3.2). `POST /` (crear/reabrir) no es un comando de estado: tiene su propio flujo. */
export const COMMAND_SPECS: Readonly<Record<DeliveryCommand, DeliveryCommandSpec>> = {
  assign: {
    command: 'assign',
    route: 'assign-own-rider',
    permissions: ['deliveries.assign', 'riders.assign'],
    from: ['pending', 'assigned'],
    to: 'assigned',
    event: 'rider_assigned',
    auditAction: 'delivery.rider_assigned',
    reason: 'none',
  },
  unassign: {
    command: 'unassign',
    route: 'unassign-rider',
    permissions: ['deliveries.assign'],
    from: ['assigned'],
    to: 'pending',
    event: 'rider_unassigned',
    auditAction: 'delivery.rider_unassigned',
    reason: 'optional',
  },
  mark_picked_up: {
    command: 'mark_picked_up',
    route: 'mark-picked-up',
    permissions: ['deliveries.update'],
    from: ['assigned'],
    to: 'picked_up',
    event: 'picked_up',
    auditAction: 'delivery.picked_up',
    reason: 'none',
    order: { expected: 'ready', to: 'on_the_way', auditAction: 'order.dispatched' },
  },
  mark_delivered: {
    command: 'mark_delivered',
    route: 'mark-delivered',
    permissions: ['deliveries.update'],
    from: ['picked_up'],
    to: 'delivered',
    event: 'delivered',
    auditAction: 'delivery.delivered',
    reason: 'none',
    order: { expected: 'on_the_way', to: 'delivered', auditAction: 'order.delivered' },
  },
  return_to_branch: {
    command: 'return_to_branch',
    route: 'return-to-branch',
    permissions: ['deliveries.update'],
    from: ['delivered'],
    to: 'returned',
    event: 'returned',
    auditAction: 'delivery.returned',
    reason: 'none',
  },
  cancel: {
    command: 'cancel',
    route: 'cancel',
    permissions: ['deliveries.update'],
    from: ['pending', 'assigned'],
    to: 'cancelled',
    event: 'cancelled',
    auditAction: 'delivery.cancelled',
    reason: 'required',
  },
};

/**
 * Grafo de estados de la ENTREGA (idéntico al de `deliveries_guard`, spec §3.2): comandos + reapertura (`cancelled → pending`).
 * `riderChanges` solo importa para `assigned → assigned` (la reasignación exige OTRO motorista).
 */
export function deliveryTransitionAllowed(
  from: DeliveryStatus,
  to: DeliveryStatus,
  riderChanges = false,
): boolean {
  if (from === 'cancelled' && to === 'pending') return true; // reapertura
  if (from === 'assigned' && to === 'assigned') return riderChanges;
  return Object.values(COMMAND_SPECS).some((spec) => spec.to === to && spec.from.includes(from));
}

// ---------- pedido elegible (crear / reabrir / asignar) ----------

export type OrderEligibilityCode =
  'ORDER_STATUS_NOT_DISPATCHABLE' | 'ORDER_NOT_DELIVERY' | 'ORDER_PROVIDER_NOT_OWN';

/** Razones por las que un pedido NO admite entrega propia (vacío = elegible). Todo sale de la fila de `orders`. */
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

// ---------- acciones disponibles (servidor => web) ----------

export type DeliveryActionName =
  | 'assign_rider'
  | 'reassign_rider'
  | 'unassign_rider'
  | 'mark_picked_up'
  | 'mark_delivered'
  | 'return_to_branch'
  | 'cancel';
export type DeliveryActionDisabledReason = 'NO_PERMISSION' | 'ORDER_NOT_READY';

export interface DeliveryActionState {
  action: DeliveryActionName;
  enabled: boolean;
  disabledReason: DeliveryActionDisabledReason | null;
}

const ACTION_COMMAND: Readonly<Record<DeliveryActionName, DeliveryCommand>> = {
  assign_rider: 'assign',
  reassign_rider: 'assign',
  unassign_rider: 'unassign',
  mark_picked_up: 'mark_picked_up',
  mark_delivered: 'mark_delivered',
  return_to_branch: 'return_to_branch',
  cancel: 'cancel',
};

/** Acciones que EXISTEN para un estado (derivadas de la tabla de comandos; `assign` se parte en asignar/reasignar). */
function actionsExisting(status: DeliveryStatus): DeliveryActionName[] {
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

/**
 * Acciones para ESTE personal y ESTA entrega. `canDo(permiso)` debe resolver el permiso EN LA SUCURSAL DE LA ENTREGA.
 * `NO_PERMISSION` (la web la oculta) tiene prioridad sobre `ORDER_NOT_READY` (recoger con el pedido aún en
 * `accepted|preparing`; la web la muestra deshabilitada).
 */
export function availableDeliveryActionsFor(
  delivery: { status: string },
  orderStatus: string,
  canDo: (permission: string) => boolean,
): DeliveryActionState[] {
  if (!isDeliveryStatus(delivery.status)) return [];
  return actionsExisting(delivery.status).map((action): DeliveryActionState => {
    const allowed = COMMAND_SPECS[ACTION_COMMAND[action]].permissions.every((p) => canDo(p));
    if (!allowed) return { action, enabled: false, disabledReason: 'NO_PERMISSION' };
    if (action === 'mark_picked_up' && orderStatus !== 'ready') {
      return { action, enabled: false, disabledReason: 'ORDER_NOT_READY' };
    }
    return { action, enabled: true, disabledReason: null };
  });
}

// ---------- motivo ----------

export const REASON_MIN = 3;
export const REASON_MAX = 280;
/** Control (Cc), formato (Cf: bidi, ancho cero…) y separadores de línea/párrafo (Zl, Zp): el mismo saneado que F22. */
const FORBIDDEN_REASON_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Marca de motivo inválido (el servicio lanza 400 `DELIVERY_REASON_REQUIRED`). */
export const INVALID_REASON: unique symbol = Symbol('INVALID_DELIVERY_REASON');

/**
 * Motivo INTERNO normalizado: recortado, 3..280 y sin caracteres de control. `null` = sin motivo (solo si es opcional y NO se
 * envió). `undefined` en uno obligatorio, o un valor inválido en uno opcional, devuelve `INVALID_REASON`.
 */
export function normalizeDeliveryReason(
  raw: string | undefined,
  mode: 'optional' | 'required',
): string | null | typeof INVALID_REASON {
  if (raw === undefined) return mode === 'required' ? INVALID_REASON : null;
  const reason = raw.trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return INVALID_REASON;
  if (FORBIDDEN_REASON_CHARS.test(reason)) return INVALID_REASON;
  return reason;
}

// ---------- seguimiento del cliente (F21, spec 029 §12) ----------

export type PublicDeliveryStatus = 'PENDING' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED';

/**
 * Estado público GRUESO de la entrega para el seguimiento: nunca datos del motorista. `delivered` y `returned` son ambos
 * `DELIVERED` (el retorno es interno). `cancelled` o estado desconocido => `null`.
 */
export function publicDeliveryStatus(
  status: string | null | undefined,
): PublicDeliveryStatus | null {
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
