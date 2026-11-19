import type {
  DraftOrder,
  OrderDetail,
  OrderLifecycleStatus,
  OrderPublicStatus,
  OrderTracking,
  OrderTrackingEvent,
  OrderTrackingStep,
} from '@/lib/data-access/models';

/**
 * F21 (spec 022 §9.5) — `OrderTracking` SIMULADO con la forma REAL del contrato, construido desde el historial del pedido BORRADOR
 * enlazado (`draft.history`, solo `kind === 'order'`). Imita las reglas del servidor (§3, §3.1, §3.2, §4) sin ser la API: el mapeo
 * `received→pending` y `delivered→delivered|picked_up` según la modalidad; `steps` con la hora REAL del primer evento de cada
 * fase; `rejected`/`cancelled` cortan el recorrido; `pollAfterSeconds` por estado (`null` en terminal). Nada se inventa.
 */

const MAX_EVENTS = 50;

const POLL_AFTER: Partial<Record<OrderLifecycleStatus, number>> = {
  pending: 15,
  accepted: 20,
  preparing: 30,
  ready: 15,
  on_the_way: 15,
};

const PUBLIC_OF: Record<OrderLifecycleStatus, OrderPublicStatus> = {
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

const TERMINAL: readonly OrderLifecycleStatus[] = [
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];

const FLOW: Record<OrderTracking['fulfillmentType'], readonly OrderPublicStatus[]> = {
  PICKUP: ['received', 'accepted', 'preparing', 'ready', 'completed'],
  DELIVERY: ['received', 'accepted', 'preparing', 'ready', 'on_the_way', 'completed'],
};

/** Estado del borrador (`received`, `delivered`…) → estado real del pedido (`pending`, `delivered|picked_up`…). */
function lifecycleOf(
  draftStatus: string,
  fulfillment: OrderTracking['fulfillmentType'],
): OrderLifecycleStatus {
  switch (draftStatus) {
    case 'received':
      return 'pending';
    case 'delivered':
      return fulfillment === 'PICKUP' ? 'picked_up' : 'delivered';
    case 'accepted':
    case 'preparing':
    case 'ready':
    case 'on_the_way':
    case 'rejected':
    case 'cancelled':
      return draftStatus;
    default:
      return 'pending';
  }
}

export function buildOrderTracking(
  detail: OrderDetail,
  draft: DraftOrder,
  generatedAt: Date,
): OrderTracking {
  const fulfillmentType = detail.fulfillmentType;
  const all: OrderTrackingEvent[] = draft.history
    .filter((e) => e.kind === 'order')
    .map((e, index) => {
      const status = lifecycleOf(e.status, fulfillmentType);
      return { seq: index + 1, status, publicStatus: PUBLIC_OF[status], occurredAt: e.at };
    });
  const events = all.slice(0, MAX_EVENTS);
  const status = lifecycleOf(draft.status, fulfillmentType);
  const publicStatus = PUBLIC_OF[status];
  const terminal = TERMINAL.includes(status);

  const reachedAt = (phase: OrderPublicStatus): string | null =>
    events.find((e) => e.publicStatus === phase)?.occurredAt ?? null;
  const flow = FLOW[fulfillmentType].map<OrderTrackingStep>((phase) => ({
    phase,
    reachedAt: reachedAt(phase),
  }));
  const steps: OrderTrackingStep[] =
    publicStatus === 'rejected' || publicStatus === 'cancelled'
      ? [
          ...flow.filter((s) => s.reachedAt !== null),
          { phase: publicStatus, reachedAt: reachedAt(publicStatus) },
        ]
      : flow;

  return {
    orderId: detail.id,
    displayNumber: detail.displayNumber,
    branchId: detail.branchId,
    fulfillmentType,
    status,
    publicStatus,
    terminal,
    placedAt: detail.placedAt,
    updatedAt: draft.updatedAt,
    generatedAt: generatedAt.toISOString(),
    steps,
    events,
    eventsTruncated: all.length > MAX_EVENTS,
    delivery:
      fulfillmentType === 'DELIVERY'
        ? { provider: detail.deliveryProvider ?? 'OWN', status: null }
        : null,
    pollAfterSeconds: terminal ? null : (POLL_AFTER[status] ?? 30),
  };
}
