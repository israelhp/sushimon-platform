import type { DeliveryProvider, DraftOrder, DraftOrderStatus } from '@/lib/data-access/models';
import {
  canDispatch,
  checkTransition,
  nextDeliveryStatus,
  orderStatusForDelivery,
} from '@/lib/order-status';
import { event, fail, round2, touch } from '../domain';
import { COURIER_RIDER_NAMES } from '../fixtures/staff';
import { hashSeed } from '../factories/random';
import type { MockStore } from '../store';
import { now, type Req } from './shared';

/**
 * Despacho y avance logístico SIMULADOS (PedidosYa ⏳ sin documentación/credenciales; repartidor
 * propio). Nada sale a la red: costos, referencias y repartidores se derivan del pedido.
 */
const SURCHARGES = [0, 0, 0, 0, 0, 0, 0, 2.5, 4, 6.5];
const MINUTE = 60_000;

export function riderBusy(store: MockStore, riderId: string): boolean {
  return store.orders.some(
    (o) =>
      o.delivery?.provider === 'own' &&
      o.delivery.riderId === riderId &&
      o.delivery.status !== 'delivered' &&
      o.delivery.status !== 'failed',
  );
}

/** Costo simulado del courier: envío cobrado + recargo determinista. */
export function courierCost(store: MockStore, order: DraftOrder): number {
  const surcharge =
    store.courierSurcharges[order.id] ?? SURCHARGES[hashSeed(order.id) % SURCHARGES.length] ?? 0;
  return round2(order.deliveryFee + surcharge);
}

/** Aplica una transición de pedido (valida con la máquina única; inválida → 409). */
export function applyOrderStatus(
  req: Req,
  order: DraftOrder,
  to: DraftOrderStatus,
  source: 'staff' | 'logistics',
  reason?: string,
) {
  const check = checkTransition(order, to, source, reason);
  if (!check.ok) fail(409, check.reason);
  const at = now(req);
  order.status = to;
  if (to === 'rejected' || to === 'cancelled') order.rejectionReason = reason?.trim() ?? null;
  order.history.push(event(at, 'order', to, { reason: reason?.trim() || null }));
  if (to === 'delivered' && order.payment.method === 'cash' && order.payment.status === 'pending') {
    order.payment.status = 'approved';
    order.payment.processedAt = at.toISOString();
    order.history.push(event(at, 'payment', 'approved', { detail: 'cash' }));
  }
  touch(order, at);
}

export function dispatchOrder(
  req: Req,
  order: DraftOrder,
  provider: DeliveryProvider,
  riderId?: string,
) {
  if (!canDispatch(order)) {
    fail(409, 'Solo se despachan pedidos a domicilio listos y sin logística activa');
  }
  const at = now(req);
  if (provider === 'own') {
    if (!riderId) fail(400, 'Elige un repartidor');
    const rider = req.store.riders.find((r) => r.id === riderId);
    if (!rider) fail(422, 'Repartidor no encontrado');
    if (rider.branchId !== order.branchId) fail(422, 'El repartidor es de otra sucursal');
    if (!rider.active) fail(422, 'El repartidor no está activo');
    if (riderBusy(req.store, rider.id)) fail(409, 'El repartidor está ocupado');
    order.delivery = {
      provider: 'own',
      status: 'assigned',
      riderId: rider.id,
      riderName: `${rider.name} · moto`,
      reference: null,
      cost: null,
      requestedAt: at.toISOString(),
      etaAt: new Date(at.getTime() + 25 * MINUTE).toISOString(),
      deliveredAt: null,
      simulated: true,
    };
    order.history.push(event(at, 'delivery', 'assigned', { detail: rider.name }));
  } else {
    const reference = `PY-GT-77${req.store.sequences.courier++}`;
    order.delivery = {
      provider: 'pedidosya',
      status: 'searching',
      riderId: null,
      riderName: null,
      reference,
      cost: courierCost(req.store, order),
      requestedAt: at.toISOString(),
      etaAt: null,
      deliveredAt: null,
      simulated: true,
    };
    order.history.push(event(at, 'delivery', 'searching', { detail: reference }));
  }
  touch(order, at);
}

/** Avanza un paso la logística (y el pedido cuando corresponde). */
export function advanceDelivery(req: Req, order: DraftOrder) {
  const d = order.delivery;
  if (!d) fail(409, 'El pedido no tiene logística');
  if (d.status === 'delivered' || d.status === 'failed') fail(409, 'La logística ya terminó');
  const at = now(req);

  if (
    d.provider === 'pedidosya' &&
    d.status === 'searching' &&
    req.scenario === 'rider-unavailable'
  ) {
    d.status = 'failed';
    order.history.push(
      event(at, 'delivery', 'failed', { reason: 'PedidosYa no encontró repartidor (simulado)' }),
    );
    touch(order, at);
    return;
  }

  const next = nextDeliveryStatus(d.provider, d.status);
  if (!next) fail(409, 'La logística ya terminó');
  const orderTo = orderStatusForDelivery(d.provider, next);
  if (orderTo) {
    const check = checkTransition(order, orderTo, 'logistics');
    if (!check.ok) fail(409, check.reason);
  }
  d.status = next;
  if (next === 'assigned' && d.provider === 'pedidosya') {
    d.riderName = COURIER_RIDER_NAMES[hashSeed(order.id) % COURIER_RIDER_NAMES.length] ?? null;
    d.etaAt = new Date(at.getTime() + 24 * MINUTE).toISOString();
  }
  if (next === 'delivered') d.deliveredAt = at.toISOString();
  order.history.push(
    event(at, 'delivery', next, { detail: next === 'assigned' ? d.riderName : null }),
  );
  if (orderTo) applyOrderStatus(req, order, orderTo, 'logistics');
  touch(order, at);
}

/** Primer repartidor propio libre de la sucursal (para el avance de demostración). */
export function freeOwnRider(store: MockStore, branchId: string) {
  return store.riders.find((r) => r.branchId === branchId && r.active && !riderBusy(store, r.id));
}
