import { centsToDecimal, decimalToCents } from '../common/money/money.js';
import { maskPhone } from './order-contact.policy.js';
import type { DecimalLike, OrderRecord } from './orders.types.js';
import type { OrderDetailDto } from './dto/order-responses.dto.js';

const money = (value: DecimalLike): string => value.toFixed(2);
const cents = (value: DecimalLike): number => decimalToCents(money(value));

/** Número visible `MON-001042` (presentación; el prefijo de sucursal es P53). NUNCA es una credencial. */
export function displayNumberOf(orderNumber: bigint): string {
  return `MON-${orderNumber.toString().padStart(6, '0')}`;
}

/**
 * `OrderRecord` -> `OrderDetail` (contrato). Minimización de PII: teléfono enmascarado, sin correo ni coordenadas (ni
 * siquiera se leen). Importes en cadenas de 2 decimales; los derivados de línea se calculan en centavos enteros. `payment`
 * es SIEMPRE `NOT_STARTED` en F20 (no hay cobro ni registro de pago).
 */
export function toOrderDetail(order: OrderRecord): OrderDetailDto {
  return {
    id: order.id,
    orderNumber: Number(order.orderNumber),
    displayNumber: displayNumberOf(order.orderNumber),
    status: order.status,
    branchId: order.branchId,
    fulfillmentType: order.fulfillmentType as 'PICKUP' | 'DELIVERY',
    deliveryProvider: order.deliveryProvider as 'OWN' | 'PEDIDOSYA' | null,
    currency: 'GTQ',
    lines: order.items.map((item) => {
      const unit = cents(item.unitPrice);
      const extras = cents(item.extrasPerUnit);
      const subtotal = (unit + extras) * item.quantity;
      const discount = cents(item.lineDiscount);
      return {
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: money(item.unitPrice),
        modifiers: item.modifiers.map((m) => ({
          name: m.modifierName,
          extraPrice: money(m.unitExtraPrice),
        })),
        extrasPerUnit: money(item.extrasPerUnit),
        lineSubtotal: centsToDecimal(subtotal),
        discount: money(item.lineDiscount),
        lineTotal: centsToDecimal(subtotal - discount),
        notes: item.notes,
      };
    }),
    promotions: order.promotions.map((p) => ({ name: p.promotionName, amount: money(p.amount) })),
    address: order.address
      ? {
          municipalityName: order.address.municipalityName,
          zone: order.address.zone,
          addressLine: order.address.addressLine,
          referenceNote: order.address.referenceNote,
        }
      : null,
    contact: { fullName: order.customerName, phoneMasked: maskPhone(order.customerPhone) },
    notes: order.notes,
    subtotal: money(order.subtotal),
    extrasTotal: money(order.extrasTotal),
    discountTotal: money(order.discountTotal),
    deliveryFee: money(order.deliveryFee),
    total: money(order.total),
    payment: {
      methodPreference: order.paymentMethodPreference as 'cash' | 'bank_transfer' | null,
      status: 'NOT_STARTED',
    },
    placedAt: order.placedAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
