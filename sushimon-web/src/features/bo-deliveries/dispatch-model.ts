import type { CourierQuote, Order, Rider, StaffRole } from '@/lib/data-access/models';
import { can } from '@/lib/permissions';
import { round2 } from './deliveries-view';

/**
 * Reglas puras del modal "Despachar pedido" (PedidosYa SIMULADO / repartidor propio). La validación definitiva es
 * del servidor (en mock, `dispatchOrder` responde 403/409/422); estas reglas solo evitan pedir lo imposible.
 */

export type DispatchStep = 'choose' | 'loading' | 'quote' | 'own';

/** Motivo por el que NO se puede despachar (null = se puede). El rol manda sobre el estado del pedido. */
export type DispatchBlock = 'role' | 'pickup' | 'notReady' | 'active' | null;

export function dispatchBlock(
  order: Pick<Order, 'status' | 'fulfillment' | 'delivery'>,
  role: StaffRole,
): DispatchBlock {
  if (!can(role, 'orders.dispatch')) return 'role';
  if (order.fulfillment !== 'delivery') return 'pickup';
  if (order.status !== 'ready') return 'notReady';
  if (order.delivery && order.delivery.status !== 'failed') return 'active';
  return null;
}

export type RiderState = 'free' | 'busy' | 'off';

export interface OwnRiderOption {
  rider: Rider;
  state: RiderState;
  available: boolean;
}

/** Repartidores propios de la sucursal del pedido, con su disponibilidad (en turno y sin pedido en ruta). */
export function ownRiderOptions(riders: readonly Rider[], order: Pick<Order, 'branchId'>) {
  return riders
    .filter((r) => r.branchId === order.branchId)
    .map<OwnRiderOption>((rider) => {
      const state: RiderState = !rider.active ? 'off' : rider.busy ? 'busy' : 'free';
      return { rider, state, available: state === 'free' };
    });
}

export interface QuoteComparison {
  /** Envío ya cobrado al cliente. */
  quoted: number;
  /** Costo vigente del courier. */
  current: number;
  /** current − quoted. */
  diff: number;
  changed: boolean;
}

/** Cotizado al cliente vs. costo vigente de PedidosYa (la diferencia se registra en Entregas). */
export function compareQuote(
  quote: Pick<CourierQuote, 'cost'>,
  order: Pick<Order, 'deliveryFee'>,
): QuoteComparison {
  const diff = round2(quote.cost - order.deliveryFee);
  return {
    quoted: order.deliveryFee,
    current: quote.cost,
    diff,
    changed: Math.abs(diff) > 0.001,
  };
}
