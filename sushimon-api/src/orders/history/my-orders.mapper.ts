import { displayNumberOf } from '../order-mapper.js';
import { isTerminalStatus, toPublicStatus } from '../order-tracking.mapper.js';
import type { MyOrderSummaryDto } from './dto/my-orders.dto.js';
import type { MyOrderRow } from './my-orders.types.js';

/**
 * Fila -> `MyOrderSummary` (contrato F23). `publicStatus`/`terminal` salen del MISMO mapeo de F21 (`toPublicStatus`,
 * `isTerminalStatus`): no se reimplementa. Columnas mínimas: nunca líneas, contacto, dirección, notas ni motivo.
 */
export function toMyOrderSummary(row: MyOrderRow): MyOrderSummaryDto {
  return {
    id: row.id,
    orderNumber: Number(row.orderNumber),
    displayNumber: displayNumberOf(row.orderNumber),
    status: row.status,
    publicStatus: toPublicStatus(row.status),
    terminal: isTerminalStatus(row.status),
    branchId: row.branchId,
    branchName: row.branchName,
    fulfillmentType: row.fulfillmentType === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
    deliveryProvider:
      row.deliveryProvider === 'OWN' || row.deliveryProvider === 'PEDIDOSYA'
        ? row.deliveryProvider
        : null,
    itemCount: row.itemCount,
    total: row.total,
    currency: 'GTQ',
    paymentMethodPreference:
      row.paymentMethodPreference === 'cash' || row.paymentMethodPreference === 'bank_transfer'
        ? row.paymentMethodPreference
        : null,
    placedAt: row.placedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
