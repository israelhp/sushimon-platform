import type {
  AdminOrderActionState,
  AdminOrderDetail,
  AdminOrderHistoryEntry,
  AdminOrderPendingAction,
  AdminOrderSummary,
  Branch,
  DraftOrder,
  DraftOrderStatus,
  OrderDetailLine,
  OrderLifecycleStatus,
  OrderPaymentPreference,
  StaffPermission,
} from '@/lib/data-access/models';
import type { AdminOrderCommand } from '@/services/admin-orders';
import { adminPaymentSummary, paymentRecord } from './cash-payments';
import type { MockStore, PlacedOrderRecord } from './store';

/**
 * F22 (spec 023 §3, §4.2) — SIMULACIÓN de la matriz de transiciones, `availableActions` y las vistas `AdminOrder*` sobre el almacén
 * de pedidos BORRADOR del mock. Es la MISMA tabla de casos que la API real (spec §11 #1/#56): la web nunca la consulta (usa
 * `availableActions`); solo el mock y sus pruebas. Mapeo de estados: `received ↔ pending` y `delivered → picked_up` en PICKUP.
 */

export type AdminAction = AdminOrderActionState['action'];
export type FulfillmentType = 'PICKUP' | 'DELIVERY';
export type DeliveryProvider = 'OWN' | 'PEDIDOSYA' | null;

export type ViolationCode =
  | 'ORDER_TERMINAL'
  | 'ORDER_FULFILLMENT_MISMATCH'
  | 'ORDER_SOURCE_INVALID'
  | 'ORDER_DISPATCH_NOT_AVAILABLE'
  | 'ORDER_PROVIDER_BLOCKED_EXTERNAL'
  | 'ORDER_CANCEL_NOT_ALLOWED';

export interface RuleOrder {
  status: OrderLifecycleStatus;
  fulfillmentType: FulfillmentType;
  deliveryProvider: DeliveryProvider;
}

export const TERMINAL: readonly OrderLifecycleStatus[] = [
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];

interface CommandSpec {
  permission: StaffPermission;
  action: AdminAction;
  sources: readonly OrderLifecycleStatus[];
  to: OrderLifecycleStatus;
  reason: boolean;
  verb: string;
}

/** Tabla de §3.1: comando → permiso, origen(es), destino y si exige motivo. */
export const COMMAND_SPECS: Record<AdminOrderCommand, CommandSpec> = {
  accept: {
    permission: 'orders.accept',
    action: 'accept',
    sources: ['pending'],
    to: 'accepted',
    reason: false,
    verb: 'order.accepted',
  },
  reject: {
    permission: 'orders.reject',
    action: 'reject',
    sources: ['pending'],
    to: 'rejected',
    reason: true,
    verb: 'order.rejected',
  },
  'start-preparing': {
    permission: 'orders.prepare',
    action: 'start_preparing',
    sources: ['accepted'],
    to: 'preparing',
    reason: false,
    verb: 'order.preparation_started',
  },
  'mark-ready': {
    permission: 'orders.prepare',
    action: 'mark_ready',
    sources: ['preparing'],
    to: 'ready',
    reason: false,
    verb: 'order.marked_ready',
  },
  complete: {
    permission: 'orders.complete',
    action: 'complete',
    sources: ['ready'],
    to: 'picked_up',
    reason: false,
    verb: 'order.completed',
  },
  cancel: {
    permission: 'orders.cancel',
    action: 'cancel',
    sources: ['pending', 'accepted', 'preparing', 'ready'],
    to: 'cancelled',
    reason: true,
    verb: 'order.cancelled',
  },
};

export const COMMANDS = Object.keys(COMMAND_SPECS) as AdminOrderCommand[];

export type CommandCheck = { ok: true } | { ok: false; code: ViolationCode };

/**
 * Matriz de §3.2: ¿es válido ejecutar `command` desde `origin` (el `expectedStatus` que vio la persona) sobre un pedido de esa
 * modalidad y proveedor? Ningún comando produce `on_the_way`/`delivered`: eso es F28.
 */
