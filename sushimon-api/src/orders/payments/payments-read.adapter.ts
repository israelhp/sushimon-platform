import { Inject, Injectable } from '@nestjs/common';
import type { OrderPaymentReadPort } from '../ports/order-payment-read.port.js';
import { PaymentsRepository } from './payments.repository.js';

/**
 * Lectura REAL del pago para F22 (reemplaza a la regla provisional de P74): `payment_review` = hecho derivado, el pago está
 * `PAID` y el pedido quedó `rejected|cancelled` => posible devolución pendiente. Solo lectura (1 sentencia); jamás crea
 * reembolsos ni toca pagos.
 */
@Injectable()
export class PaymentsReadAdapter implements OrderPaymentReadPort {
  constructor(@Inject(PaymentsRepository) private readonly repo: PaymentsRepository) {}

  async inspect(orderId: string): Promise<{ pendingActions: 'payment_review'[] }> {
    return {
      pendingActions: (await this.repo.hasPaidOnClosedOrder(orderId)) ? ['payment_review'] : [],
    };
  }
}
