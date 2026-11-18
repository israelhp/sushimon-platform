import type {
  CourierQuote,
  DashboardAlert,
  DashboardSummary,
  DispatchRequest,
  DraftOrder,
  DraftOrderStatus,
  OrderStatusChangeRequest,
  Rider,
  StaffPermission,
  StaffUser,
} from '@/lib/data-access/models';
import { ORDER_STATUSES } from '@/lib/data-access/models';
import { canDispatch } from '@/lib/order-status';
import { minutesBetween } from '@/lib/time';
import { fail, findOrder, round2 } from '../domain';
import { clampRange } from '../factories/history';
import { hashSeed } from '../factories/random';
import {
  advanceDelivery,
  applyOrderStatus,
  courierCost,
  dispatchOrder,
  riderBusy,
} from './logistics';
import { settleReviews } from './orders';
import {
  assertOrderInScope,
  body,
  now,
  oneOf,
  ordersForDay,
  requireStaff,
  scopedBranchIds,
  str,
  today,
  type Handler,
  type Req,
} from './shared';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const byNewest = (a: DraftOrder, b: DraftOrder) => b.createdAt.localeCompare(a.createdAt);

/** Estados que cuentan como venta (aceptados en adelante, sin rechazados/cancelados). */
export const isSale = (o: DraftOrder) => !['received', 'rejected', 'cancelled'].includes(o.status);

/** GET /v1/backoffice/me */
export const getStaffMe: Handler = (req): StaffUser => {
  const actor = requireStaff(req);
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    role: actor.role,
    branchId: actor.scope.allBranches ? null : (actor.scope.branchIds[0] ?? null),
    active: actor.record.active,
    permissions: Object.keys(actor.grants),
  };
};

