import type { OrderStatus } from '../admin/order-transition.matrix.js';

/** Token de inyección del puerto de entrega (F28 lo reemplazó por `DeliveriesFulfillmentAdapter`; F29 añadirá PedidosYa). */
export const ORDER_FULFILLMENT_PORT = Symbol('ORDER_FULFILLMENT_PORT');

export interface FulfillmentInspection {
  activeDelivery: boolean;
  pendingActions: 'delivery_cancellation'[];
}

/**
 * F22 CONSUME este puerto en SOLO LECTURA, tras el commit de `reject`/`cancel`. F22 no escribe entregas ni llama a
 * proveedores; F28 aportará la implementación real (entrega propia) y F29 PedidosYa (`BLOCKED_EXTERNAL`).
 */
export interface OrderFulfillmentPort {
  inspect(order: {
    orderId: string;
    branchId: string;
    fulfillmentType: 'PICKUP' | 'DELIVERY';
    deliveryProvider: 'OWN' | 'PEDIDOSYA' | null;
    status: OrderStatus;
  }): Promise<FulfillmentInspection>;
}

/** Doble de F22 («sin entregas»). Ya NO está enlazado en `OrdersModule` (F28: `DeliveriesFulfillmentAdapter`): solo para pruebas. */
export class NoDeliveryFulfillment implements OrderFulfillmentPort {
  inspect(): Promise<FulfillmentInspection> {
    return Promise.resolve({ activeDelivery: false, pendingActions: [] });
  }
}
