import type { OrderTracking, OrderTrackingStep } from '@/lib/data-access/models';

/** F21 — fábrica de `OrderTracking` para pruebas de la web (forma real del contrato). Determinista: sin reloj ni azar. */
export const TRACKING_ORDER_ID = '00000000-0000-4000-8000-000000300001';
export const at = (hour: number, minute = 0) =>
  `2026-11-18T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

export const PICKUP_FLOW = ['received', 'accepted', 'preparing', 'ready', 'completed'] as const;
export const DELIVERY_FLOW = [
  'received',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'completed',
] as const;

export function stepsFor(
  flow: readonly OrderTrackingStep['phase'][],
  reached: number,
): OrderTrackingStep[] {
  return flow.map((phase, i) => ({ phase, reachedAt: i < reached ? at(18, i * 5) : null }));
}

export function makeTracking(over: Partial<OrderTracking> = {}): OrderTracking {
  return {
    orderId: TRACKING_ORDER_ID,
    displayNumber: 'MON-001042',
    branchId: 'sucursal-1',
    fulfillmentType: 'PICKUP',
    status: 'pending',
    publicStatus: 'received',
    terminal: false,
    placedAt: at(18, 0),
    updatedAt: at(18, 0),
    generatedAt: at(18, 1),
    steps: stepsFor(PICKUP_FLOW, 1),
    events: [{ seq: 1, status: 'pending', publicStatus: 'received', occurredAt: at(18, 0) }],
    eventsTruncated: false,
    delivery: null,
    payment: { method: 'CASH', status: 'PENDING', paidAt: null },
    pollAfterSeconds: 15,
    ...over,
  };
}