/** GET /v1/backoffice/dashboard?branchId */
export const getDashboard: Handler = (req): DashboardSummary => {
  const user = requireStaff(req, 'dashboard.read');
  const branchIds = scopedBranchIds(req, user);
  const date = today(req);
  const orders = ordersForDay(req, date, branchIds);
  settleReviews(req, orders);
  const t = now(req);
  const count = (...s: DraftOrderStatus[]) => orders.filter((o) => s.includes(o.status)).length;
  const alerts: DashboardAlert[] = [];
  for (const o of [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const minutes = minutesBetween(o.createdAt, t);
    if (o.status === 'received' && minutes > 5)
      alerts.push({ type: 'unaccepted', orderId: o.id, minutes });
    if (canDispatch(o)) alerts.push({ type: 'no_rider', orderId: o.id, minutes });
    if (o.delivery?.status === 'searching') {
      alerts.push({ type: 'searching_rider', orderId: o.id, minutes });
    }
  }
  return {
    date,
    branchId: branchIds.length === 1 ? (branchIds[0] ?? null) : null,
    received: orders.length,
    newPending: count('received'),
    inPreparation: count('accepted', 'preparing'),
    readyForDispatch: count('ready'),
    onTheWay: count('on_the_way'),
    delivered: count('delivered'),
    cancelled: count('rejected', 'cancelled'),
    sales: round2(orders.filter(isSale).reduce((s, o) => s + o.total, 0)),
    byBranch: branchIds.map((branchId) => {
      const mine = orders.filter((o) => o.branchId === branchId);
      return {
        branchId,
        orders: mine.length,
        sales: round2(mine.filter(isSale).reduce((s, o) => s + o.total, 0)),
      };
    }),
    alerts,
  };
};

/** GET /v1/backoffice/orders?branchId&status&date — status admite lista separada por comas. */
export const listBackofficeOrders: Handler = (req) => {
  const user = requireStaff(req);
  const branchIds = scopedBranchIds(req, user);
  const date = req.query.get('date') || today(req);
  if (!DATE_RE.test(date)) fail(400, 'Fecha inválida (YYYY-MM-DD)');
  const statusParam = req.query.get('status');
  const statuses = statusParam ? statusParam.split(',') : null;
  if (statuses?.some((s) => !(ORDER_STATUSES as readonly string[]).includes(s))) {
    fail(400, 'Estado inválido');
  }
  const orders = ordersForDay(req, date, branchIds);
  settleReviews(req, orders);
  return orders.filter((o) => !statuses || statuses.includes(o.status)).sort(byNewest);
};

function permissionForStatus(to: DraftOrderStatus): StaffPermission {
  switch (to) {
    case 'accepted':
      return 'orders.accept';
    case 'rejected':
      return 'orders.reject';
    case 'cancelled':
      return 'orders.cancel';
    case 'preparing':
      return 'orders.prepare';
    default:
      return 'orders.complete';
  }
}

function liveOrderInScope(req: Req, id: string, permission: StaffPermission) {
  const user = requireStaff(req, permission);
  const order = findOrder(req.store, id);
  assertOrderInScope(user, order);
  return order;
}

/** PATCH /v1/backoffice/orders/:id/status — { status, reason? } */
export const changeOrderStatus: Handler = (req) => {
  const b = body<OrderStatusChangeRequest>(req);
  const to = oneOf(b.status, ORDER_STATUSES, 'status');
  const order = liveOrderInScope(req, req.params.id ?? '', permissionForStatus(to));
  if ((to === 'rejected' || to === 'cancelled') && !str(b.reason).trim()) {
    fail(400, 'Indica el motivo');
  }
  applyOrderStatus(req, order, to, 'staff', str(b.reason));
  return order;
};

/** POST /v1/backoffice/orders/:id/dispatch — { provider, riderId? } */
export const dispatch: Handler = (req) => {
  const b = body<DispatchRequest>(req);
  const provider = oneOf(b.provider, ['pedidosya', 'own'] as const, 'provider');
  const order = liveOrderInScope(req, req.params.id ?? '', 'deliveries.assign');
  dispatchOrder(req, order, provider, str(b.riderId) || undefined);
  return order;
};

/** POST /v1/backoffice/deliveries/quote — { orderId } → cotización PedidosYa SIMULADA. */
export const quoteCourier: Handler = (req): CourierQuote => {
  const b = body<{ orderId: string }>(req);
  const order = liveOrderInScope(req, str(b.orderId), 'deliveries.assign');
  if (!canDispatch(order)) fail(409, 'El pedido no está listo para despacho');
  const t = now(req);
  return {
    quoteId: `PYQ-${hashSeed(`${order.id}|${order.updatedAt}`).toString(36).toUpperCase()}`,
    orderId: order.id,
    provider: 'pedidosya',
    cost: courierCost(req.store, order),
    currency: 'GTQ',
    customerFee: order.deliveryFee,
    etaMinMinutes: 25,
    etaMaxMinutes: 40,
    expiresAt: new Date(t.getTime() + 5 * 60_000).toISOString(),
    simulated: true,
  };
};

/** PATCH /v1/backoffice/deliveries/:orderId/advance — solo simulación. */
export const advance: Handler = (req) => {
  const order = liveOrderInScope(req, req.params.orderId ?? '', 'deliveries.assign');
  advanceDelivery(req, order);
  return order;
};

/** GET /v1/backoffice/deliveries?from&to&branchId&provider */
export const listDeliveries: Handler = (req) => {
  const user = requireStaff(req, 'deliveries.assign');
  const branchIds = scopedBranchIds(req, user);
  const from = req.query.get('from') || today(req);
  const to = req.query.get('to') || from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) fail(400, 'Fechas inválidas (YYYY-MM-DD)');
  const provider = req.query.get('provider');
  if (provider && provider !== 'pedidosya' && provider !== 'own') fail(400, 'Proveedor inválido');
  const { days } = clampRange(from, to, today(req));
  return days
    .flatMap((d) => ordersForDay(req, d, branchIds))
    .filter((o) => o.fulfillment === 'delivery')
    .filter((o) => !provider || o.delivery?.provider === provider)
    .sort(byNewest);
};

/** GET /v1/backoffice/riders?branchId */
export const listRiders: Handler = (req): Rider[] => {
  const user = requireStaff(req, 'deliveries.assign');
  const branchIds = scopedBranchIds(req, user);
  return req.store.riders
    .filter((r) => branchIds.includes(r.branchId))
    .map((r) => ({ ...r, busy: riderBusy(req.store, r.id) }));
};
