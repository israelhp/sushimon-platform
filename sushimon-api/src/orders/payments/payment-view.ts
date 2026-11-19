import { displayNumberOf } from '../order-mapper.js';
import { dbMoneyToCents } from './cash-amount.js';
import type {
  AdminOrderPaymentDto,
  AdminOrderPaymentRegistrationDto,
  AdminOrderPaymentSummaryDto,
  AdminPaymentHistoryDto,
  PaymentReceptionDto,
} from './dto/admin-payments.dto.js';
import type {
  CollectionContext,
  PaymentHistoryRecord,
  PaymentOrderView,
  PaymentRow,
} from './payments.types.js';
import type { NotCollectableCode } from './payments-errors.js';

/** Estados de pedido que NO se cobran (y que, con cobro, dejan «posible devolución pendiente»). */
export const CLOSED_ORDER_STATUSES: readonly string[] = ['rejected', 'cancelled'];

export type PaymentBlockedReason =
  | 'ALREADY_PAID'
  | 'ORDER_CLOSED'
  | 'PROVIDER_BLOCKED_EXTERNAL'
  | 'AMOUNT_ZERO'
  | 'LEGACY_PAYMENT_METHOD'
  | 'NO_PERMISSION';

/** Lo mínimo del pedido+pago que necesita el resumen (lo comparten el detalle de F22 y `getAdminOrderPayment`). */
export interface PaymentSummarySource {
  orderStatus: string;
  fulfillmentType: string;
  deliveryProvider: string | null;
  /** `orders.total` (`"185.00"`). */
  total: string;
  /** `pending` | `paid`; `null` = pedido histórico sin fila de pago. */
  paymentStatus: string | null;
  paidAt: Date | null;
}

export const isPaid = (status: string | null): boolean => status === 'paid';

/** Estado público: `PAID` solo con `paid`; cualquier otra cosa (incluida la ausencia de fila) se lee `PENDING`. */
export const publicPaymentStatus = (status: string | null): 'PENDING' | 'PAID' =>
  isPaid(status) ? 'PAID' : 'PENDING';

/** `PAID` + pedido `rejected|cancelled` => «posible devolución pendiente» (hecho derivado; no crea reembolso). */
export const possibleRefundReviewOf = (src: PaymentSummarySource): boolean =>
  isPaid(src.paymentStatus) && CLOSED_ORDER_STATUSES.includes(src.orderStatus);

/** Contexto de cobro DERIVADO del pedido: PICKUP => mostrador; DELIVERY `OWN` => entrega propia; PedidosYa/otro => `null`. */
export function collectionContextOf(
  fulfillmentType: string,
  deliveryProvider: string | null,
): CollectionContext | null {
  if (fulfillmentType === 'PICKUP') return 'BRANCH';
  if (fulfillmentType === 'DELIVERY' && deliveryProvider === 'OWN') return 'OWN_DELIVERY';
  return null;
}

/** Razón (primera que aplica) por la que el registro está bloqueado; `null` = permitido. El estado manda sobre el permiso. */
export function blockedReasonOf(
  src: PaymentSummarySource,
  canConfirm: boolean,
): PaymentBlockedReason | null {
  if (isPaid(src.paymentStatus)) return 'ALREADY_PAID';
  if (CLOSED_ORDER_STATUSES.includes(src.orderStatus)) return 'ORDER_CLOSED';
  // UNA sola fuente de verdad con el POST: sin contexto de cobro derivable (PedidosYa, DELIVERY sin proveedor `OWN`) no se cobra.
  if (collectionContextOf(src.fulfillmentType, src.deliveryProvider) === null) {
    return 'PROVIDER_BLOCKED_EXTERNAL';
  }
  if (src.paymentStatus === null) return 'LEGACY_PAYMENT_METHOD';
  if (dbMoneyToCents(src.total) === 0) return 'AMOUNT_ZERO';
  if (!canConfirm) return 'NO_PERMISSION';
  return null;
}

/** Mismas razones que `blockedReasonOf` pero como código de 422 (el POST ya resolvió ALREADY_PAID, ORDER_CLOSED y permiso). */
export function notCollectableOf(src: PaymentSummarySource): NotCollectableCode | null {
  const reason = blockedReasonOf(src, true);
  return reason === 'PROVIDER_BLOCKED_EXTERNAL' ||
    reason === 'LEGACY_PAYMENT_METHOD' ||
    reason === 'AMOUNT_ZERO'
    ? reason
    : null;
}

