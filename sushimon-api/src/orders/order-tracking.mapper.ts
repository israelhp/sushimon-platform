import { displayNumberOf, toPublicPayment } from './order-mapper.js';
import type { OrderTrackingRecord } from './order-tracking.types.js';
import type {
  OrderPublicStatusCode,
  OrderTrackingDto,
  OrderTrackingEventDto,
  OrderTrackingStepDto,
} from './dto/order-tracking.dto.js';

/** Eventos que se exponen como máximo; se leen `MAX + 1` para detectar el truncamiento. */
export const MAX_TRACKING_EVENTS = 50;
export const TRACKING_HISTORY_READ_LIMIT = MAX_TRACKING_EVENTS + 1;

/** `pollAfterSeconds` por estado (P63): constantes del servidor. */
const POLL_AFTER_SECONDS: Readonly<Record<string, number>> = {
  pending: 15,
  accepted: 20,
  preparing: 30,
  ready: 15,
  on_the_way: 15,
};
const DEFAULT_POLL_AFTER_SECONDS = 30;

const PUBLIC_STATUS: Readonly<Record<string, OrderPublicStatusCode>> = {
  pending: 'received',
  accepted: 'accepted',
  preparing: 'preparing',
  ready: 'ready',
  on_the_way: 'on_the_way',
  delivered: 'completed',
  picked_up: 'completed',
  rejected: 'rejected',
  cancelled: 'cancelled',
};
/** Estado con el que se presenta un `orders.status` fuera del catálogo (imposible por el CHECK): coherente con `received`. */
const FALLBACK_STATUS = 'pending';
const isKnownStatus = (status: string): boolean => Object.hasOwn(PUBLIC_STATUS, status);

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
]);

const PICKUP_FLOW: readonly OrderPublicStatusCode[] = [
  'received',
  'accepted',
  'preparing',
  'ready',
  'completed',
];
const DELIVERY_FLOW: readonly OrderPublicStatusCode[] = [
  'received',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'completed',
];

/**
 * Fase pública de un estado. Un valor fuera del catálogo (imposible por el CHECK de la BD) se presenta como `received`
 * y NO terminal: nunca se declara cancelado/entregado algo que no se conoce, y el cliente sigue consultando.
 */
export function toPublicStatus(status: string): OrderPublicStatusCode {
  return PUBLIC_STATUS[status] ?? 'received';
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Recorrido esperado de la modalidad (`DELIVERY` incluye `on_the_way`; cualquier otra cosa se trata como `PICKUP`). */
export function flowFor(fulfillmentType: string): readonly OrderPublicStatusCode[] {
  return fulfillmentType === 'DELIVERY' ? DELIVERY_FLOW : PICKUP_FLOW;
}

/** Sugerencia de espera en segundos; `null` si el estado es terminal. */
export function pollAfterSeconds(status: string): number | null {
  if (isTerminalStatus(status)) return null;
  return POLL_AFTER_SECONDS[status] ?? DEFAULT_POLL_AFTER_SECONDS;
}

/**
 * `steps`: cada fase lleva el `changed_at` del PRIMER evento cuya fase pública es esa (`null` si ninguno; jamás una hora
 * estimada). `rejected`/`cancelled` cortan el recorrido: solo las fases alcanzadas (con hora) más la fase terminal. Un
 * salto en el historial deja la fase omitida con `reachedAt: null` (no se corrige ni se inventa).
 */
export function buildSteps(
  fulfillmentType: string,
  status: string,
  history: readonly { newStatus: string; changedAt: Date }[],
): OrderTrackingStepDto[] {
  const first = new Map<OrderPublicStatusCode, string>();
  for (const entry of history) {
    const phase = toPublicStatus(entry.newStatus);
    if (!first.has(phase)) first.set(phase, entry.changedAt.toISOString());
  }
  const at = (phase: OrderPublicStatusCode): string | null => first.get(phase) ?? null;
  const publicStatus = toPublicStatus(status);

  if (publicStatus === 'rejected' || publicStatus === 'cancelled') {
    const reached = flowFor(fulfillmentType)
      .map((phase) => ({ phase, reachedAt: at(phase) }))
      .filter((step) => step.reachedAt !== null);
    return [...reached, { phase: publicStatus, reachedAt: at(publicStatus) }];
  }
  return flowFor(fulfillmentType).map((phase) => ({ phase, reachedAt: at(phase) }));
}

/**
 * `OrderTrackingRecord` -> `OrderTracking` (contrato). Función pura: `now` se inyecta. `orders.status` manda sobre el estado
 * actual; el historial se entrega tal cual (duplicados, saltos o desorden incluidos), con orden estable `changed_at` (el
 * repositorio ya desempata por `id`). Nunca expone contacto, dirección, notas, importes, `changed_by`, `reason` ni ids (salvo el `orderId` propio).
 * `status`/`events[].status` solo toman valores de `OrderLifecycleStatus`: un evento desconocido se omite y un
 * `orders.status` desconocido se presenta como `pending` (fase `received`, no terminal).
 */
export function toOrderTracking(record: OrderTrackingRecord, now: Date): OrderTrackingDto {
  // Un evento fuera del catálogo (imposible por el CHECK de la BD) se OMITE: nunca se expone un valor crudo.
  // `sort` es estable: los empates de `changed_at` conservan el orden `id` que fijó la consulta.
  const known = record.history
    .filter((entry) => isKnownStatus(entry.newStatus))
    .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  // Con más de 50 eventos se conservan los 50 MÁS RECIENTES (el último evento nunca se pierde) y se marca el truncado:
  // faltan los más antiguos. `steps` se calcula con lo que se expone: una fase alcanzada solo en eventos omitidos aparece
  // con `reachedAt: null` (no se inventa la hora); si es anterior a la fase actual, la web la presenta como superada.
  const truncated = known.length > MAX_TRACKING_EVENTS;
  const shown = truncated ? known.slice(known.length - MAX_TRACKING_EVENTS) : known;
  const events: OrderTrackingEventDto[] = shown.map((entry, index) => ({
    seq: index + 1,
    status: entry.newStatus,
    publicStatus: toPublicStatus(entry.newStatus),
    occurredAt: entry.changedAt.toISOString(),
  }));

  const status = isKnownStatus(record.status) ? record.status : FALLBACK_STATUS;
  const isDelivery = record.fulfillmentType === 'DELIVERY';
  const provider =
    record.deliveryProvider === 'OWN' || record.deliveryProvider === 'PEDIDOSYA'
      ? record.deliveryProvider
      : null;

  return {
    orderId: record.id,
    displayNumber: displayNumberOf(record.orderNumber),
    branchId: record.branchId,
    fulfillmentType: isDelivery ? 'DELIVERY' : 'PICKUP',
    status,
    publicStatus: toPublicStatus(status),
    terminal: isTerminalStatus(status),
    placedAt: record.placedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    generatedAt: now.toISOString(),
    steps: buildSteps(record.fulfillmentType, status, shown),
    events,
    eventsTruncated: truncated,
    // Sin tabla `deliveries` (F28/F29): solo el proveedor del pedido; `status` reservado, siempre null.
    delivery: isDelivery && provider ? { provider, status: null } : null,
    // F24: estado de pago real, FUERA de `steps`/`events` (el timeline es solo operativo).
    payment: toPublicPayment(record.payment),
    pollAfterSeconds: pollAfterSeconds(status),
  };
}
