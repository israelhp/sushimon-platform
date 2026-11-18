import { Injectable } from '@nestjs/common';

/** Token de inyección del puerto de eventos de pedido (F31 lo implementará; spec 021 §7, P58). */
export const ORDER_EVENTS_PUBLISHER = Symbol('ORDER_EVENTS_PUBLISHER');

export interface OrderCreatedEvent {
  orderId: string;
  branchId: string;
}

/**
 * Puerto de salida de eventos del pedido. Se invoca DESPUÉS del commit (nunca dentro de la transacción) y su fallo
 * jamás afecta la respuesta de la creación. No hay outbox persistente en F20 (decisión de F31 con su ADR).
 */
export interface OrderEventsPublisher {
  orderCreated(event: OrderCreatedEvent): Promise<void>;
}

/** Implementación de F20: no envía nada (sin WhatsApp, correo ni PedidosYa). */
@Injectable()
export class NoopOrderEventsPublisher implements OrderEventsPublisher {
  orderCreated(): Promise<void> {
    return Promise.resolve();
  }
}
