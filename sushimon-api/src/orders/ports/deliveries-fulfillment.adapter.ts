import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { FulfillmentInspection, OrderFulfillmentPort } from './order-fulfillment.port.js';

/** Estados de entrega que impiden cancelar o rechazar el pedido (trigger `orders_open_delivery_guard`, migración 0022). */
const ACTIVE = new Set(['pending', 'assigned', 'picked_up']);

/**
 * Adaptador REAL de `OrderFulfillmentPort` (F28, spec 029 §11 F22-5; reemplaza a `NoDeliveryFulfillment` en `OrdersModule`).
 * Solo LECTURA (F22 no escribe entregas ni llama a proveedores): `activeDelivery` = existe una entrega del pedido en
 * `pending|assigned|picked_up`. `pendingActions` es `[]` para `OWN`: cancelar o rechazar un pedido con entrega abierta ya se
 * RECHAZA (409 `ORDER_HAS_ACTIVE_DELIVERY`), así que tras un cancel/reject exitoso no queda nada por cancelar; el valor
 * `delivery_cancellation` queda reservado a F29 (PedidosYa, `BLOCKED_EXTERNAL`). Una sentencia (índice `UNIQUE(order_id)`) y solo
 * para pedidos DELIVERY `OWN`; cualquier otro caso no consulta la BD. Solo ids: ningún dato personal.
 */
@Injectable()
export class DeliveriesFulfillmentAdapter implements OrderFulfillmentPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async inspect(
    order: Parameters<OrderFulfillmentPort['inspect']>[0],
  ): Promise<FulfillmentInspection> {
    if (order.fulfillmentType !== 'DELIVERY' || order.deliveryProvider !== 'OWN') {
      return { activeDelivery: false, pendingActions: [] };
    }
    const rows = await this.prisma.$queryRaw<{ status: string }[]>(Prisma.sql`
      SELECT status FROM app.deliveries WHERE order_id = ${order.orderId}::uuid`);
    const status = rows[0]?.status;
    return { activeDelivery: status !== undefined && ACTIVE.has(status), pendingActions: [] };
  }
}
