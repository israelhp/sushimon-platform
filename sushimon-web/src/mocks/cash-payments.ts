import type {
  AdminOrderPayment,
  AdminOrderPaymentBlockedReason,
  AdminOrderPaymentSummary,
  AdminPaymentEvent,
  DraftOrder,
  OrderDetailPayment,
  OrderReceiptPayment,
  PaymentCollectionContext,
} from '@/lib/data-access/models';
import { moneyToCents } from '@/lib/checkout-quote';
import { centsToPrice } from '@/lib/product-rules';
import type { RuleOrder } from './admin-orders';
import type { MockStore } from './store';

/**
 * F24 (spec 025 §12.3) — Pago en EFECTIVO SIMULADO. Misma forma que el contrato, sobre el almacén del mock: un pago por pedido
 * (clave = número del pedido borrador enlazado), `PENDING` hasta que el personal registra la recepción por
 * `registerAdminOrderCashPayment`. NADA lo marca `PAID` salvo ese registro (ni los cambios de estado, ni la demo legada). Es una
 * SIMULACIÓN: nunca confirma un cobro real ni se mezcla con `http`.
 */

/** Tope de seguridad del efectivo entregado (P83): Q 5,000.00. */
export const MAX_TENDERED_CENTS = 500_000;

/** Recepción registrada en el mock. La clave de idempotencia se guarda tal cual (solo en memoria del mock; el servidor real guarda su hash). */
export interface MockCashPayment {
  amountApplied: string;
  tendered: string;
  change: string;
  receivedAt: string;
  collectorId: string;
  collectorName: string;
  context: PaymentCollectionContext;
  key: string;
  /** Cuerpo canónico (`tendered` en centavos): misma clave + otro cuerpo => 409 `IDEMPOTENCY_KEY_REUSED`. */
  requestHash: string;
}

export const cents = (value: number) => Math.round(value * 100);
export const money = (c: number) => centsToPrice(c);

export const paymentRecord = (store: MockStore, orderId: string): MockCashPayment | null =>
  store.cashPayments?.[orderId] ?? null;

export const contextOf = (rule: Pick<RuleOrder, 'fulfillmentType' | 'deliveryProvider'>) =>
  rule.fulfillmentType === 'PICKUP'
    ? ('BRANCH' as const)
    : rule.deliveryProvider === 'PEDIDOSYA'
      ? null
      : ('OWN_DELIVERY' as const);

/** Pago público seguro (`OrderDetail.payment`, `OrderTracking.payment`): sin empleado, sin historial. */
export function publicPayment(store: MockStore, orderId: string): OrderDetailPayment {
  const record = paymentRecord(store, orderId);
  return record
    ? { method: 'CASH', status: 'PAID', paidAt: record.receivedAt }
    : { method: 'CASH', status: 'PENDING', paidAt: null };
}

/** Pago del recibo NO fiscal: con `PAID`, importe aplicado, efectivo entregado y cambio. */
export function receiptPayment(store: MockStore, orderId: string): OrderReceiptPayment {
  const record = paymentRecord(store, orderId);
  return record
    ? {
        method: 'CASH',
        status: 'PAID',
        paidAt: record.receivedAt,
        amountPaid: record.amountApplied,
        tendered: record.tendered,
        change: record.change,
      }
    : {
        method: 'CASH',
        status: 'PENDING',
        paidAt: null,
        amountPaid: null,
        tendered: null,
        change: null,
      };
}

const CLOSED = ['rejected', 'cancelled'] as const;
export const isClosed = (status: RuleOrder['status']) =>
  (CLOSED as readonly string[]).includes(status);