export function toRegistration(
  src: PaymentSummarySource,
  canConfirm: boolean,
): AdminOrderPaymentRegistrationDto {
  const blockedReason = blockedReasonOf(src, canConfirm);
  return { allowed: blockedReason === null, blockedReason };
}

/** `AdminOrderPaymentSummary` (contrato): sin sentencia adicional, a partir de la fila del pedido. */
export function toPaymentSummary(
  src: PaymentSummarySource,
  canConfirm: boolean,
): AdminOrderPaymentSummaryDto {
  const paid = isPaid(src.paymentStatus);
  return {
    method: 'CASH',
    status: publicPaymentStatus(src.paymentStatus),
    amountDue: src.total,
    outstanding: paid ? '0.00' : src.total,
    paidAt: paid && src.paidAt ? src.paidAt.toISOString() : null,
    possibleRefundReview: possibleRefundReviewOf(src),
    registration: toRegistration(src, canConfirm),
  };
}

function toReception(view: PaymentOrderView, pay: PaymentRow): PaymentReceptionDto | null {
  if (!isPaid(pay.status) || pay.tendered === null || pay.change === null || !pay.receivedAt) {
    return null;
  }
  return {
    amountApplied: pay.amount,
    tendered: pay.tendered,
    change: pay.change,
    receivedAt: pay.receivedAt.toISOString(),
    collectorType: 'STAFF',
    collectorName: pay.collectorName,
    branchId: view.branchId,
    context:
      pay.collectionContext === 'OWN_DELIVERY' || pay.collectionContext === 'BRANCH'
        ? pay.collectionContext
        : (collectionContextOf(view.fulfillmentType, view.deliveryProvider) ?? 'BRANCH'),
  };
}

/** `AdminOrderPayment` (contrato). `canConfirm` = `payments.confirm` EN LA SUCURSAL DEL PEDIDO. Sin ids de empleado ni hashes. */
export function toAdminPayment(
  view: PaymentOrderView,
  canConfirm: boolean,
  now: Date,
): AdminOrderPaymentDto {
  const pay = view.payment;
  const src: PaymentSummarySource = {
    orderStatus: view.orderStatus,
    fulfillmentType: view.fulfillmentType,
    deliveryProvider: view.deliveryProvider,
    total: view.total,
    paymentStatus: pay?.status ?? null,
    paidAt: pay?.receivedAt ?? null,
  };
  return {
    ...toPaymentSummary(src, canConfirm),
    orderId: view.orderId,
    displayNumber: displayNumberOf(view.orderNumber),
    orderStatus: view.orderStatus,
    branchId: view.branchId,
    fulfillmentType: view.fulfillmentType as 'PICKUP' | 'DELIVERY',
    deliveryProvider: view.deliveryProvider as 'OWN' | 'PEDIDOSYA' | null,
    currency: 'GTQ',
    collectionContext: collectionContextOf(view.fulfillmentType, view.deliveryProvider),
    reception: pay ? toReception(view, pay) : null,
    generatedAt: now.toISOString(),
  };
}

const EVENT_TYPES: Readonly<Record<string, 'CREATED' | 'CASH_RECEIVED'>> = {
  created: 'CREATED',
  cash_received: 'CASH_RECEIVED',
};

/** `AdminPaymentHistory`: eventos conocidos en orden cronológico (los desconocidos se omiten), `seq` 1..N, sin ids ni hashes. */
export function toPaymentHistory(record: PaymentHistoryRecord, now: Date): AdminPaymentHistoryDto {
  const known = record.events.filter((e) => Object.hasOwn(EVENT_TYPES, e.type)).slice(0, 20);
  return {
    orderId: record.orderId,
    displayNumber: displayNumberOf(record.orderNumber),
    items: known.map((e, i) => ({
      seq: i + 1,
      type: EVENT_TYPES[e.type] as 'CREATED' | 'CASH_RECEIVED',
      at: e.at.toISOString(),
      actorName: e.actorName,
      amountDue: e.amount,
      tendered: e.tendered,
      change: e.change,
    })),
    generatedAt: now.toISOString(),
  };
}
