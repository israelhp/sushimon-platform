import { centsToDecimal, decimalToCents } from '../common/money/money.js';
import { maskPhone } from './order-contact.policy.js';
import type { DecimalLike, OrderPaymentRecord, OrderRecord } from './orders.types.js';
import type { OrderDetailDto, OrderDetailPaymentDto } from './dto/order-responses.dto.js';
import type { OrderReceiptPaymentDto } from './receipt/dto/order-receipt.dto.js';

const money = (value: DecimalLike): string => value.toFixed(2);
const cents = (value: DecimalLike): number => decimalToCents(money(value));

/** `PAID` solo con `paid`; ausencia de fila o cualquier otro valor se lee `PENDING` (nunca se declara pagado algo no confirmado). */
type PublicPaymentInput = Pick<OrderPaymentRecord, 'status' | 'receivedAt'>;
const isPaid = <T extends PublicPaymentInput>(payment: T | null | undefined): payment is T =>
  payment?.status === 'paid';

/**
 * Pago con vocabulario PÚBLICO seguro (F24): siempre efectivo (`CASH`), `PENDING|PAID` y `paidAt`. NUNCA el empleado que cobró,
 * el historial ni la auditoría; sin importes (los importes solo viajan en el recibo).
 */
export function toPublicPayment(
  payment: PublicPaymentInput | null | undefined,
): OrderDetailPaymentDto {
  const paid = isPaid(payment);
  return {
    method: 'CASH',
    status: paid ? 'PAID' : 'PENDING',
    paidAt: paid && payment.receivedAt ? payment.receivedAt.toISOString() : null,
  };
}

/** Pago del RECIBO: lo público + importe aplicado (= total), efectivo entregado y cambio solo con `PAID`; con `PENDING`, `null`. */
export function toReceiptPayment(
  payment: OrderPaymentRecord | null | undefined,
): OrderReceiptPaymentDto {
  const base = toPublicPayment(payment);
  const paid = isPaid(payment) && payment.tendered !== null && payment.change !== null;
  return {
    ...base,
    amountPaid: paid ? money(payment.amount) : null,
    tendered: paid ? money(payment.tendered as DecimalLike) : null,
    change: paid ? money(payment.change as DecimalLike) : null,
  };
}

/** Número visible `MON-001042` (presentación; el prefijo de sucursal es P53). NUNCA es una credencial. */
export function displayNumberOf(orderNumber: bigint): string {
  return `MON-${orderNumber.toString().padStart(6, '0')}`;
}

/**
 * `OrderRecord` -> `OrderDetail` (contrato). Minimización de PII: teléfono enmascarado, sin correo ni coordenadas (ni
 * siquiera se leen). Importes en cadenas de 2 decimales; los derivados de línea se calculan en centavos enteros. `payment` es
 * el pago real en efectivo (F24): `{CASH, PENDING|PAID, paidAt}`.
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
    payment: toPublicPayment(order.payment),
    placedAt: order.placedAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