export function checkCommand(
  order: Pick<RuleOrder, 'fulfillmentType' | 'deliveryProvider'>,
  command: AdminOrderCommand,
  origin: OrderLifecycleStatus,
): CommandCheck {
  const spec = COMMAND_SPECS[command];
  if (TERMINAL.includes(origin)) return { ok: false, code: 'ORDER_TERMINAL' };
  if (command === 'cancel' && origin === 'on_the_way') {
    return {
      ok: false,
      code:
        order.fulfillmentType === 'PICKUP' ? 'ORDER_SOURCE_INVALID' : 'ORDER_CANCEL_NOT_ALLOWED',
    };
  }
  if (!spec.sources.includes(origin)) return { ok: false, code: 'ORDER_SOURCE_INVALID' };
  if (command === 'complete' && order.fulfillmentType !== 'PICKUP') {
    return { ok: false, code: 'ORDER_FULFILLMENT_MISMATCH' };
  }
  return { ok: true };
}

/** Acciones que existen para el estado y la modalidad (spec §4.2), en orden de presentación. */
function actionsFor(order: RuleOrder): AdminAction[] {
  switch (order.status) {
    case 'pending':
      return ['accept', 'reject', 'cancel'];
    case 'accepted':
      return ['start_preparing', 'cancel'];
    case 'preparing':
      return ['mark_ready', 'cancel'];
    case 'ready':
      return order.fulfillmentType === 'PICKUP' ? ['complete', 'cancel'] : ['cancel', 'dispatch'];
    default:
      return [];
  }
}

const PERMISSION_OF: Record<Exclude<AdminAction, 'dispatch'>, StaffPermission> = {
  accept: 'orders.accept',
  reject: 'orders.reject',
  start_preparing: 'orders.prepare',
  mark_ready: 'orders.prepare',
  complete: 'orders.complete',
  cancel: 'orders.cancel',
};

/**
 * `availableActions` como las calcularía el servidor (`availableActionsFor`): sin permiso => `NO_PERMISSION`. `dispatch` es
 * INFORMATIVA (no es un comando de pedidos: la web abre Entregas para crear y asignar); desde F28 (spec 029 §11 F22-5b) está
 * HABILITADA para `OWN` con `deliveries.assign` en la sucursal del pedido, `NO_PERMISSION` sin él y deshabilitada con
 * `PROVIDER_BLOCKED_EXTERNAL` para PedidosYa (F29, `BLOCKED_EXTERNAL`).
 */
export function availableActionsFor(
  order: RuleOrder,
  can: (permission: StaffPermission) => boolean,
): AdminOrderActionState[] {
  return actionsFor(order).map((action): AdminOrderActionState => {
    if (action === 'dispatch') {
      if (order.deliveryProvider === 'PEDIDOSYA') {
        return { action, enabled: false, disabledReason: 'PROVIDER_BLOCKED_EXTERNAL' };
      }
      if (order.deliveryProvider !== 'OWN') {
        return { action, enabled: false, disabledReason: 'DISPATCH_NOT_AVAILABLE' };
      }
      return can('deliveries.assign')
        ? { action, enabled: true, disabledReason: null }
        : { action, enabled: false, disabledReason: 'NO_PERMISSION' };
    }
    return can(PERMISSION_OF[action])
      ? { action, enabled: true, disabledReason: null }
      : { action, enabled: false, disabledReason: 'NO_PERMISSION' };
  });
}

// ── Mapeo borrador ↔ real ───────────────────────────────────────────────────────────────────────

export const lifecycleOf = (
  status: DraftOrderStatus,
  fulfillment: DraftOrder['fulfillment'],
): OrderLifecycleStatus => {
  if (status === 'received') return 'pending';
  if (status === 'delivered') return fulfillment === 'pickup' ? 'picked_up' : 'delivered';
  return status;
};

export const draftStatusOf = (status: OrderLifecycleStatus): DraftOrderStatus => {
  if (status === 'pending') return 'received';
  if (status === 'picked_up') return 'delivered';
  return status;
};

const money = (n: number) => n.toFixed(2);
const digitsOf = (s: string) => Number(s.replace(/\D/g, '')) || 0;

export function ruleOrderOf(draft: DraftOrder, placed?: PlacedOrderRecord): RuleOrder {
  const fulfillmentType: FulfillmentType = draft.fulfillment === 'pickup' ? 'PICKUP' : 'DELIVERY';
  let deliveryProvider: DeliveryProvider = null;
  if (fulfillmentType === 'DELIVERY') {
    deliveryProvider =
      draft.delivery?.provider === 'pedidosya'
        ? 'PEDIDOSYA'
        : (placed?.detail.deliveryProvider ?? 'OWN');
  }
  return {
    status: lifecycleOf(draft.status, draft.fulfillment),
    fulfillmentType,
    deliveryProvider,
  };
}

