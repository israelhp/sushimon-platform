import { toOrderDetail } from '../order-mapper.js';
import { toPublicStatus } from '../order-tracking.mapper.js';
import { sourceToOrderRecord, type OrderSource } from '../order-source.repository.js';
import type { OrderReceiptDto } from './dto/order-receipt.dto.js';

export const RECEIPT_TIME_ZONE = 'America/Guatemala';

/**
 * `OrderSource` -> `OrderReceipt` (contrato F23). Función pura: `now` se inyecta. Reutiliza `toOrderDetail` (F20) para que líneas,
 * extras, descuentos, importes, teléfono enmascarado y pago (`NOT_STARTED`, F24 no existe) sean EXACTAMENTE los de `getOrder`;
 * aquí solo se SELECCIONAN campos: ni `id` (pedido, sucursal), ni tokens, correo, coordenadas, motivo, historial, actor ni
 * `updatedAt`. Nada se recalcula desde el catálogo.
 */
export function toOrderReceipt(source: OrderSource, now: Date): OrderReceiptDto {
  const detail = toOrderDetail(sourceToOrderRecord(source));
  const provider = detail.deliveryProvider;
  return {
    fiscalStatus: 'NOT_FISCAL',
    displayNumber: detail.displayNumber,
    status: detail.status,
    publicStatus: toPublicStatus(detail.status),
    placedAt: detail.placedAt,
    generatedAt: now.toISOString(),
    timeZone: RECEIPT_TIME_ZONE,
    currency: 'GTQ',
    branch: {
      name: source.branchName,
      address: source.branchAddress,
      phone: source.branchPhone,
    },
    fulfillment: { type: detail.fulfillmentType, provider },
    address: detail.address,
    contact: detail.contact,
    lines: detail.lines,
    promotions: detail.promotions,
    notes: detail.notes,
    subtotal: detail.subtotal,
    extrasTotal: detail.extrasTotal,
    discountTotal: detail.discountTotal,
    deliveryFee: detail.deliveryFee,
    total: detail.total,
    payment: detail.payment,
  };
}