/** ¿Por qué ESTA persona no puede registrar el cobro ahora? (`null` = puede). Orden de precedencia fijo. */
export function blockedReasonOf(
  store: MockStore,
  draft: DraftOrder,
  rule: RuleOrder,
  canConfirm: boolean,
): AdminOrderPaymentBlockedReason | null {
  if (paymentRecord(store, draft.id)) return 'ALREADY_PAID';
  if (!canConfirm) return 'NO_PERMISSION';
  if (isClosed(rule.status)) return 'ORDER_CLOSED';
  if (rule.deliveryProvider === 'PEDIDOSYA') return 'PROVIDER_BLOCKED_EXTERNAL';
  if (cents(draft.total) <= 0) return 'AMOUNT_ZERO';
  return null;
}

export function adminPaymentSummary(
  store: MockStore,
  draft: DraftOrder,
  rule: RuleOrder,
  canConfirm: boolean,
): AdminOrderPaymentSummary {
  const record = paymentRecord(store, draft.id);
  const due = money(cents(draft.total));
  const blockedReason = blockedReasonOf(store, draft, rule, canConfirm);
  return {
    method: 'CASH',
    status: record ? 'PAID' : 'PENDING',
    amountDue: due,
    outstanding: record ? '0.00' : due,
    paidAt: record?.receivedAt ?? null,
    possibleRefundReview: Boolean(record) && isClosed(rule.status),
    registration: { allowed: blockedReason === null, blockedReason },
  };
}

export function adminPayment(
  store: MockStore,
  draft: DraftOrder,
  rule: RuleOrder,
  canConfirm: boolean,
  generatedAt: Date,
): AdminOrderPayment {
  const record = paymentRecord(store, draft.id);
  return {
    ...adminPaymentSummary(store, draft, rule, canConfirm),
    orderId: draft.id,
    displayNumber: draft.id,
    orderStatus: rule.status,
    branchId: draft.branchId,
    fulfillmentType: rule.fulfillmentType,
    deliveryProvider: rule.deliveryProvider,
    currency: 'GTQ',
    collectionContext: contextOf(rule),
    reception: record
      ? {
          amountApplied: record.amountApplied,
          tendered: record.tendered,
          change: record.change,
          receivedAt: record.receivedAt,
          collectorType: 'STAFF',
          collectorName: record.collectorName,
          branchId: draft.branchId,
          context: record.context,
        }
      : null,
    generatedAt: generatedAt.toISOString(),
  };
}

/** Eventos solo-añadir del pago: `CREATED` con el pedido y, si se cobró, `CASH_RECEIVED`. */
export function paymentEvents(store: MockStore, draft: DraftOrder): AdminPaymentEvent[] {
  const due = money(cents(draft.total));
  const events: AdminPaymentEvent[] = [
    {
      seq: 1,
      type: 'CREATED',
      at: draft.createdAt,
      actorName: null,
      amountDue: due,
      tendered: null,
      change: null,
    },
  ];
  const record = paymentRecord(store, draft.id);
  if (record) {
    events.push({
      seq: 2,
      type: 'CASH_RECEIVED',
      at: record.receivedAt,
      actorName: record.collectorName,
      amountDue: due,
      tendered: record.tendered,
      change: record.change,
    });
  }
  return events;
}

export type TenderedParse =
  { ok: true; cents: number } | { ok: false; code: 'PAYMENT_AMOUNT_INVALID' };

/** Misma regla que el servidor: `^[0-9]{1,9}(\.[0-9]{1,2})?$`, `> 0`, sin redondeo silencioso. */
export function parseTendered(raw: unknown): TenderedParse {
  if (typeof raw !== 'string') return { ok: false, code: 'PAYMENT_AMOUNT_INVALID' };
  const m = /^([0-9]{1,9})(?:\.([0-9]{1,2}))?$/.exec(raw);
  if (!m) return { ok: false, code: 'PAYMENT_AMOUNT_INVALID' };
  const value = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return value > 0 ? { ok: true, cents: value } : { ok: false, code: 'PAYMENT_AMOUNT_INVALID' };
}

export const requestHashOf = (orderId: string, tenderedCents: number) =>
  `cash-receipt|${orderId}|${tenderedCents}`;

export { moneyToCents };