/** Preferencia de pago informativa (NO es un pago): solo `cash` o `null` (F24 retira `bank_transfer`). */
export function paymentPreferenceOf(
  draft: DraftOrder,
  placed?: PlacedOrderRecord,
): OrderPaymentPreference | null {
  if (placed) return 'cash';
  return draft.payment.method === 'cash' ? 'cash' : null;
}

/**
 * `pendingActions` de `reject`/`cancel` (F24: hecho real, ya no una heurística por preferencia): pago `PAID` y pedido cerrado =>
 * «posible devolución pendiente» (`payment_review`). Informativa: no existe ninguna acción de reembolso (F26).
 */
export function pendingActionsFor(
  command: AdminOrderCommand,
  paid: boolean,
): AdminOrderPendingAction[] {
  if (command !== 'reject' && command !== 'cancel') return [];
  return paid ? ['payment_review'] : [];
}

export function toAdminSummary(
  draft: DraftOrder,
  branches: readonly Pick<Branch, 'id' | 'name'>[],
  can: (permission: StaffPermission) => boolean,
  store: MockStore,
  placed?: PlacedOrderRecord,
): AdminOrderSummary {
  const rule = ruleOrderOf(draft, placed);
  return {
    id: draft.id,
    orderNumber: digitsOf(draft.id),
    displayNumber: draft.id,
    status: rule.status,
    branchId: draft.branchId,
    branchName: branches.find((b) => b.id === draft.branchId)?.name ?? draft.branchId,
    fulfillmentType: rule.fulfillmentType,
    deliveryProvider: rule.deliveryProvider,
    customerName: draft.customer.name,
    itemCount: draft.lines.reduce((sum, l) => sum + l.quantity, 0),
    total: money(draft.total),
    paymentMethodPreference: paymentPreferenceOf(draft, placed),
    paymentStatus: paymentRecord(store, draft.id) ? 'PAID' : 'PENDING',
    scheduledFor: null,
    placedAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    availableActions: availableActionsFor(rule, can),
  };
}

const MAX_HISTORY = 50;

export function toAdminDetail(
  draft: DraftOrder,
  branches: readonly Pick<Branch, 'id' | 'name'>[],
  can: (permission: StaffPermission) => boolean,
  store: MockStore,
  placed?: PlacedOrderRecord,
): AdminOrderDetail {
  const summary = toAdminSummary(draft, branches, can, store, placed);
  const lines: OrderDetailLine[] =
    placed?.detail.lines ??
    draft.lines.map((l) => ({
      productName: l.name,
      quantity: l.quantity,
      unitPrice: money(l.unitPrice),
      modifiers: [],
      extrasPerUnit: '0.00',
      lineSubtotal: money(l.subtotal),
      discount: '0.00',
      lineTotal: money(l.subtotal),
      notes: l.note ? l.note : null,
    }));
  const events = draft.history.filter((e) => e.kind === 'order');
  const all: AdminOrderHistoryEntry[] = events.map((e, i) => ({
    seq: i + 1,
    status: lifecycleOf(e.status as DraftOrderStatus, draft.fulfillment),
    previousStatus:
      i === 0 ? null : lifecycleOf(events[i - 1]?.status as DraftOrderStatus, draft.fulfillment),
    at: e.at,
    actorName: e.detail ?? null,
    reason: e.reason ?? null,
  }));
  return {
    ...summary,
    currency: 'GTQ',
    lines,
    promotions:
      placed?.detail.promotions ??
      (draft.discount > 0 ? [{ name: 'Descuento', amount: money(draft.discount) }] : []),
    address:
      summary.fulfillmentType === 'DELIVERY' && draft.address
        ? (placed?.detail.address ?? {
            municipalityName: draft.address.municipality,
            zone: draft.address.zone || null,
            addressLine: draft.address.line,
            referenceNote: draft.address.references || null,
          })
        : null,
    contact: { fullName: draft.customer.name, phone: draft.customer.phone },
    notes: draft.note ? draft.note : null,
    subtotal: money(draft.subtotal),
    extrasTotal: placed?.detail.extrasTotal ?? '0.00',
    discountTotal: money(draft.discount),
    deliveryFee: money(draft.deliveryFee),
    payment: adminPaymentSummary(store, draft, ruleOrderOf(draft, placed), can('payments.confirm')),
    history: all.slice(-MAX_HISTORY),
    historyTruncated: all.length > MAX_HISTORY,
  };
}
