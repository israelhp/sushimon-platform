/** Token de inyección del puerto de lectura de pagos (F24 aporta la implementación real: `PaymentsReadAdapter`). */
export const ORDER_PAYMENT_READ_PORT = Symbol('ORDER_PAYMENT_READ_PORT');

/**
 * Solo lectura: nunca crea, confirma ni devuelve pagos. `payment_review` es un HECHO: pago `PAID` + pedido `rejected|cancelled`
 * (posible devolución pendiente; F26 la gestiona). Sin pago o con pago `PENDING` no hay revisión.
 */
export interface OrderPaymentReadPort {
  inspect(orderId: string): Promise<{ pendingActions: 'payment_review'[] }>;
}
