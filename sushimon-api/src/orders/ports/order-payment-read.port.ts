/** Token de inyección del puerto de lectura de pagos (F24 lo reemplaza). */
export const ORDER_PAYMENT_READ_PORT = Symbol('ORDER_PAYMENT_READ_PORT');

/** Solo lectura: nunca crea, confirma ni devuelve pagos. */
export interface OrderPaymentReadPort {
  inspect(
    orderId: string,
    preference: 'cash' | 'bank_transfer' | null,
  ): Promise<{ pendingActions: 'payment_review'[] }>;
}

/**
 * Regla PROVISIONAL de F22 (P74): con transferencia bancaria puede haber un pago por conciliar o devolver. NO es un hecho
 * de pago (no hay tabla `payments` hasta F24); cuando exista, F24 sustituye esta clase por una lectura real.
 */
export class ProvisionalPaymentRule implements OrderPaymentReadPort {
  inspect(
    _orderId: string,
    preference: 'cash' | 'bank_transfer' | null,
  ): Promise<{ pendingActions: 'payment_review'[] }> {
    return Promise.resolve({
      pendingActions: preference === 'bank_transfer' ? ['payment_review'] : [],
    });
  }
}
