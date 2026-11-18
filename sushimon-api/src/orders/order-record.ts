import type { NewOrder, OrderRecord } from './orders.types.js';

const dec = (value: string) => ({ toFixed: () => value });
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Registro en memoria equivalente a la lectura posterior de la BD (mismo orden que `ORDER_SELECT`: líneas por `lineNo`,
 * extras y promociones por nombre): el 201 y el 200 de una repetición devuelven el mismo cuerpo. Los importes ya son
 * cadenas de 2 decimales (salen de la recotización).
 */
export function buildOrderRecord(
  order: NewOrder,
  created: { orderNumber: bigint; placedAt: Date; updatedAt: Date },
): OrderRecord {
  return {
    id: order.orderId,
    orderNumber: created.orderNumber,
    customerId: order.customerId,
    branchId: order.branchId,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    fulfillmentType: order.fulfillmentType,
    deliveryProvider: order.deliveryProvider,
    notes: order.notes,
    status: 'pending',
    subtotal: dec(order.subtotal),
    extrasTotal: dec(order.extrasTotal),
    discountTotal: dec(order.discountTotal),
    deliveryFee: dec(order.deliveryFee),
    total: dec(order.total),
    paymentMethodPreference: order.paymentMethodPreference,
    placedAt: created.placedAt,
    updatedAt: created.updatedAt,
    address: order.address
      ? {
          municipalityName: order.address.municipalityName,
          zone: order.address.zone,
          addressLine: order.address.addressLine,
          referenceNote: order.address.referenceNote,
        }
      : null,
    items: [...order.lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        lineNo: l.lineNo,
        productName: l.productName,
        quantity: l.quantity,
        unitPrice: dec(l.unitPrice),
        extrasPerUnit: dec(l.extrasPerUnit),
        lineDiscount: dec(l.lineDiscount),
        notes: null,
        modifiers: l.modifiers
          .map((m) => ({ modifierName: m.modifierName, unitExtraPrice: dec(m.unitExtraPrice) }))
          .sort((a, b) => byName(a.modifierName, b.modifierName)),
      })),
    promotions: order.promotions
      .map((p) => ({ promotionName: p.promotionName, amount: dec(p.amount) }))
      .sort((a, b) => byName(a.promotionName, b.promotionName)),
  };
}
