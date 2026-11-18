import type { OrderCreated } from '@/lib/data-access/models';

/**
 * F20 (ADR-0024, spec 021 §9) — Identificador de un pedido CONFIRMADO por el servidor. Tipo marcado: el único camino que
 * construye uno es `confirmedOrderId(created)` con una respuesta 200/201 de `POST /v1/orders`, y `clearAfterOrder` solo lo acepta.
 * Así nada puede vaciar el carrito «por pedido» ante un error, un estado ambiguo o una simulación.
 */
declare const confirmed: unique symbol;
export type ConfirmedOrderId = string & { readonly [confirmed]: true };

/** `null` si la respuesta no es un pedido real confirmado (sin `id`, sin número visible o sin estado). */
export function confirmedOrderId(created: OrderCreated): ConfirmedOrderId | null {
  const order = created?.order;
  if (!order || typeof order.id !== 'string' || !order.id) return null;
  if (typeof order.displayNumber !== 'string' || !order.displayNumber) return null;
  if (typeof order.status !== 'string') return null;
  return order.id as ConfirmedOrderId;
}
