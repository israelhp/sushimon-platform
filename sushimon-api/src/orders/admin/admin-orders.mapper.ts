import { displayNumberOf, toOrderDetail } from '../order-mapper.js';
import { publicPaymentStatus, toPaymentSummary } from '../payments/payment-view.js';
import type {
  AdminHistoryRow,
  AdminOrderDetailRecord,
  AdminOrderRow,
  BoardCounts,
} from './admin-orders.types.js';
import type {
  AdminOrderBoardDto,
  AdminOrderDetailDto,
  AdminOrderHistoryEntryDto,
  AdminOrderSummaryDto,
} from './dto/admin-orders-responses.dto.js';
import { ACTIVE_STATUSES, ORDER_STATUSES, type ActionState } from './order-transition.matrix.js';

/** Sugerencia del servidor para el sondeo del tablero (constante; la web la acota a 10..60 s). */
export const BOARD_POLL_AFTER_SECONDS = 15;
export const TERMINAL_WINDOW_HOURS = 24;

export function toSummary(row: AdminOrderRow, actions: ActionState[]): AdminOrderSummaryDto {
  return {
    id: row.id,
    orderNumber: Number(row.orderNumber),
    displayNumber: displayNumberOf(row.orderNumber),
    status: row.status,
    branchId: row.branchId,
    branchName: row.branchName,
    fulfillmentType: row.fulfillmentType as 'PICKUP' | 'DELIVERY',
    deliveryProvider: row.deliveryProvider as 'OWN' | 'PEDIDOSYA' | null,
    customerName: row.customerName,
    itemCount: row.itemCount,
    total: row.total,
    // F24: solo `cash`; un valor histórico retirado (`bank_transfer`) se lee `null`.
    paymentMethodPreference: row.paymentMethodPreference === 'cash' ? 'cash' : null,
    paymentStatus: publicPaymentStatus(row.paymentStatus),
    scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
    placedAt: row.placedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    availableActions: actions.map((a) => ({ ...a })),
  };
}

export function toHistoryEntries(rows: AdminHistoryRow[]): AdminOrderHistoryEntryDto[] {
  return rows.map((e, i) => ({
    seq: i + 1,
    status: e.newStatus,
    previousStatus: e.oldStatus,
    at: e.changedAt.toISOString(),
    actorName: e.actorName,
    reason: e.reason,
  }));
}

/** Detalle: reutiliza `toOrderDetail` de F20 para líneas, promociones, dirección e importes (snapshots idénticos). */
export function toDetail(
  detail: AdminOrderDetailRecord,
  actions: ActionState[],
  canConfirmPayment: boolean,
): AdminOrderDetailDto {
  const base = toOrderDetail(detail.record);
  return {
    ...toSummary(detail.row, actions),
    currency: 'GTQ',
    lines: base.lines,
    promotions: base.promotions,
    address: base.address,
    contact: { fullName: detail.record.customerName, phone: detail.record.customerPhone },
    notes: base.notes,
    subtotal: base.subtotal,
    extrasTotal: base.extrasTotal,
    discountTotal: base.discountTotal,
    deliveryFee: base.deliveryFee,
    // F24: resumen de pago con `registration` calculado para ESTE personal; sin sentencia adicional (sale de la fila del pedido).
    payment: toPaymentSummary(
      {
        orderStatus: detail.row.status,
        fulfillmentType: detail.row.fulfillmentType,
        deliveryProvider: detail.row.deliveryProvider,
        total: detail.row.total,
        paymentStatus: detail.row.paymentStatus,
        paidAt: detail.row.paymentPaidAt,
      },
      canConfirmPayment,
    ),
    history: toHistoryEntries(detail.history),
    historyTruncated: detail.historyTruncated,
  };
}

/** Siempre las 9 columnas del catálogo en su orden fijo. */
export function toBoard(input: {
  generatedAt: Date;
  branchId: string | null;
  counts: BoardCounts[];
  cards: Map<string, AdminOrderSummaryDto[]>;
}): AdminOrderBoardDto {
  const countOf = (status: string) => input.counts.find((c) => c.status === status);
  const pending = countOf('pending');
  const active = ACTIVE_STATUSES.reduce((n, s) => n + (countOf(s)?.count ?? 0), 0);
  return {
    generatedAt: input.generatedAt.toISOString(),
    branchId: input.branchId,
    terminalWindowHours: TERMINAL_WINDOW_HOURS,
    pollAfterSeconds: BOARD_POLL_AFTER_SECONDS,
    summary: {
      pending: pending?.count ?? 0,
      active,
      oldestPendingAt: pending?.oldest ? pending.oldest.toISOString() : null,
    },
    columns: ORDER_STATUSES.map((status) => {
      const items = input.cards.get(status) ?? [];
      const count = countOf(status)?.count ?? 0;
      return { status, count, hasMore: count > items.length, items };
    }),
  };
}
