import { ApiError, codeForStatus } from '@/lib/data-access/errors';
import type {
  AdminOrderBoard,
  AdminOrderBoardColumn,
  AdminOrderDetail,
  AdminOrderPage,
  AdminOrderSummary,
  AdminOrderTransitionResult,
  DraftOrder,
  OrderLifecycleStatus,
  StaffPermission,
} from '@/lib/data-access/models';
import { can } from '@/lib/permissions';
import { addDaysISO, localDate } from '@/lib/time';
import type { AdminOrderCommand } from '@/services/admin-orders';
import { event, isAwaitingPayment, normalizeOrderNumber, touch } from '../domain';
import { generateDayOrders, HISTORY_DAYS } from '../factories/history';
import {
  COMMAND_SPECS,
  checkCommand,
  draftStatusOf,
  lifecycleOf,
  pendingActionsFor,
  ruleOrderOf,
  toAdminDetail,
  toAdminSummary,
  type ViolationCode,
} from '../admin-orders';
import { paymentRecord } from '../cash-payments';
import type { MockStore, PlacedOrderRecord } from '../store';
import {
  body,
  now,
  requireStaff,
  staffBranchIds,
  today,
  type Handler,
  type Req,
  type StaffActor,
} from './shared';

/**
 * F22 (spec 023) — Handlers SIMULADOS de `/v1/admin/orders*` con la FORMA REAL del contrato (`AdminOrder*`), derivados del almacén
 * de pedidos borrador del mock. Misma matriz, mismo `expectedStatus` (compare-and-set), mismos 400/401/403/404/409/422/429/503 y
 * `availableActions` que el servidor; la web los consume por el MISMO camino que en `http`. SIMULACIÓN: nada sale a la red.
 *
 * Fallos de prueba (`window.__sushimonMockFaults['GET /v1/admin/orders/board']`…): `rate-limited` (429 con `Retry-After`), `busy`
 * (503 `ORDERS_BUSY`) y, en los comandos, `other-applied` / `other-rejected` (otra persona ya aplicó la misma transición o rechazó
 * el pedido justo antes: devuelve el `replayed` ajeno o el 409 con `current`).
 */

type Obj = Record<string, unknown>;

const TERMINAL_WINDOW_MS = 24 * 3_600_000;
const BOARD_TERMINAL_LIMIT = 10;
const BOARD_ACTIVE_DEFAULT_LIMIT = 30;
const POLL_AFTER_SECONDS = 15;
const MAX_RANGE_DAYS = 92;
const RETRY_AFTER_SEC = 12;
const STATUS_ORDER: readonly OrderLifecycleStatus[] = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];
const ACTIVE: readonly OrderLifecycleStatus[] = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
];
const WITH_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Error con el cuerpo completo del contrato (`ErrorResponse` + extensiones como `current`) y `Retry-After` opcional. */
export function problem(
  status: number,
  code: string | undefined,
  message: string,
  extra: Obj = {},
  retryAfterSec?: number,
): never {
  const error = codeForStatus(status);
  const violations = extra.violations as
    { path: string; code: string; message: string }[] | undefined;
  throw new ApiError(
    status,
    error,
    message,
    undefined,
    Array.isArray(extra.details) ? (extra.details as string[]) : undefined,
    code,
    violations,
    retryAfterSec,
    { statusCode: status, error, message, ...(code ? { code } : {}), ...extra },
  );
}

export function faultGuard(req: Req): void {
  if (req.fault === 'rate-limited') {
    problem(
      429,
      'RATE_LIMITED',
      'Demasiadas solicitudes; espera unos segundos',
      {},
      RETRY_AFTER_SEC,
    );
  }
  if (req.fault === 'busy') {
    problem(503, 'ORDERS_BUSY', 'Hay mucha demanda; reintenta en unos segundos', {}, 2);
  }
}

export const placedOf = (store: MockStore, draftId: string): PlacedOrderRecord | undefined =>
  store.placedOrders?.find((p) => p.draftId === draftId);

/** Evaluador de permisos del actor para la sucursal del pedido (lo que el servidor resuelve con `canAccess`). */
export const canFor =
  (actor: StaffActor, branchId: string) =>
  (permission: StaffPermission): boolean =>
    can(actor.grants, permission, branchId);

function summaryOf(req: Req, actor: StaffActor, draft: DraftOrder): AdminOrderSummary {
  return toAdminSummary(
    draft,
    req.store.branches,
    canFor(actor, draft.branchId),
    req.store,
    placedOf(req.store, draft.id),
  );
}

function branchScope(req: Req, actor: StaffActor): string[] {
  return staffBranchIds(req.store, actor);
}

/** `branchId` de la consulta: debe existir y estar en el alcance de `orders.read` (si no, 404 `BRANCH_NOT_FOUND`). */
function requestedBranches(req: Req, actor: StaffActor): string[] {
  const allowed = branchScope(req, actor);
  const requested = req.query.get('branchId');
  if (!requested) return allowed;
  if (!allowed.includes(requested)) problem(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
  return [requested];
}

function dedupe(orders: DraftOrder[]): DraftOrder[] {
  const seen = new Set<string>();
  return orders.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
}

/** Pedidos del almacén (cualquier fecha) + historial generado de los días indicados, dentro del alcance. */
function universe(req: Req, branchIds: string[], days: string[]): DraftOrder[] {
  const live = req.store.orders.filter((o) => !isAwaitingPayment(o));
  const generated = req.store.historyEnabled
    ? days.flatMap((d) => generateDayOrders(d, today(req)))
    : [];
  return dedupe([...live, ...generated]).filter((o) => branchIds.includes(o.branchId));
}

/** Busca un pedido por número aunque sea de un día anterior (el historial generado no vive en el almacén). */
function findDraft(req: Req, rawId: string): DraftOrder | undefined {
  const id = normalizeOrderNumber(rawId);
  const live = req.store.orders.find((o) => o.id === id);
  if (live || !req.store.historyEnabled) return live;
  const t = today(req);
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const found = generateDayOrders(addDaysISO(t, -i), t).find((o) => o.id === id);
    if (found) return found;
  }
  return undefined;
}

const byPlacedAsc = (a: DraftOrder, b: DraftOrder) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const byPlacedDesc = (a: DraftOrder, b: DraftOrder) => byPlacedAsc(b, a);

// ── Lecturas ───────────────────────────────────────────────────────────────────────────────────

/** GET /v1/admin/orders/board?branchId&limit — tablero agregado (9 columnas en el orden del catálogo). */
export const getAdminOrderBoard: Handler = (req): AdminOrderBoard => {
  faultGuard(req);
  const actor = requireStaff(req, 'orders.read');
  const branchIds = requestedBranches(req, actor);
  const limitRaw = req.query.get('limit');
  const limit = limitRaw === null ? BOARD_ACTIVE_DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    problem(400, undefined, 'limit inválido');

  const at = now(req);
  const since = new Date(at.getTime() - TERMINAL_WINDOW_MS);
  const days = [localDate(since), localDate(at)];
  const all = universe(req, branchIds, days);
  const statusOf = (o: DraftOrder) => lifecycleOf(o.status, o.fulfillment);

  const columns: AdminOrderBoardColumn[] = STATUS_ORDER.map((status) => {
    const active = ACTIVE.includes(status);
    const mine = all
      .filter((o) => statusOf(o) === status)
      .filter((o) => active || Date.parse(o.createdAt) >= since.getTime());
    const sorted = [...mine].sort(active ? byPlacedAsc : byPlacedDesc);
    const cap = active ? limit : BOARD_TERMINAL_LIMIT;
    return {
      status,
      count: mine.length,
      hasMore: mine.length > cap,
      items: sorted.slice(0, cap).map((o) => summaryOf(req, actor, o)),
    };
  });

  const pending = all.filter((o) => statusOf(o) === 'pending').sort(byPlacedAsc);
  return {
    generatedAt: at.toISOString(),
    branchId: req.query.get('branchId'),
    terminalWindowHours: 24,
    pollAfterSeconds: POLL_AFTER_SECONDS,
    summary: {
      pending: pending.length,
      active: all.filter((o) => ACTIVE.includes(statusOf(o))).length,
      oldestPendingAt: pending[0]?.createdAt ?? null,
    },
    columns,
  };
};

const encodeCursor = (o: Pick<DraftOrder, 'createdAt' | 'id'>) =>
  btoa(`${o.createdAt}|${o.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function decodeCursor(raw: string): { placedAt: string; id: string } {
  try {
    const text = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const [placedAt, id] = text.split('|');
    if (placedAt && id && !Number.isNaN(Date.parse(placedAt))) return { placedAt, id };
  } catch {
    // formato inválido: se informa abajo
  }
  return problem(400, 'ORDER_CURSOR_INVALID', 'Cursor inválido');
}

function instant(raw: string | null, field: string): number | null {
  if (raw === null || raw === '') return null;
  if (!WITH_ZONE.test(raw) || Number.isNaN(Date.parse(raw))) {
    problem(400, undefined, `${field} debe ser un instante ISO 8601 con zona`);
  }
  return Date.parse(raw);
}

/** GET /v1/admin/orders — listado ligero por cursor (orden fijo `placedAt` desc, `id` desc). */
export const listAdminOrders: Handler = (req): AdminOrderPage => {
  faultGuard(req);
  const actor = requireStaff(req, 'orders.read');
  const branchIds = requestedBranches(req, actor);
  const at = now(req);

  const statusParam = req.query.get('status');
  const statuses = statusParam ? statusParam.split(',') : null;
  if (statuses?.some((s) => !(STATUS_ORDER as readonly string[]).includes(s))) {
    problem(400, undefined, 'status inválido');
  }
  const fulfillment = req.query.get('fulfillmentType');
  if (fulfillment && fulfillment !== 'PICKUP' && fulfillment !== 'DELIVERY') {
    problem(400, undefined, 'fulfillmentType inválido');
  }
  const q = req.query.get('q')?.trim() ?? '';
  if (q && (q.length < 2 || q.length > 40))
    problem(400, undefined, 'q debe tener 2 a 40 caracteres');
  const limitRaw = req.query.get('limit');
  const limit = limitRaw === null ? 25 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    problem(400, undefined, 'limit inválido');

  const toMs = instant(req.query.get('to'), 'to') ?? at.getTime();
  const fromMs = instant(req.query.get('from'), 'from') ?? at.getTime() - 7 * 86_400_000;
  if (toMs <= fromMs || toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
    problem(400, undefined, 'Rango de fechas inválido (máximo 92 días)');
  }
  const cursorRaw = req.query.get('cursor');
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;

  const days: string[] = [];
  for (
    let d = localDate(new Date(fromMs));
    d <= localDate(new Date(toMs)) && days.length < HISTORY_DAYS;
    d = addDaysISO(d, 1)
  ) {
    days.push(d);
  }

  const numeric = /^(?:MON-)?(\d+)$/i.exec(q);
  const needle = q.toLowerCase();
  const matches = universe(req, branchIds, days)
    .filter((o) => {
      const placed = Date.parse(o.createdAt);
      return placed >= fromMs && placed <= toMs;
    })
    .filter((o) => !statuses || statuses.includes(lifecycleOf(o.status, o.fulfillment)))
    .filter((o) => !fulfillment || (fulfillment === 'PICKUP') === (o.fulfillment === 'pickup'))
    .filter((o) => {
      if (!q) return true;
      if (numeric) return Number(numeric[1]) === Number(o.id.replace(/\D/g, ''));
      return o.customer.name.toLowerCase().includes(needle);
    })
    .sort(byPlacedDesc)
    .filter(
      (o) =>
        !cursor ||
        o.createdAt < cursor.placedAt ||
        (o.createdAt === cursor.placedAt && o.id < cursor.id),
    );

  const page = matches.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((o) => summaryOf(req, actor, o)),
    nextCursor: matches.length > limit && last ? encodeCursor(last) : null,
    generatedAt: at.toISOString(),
  };
};

/** Pedido legible por el actor (`orders.read` en su sucursal) o el MISMO 404 `ORDER_NOT_FOUND` (inexistente o ajeno). */
export function readableOrder(req: Req, actor: StaffActor): DraftOrder {
  const draft = findDraft(req, req.params.id ?? '');
  if (!draft || !can(actor.grants, 'orders.read', draft.branchId)) {
    problem(404, 'ORDER_NOT_FOUND', 'Pedido no disponible');
  }
  return draft;
}

/** GET /v1/admin/orders/:id — detalle con historial. */
export const getAdminOrder: Handler = (req): AdminOrderDetail => {
  faultGuard(req);
  const actor = requireStaff(req, 'orders.read');
  const draft = readableOrder(req, actor);
  return toAdminDetail(
    draft,
    req.store.branches,
    canFor(actor, draft.branchId),
    req.store,
    placedOf(req.store, draft.id),
  );
};

// ── Comandos ───────────────────────────────────────────────────────────────────────────────────

const VIOLATION_MESSAGE: Record<ViolationCode, string> = {
  ORDER_TERMINAL: 'El pedido ya terminó y no admite cambios',
  ORDER_FULFILLMENT_MISMATCH: 'Esa acción no corresponde a la modalidad del pedido',
  ORDER_SOURCE_INVALID: 'Esa acción no se puede hacer desde el estado indicado',
  ORDER_DISPATCH_NOT_AVAILABLE: 'El despacho aún no está disponible',
  ORDER_PROVIDER_BLOCKED_EXTERNAL: 'La integración con el proveedor está pendiente',
  ORDER_CANCEL_NOT_ALLOWED: 'No se puede cancelar un pedido que ya salió a entrega',
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function parseCommandBody(req: Req, command: AdminOrderCommand) {
  const spec = COMMAND_SPECS[command];
  const b = body<{ expectedStatus: unknown; reason: unknown }>(req);
  const allowed = spec.reason ? ['expectedStatus', 'reason'] : ['expectedStatus'];
  if (Object.keys(b).some((k) => !allowed.includes(k)))
    problem(400, undefined, 'Campos no permitidos');
  const expected = b.expectedStatus;
  if (typeof expected !== 'string' || !(STATUS_ORDER as readonly string[]).includes(expected)) {
    problem(400, undefined, 'expectedStatus inválido');
  }
  let reason: string | null = null;
  if (spec.reason) {
    const text = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (text.length < 3 || CONTROL.test(text)) {
      problem(400, 'ORDER_REASON_REQUIRED', 'Indica el motivo (mínimo 3 caracteres)');
    }
    if (text.length > 280) problem(400, undefined, 'El motivo supera 280 caracteres');
    reason = text;
  }
  return { expected: expected as OrderLifecycleStatus, reason };
}

const orderEvents = (draft: DraftOrder) => draft.history.filter((e) => e.kind === 'order');

function apply(
  req: Req,
  draft: DraftOrder,
  to: OrderLifecycleStatus,
  actor: StaffActor,
  reason: string | null,
  at: Date,
) {
  draft.status = draftStatusOf(to);
  if (to === 'rejected' || to === 'cancelled') draft.rejectionReason = reason;
  draft.history.push(event(at, 'order', draft.status, { reason, detail: actor.name }));
  // F24: pedido ≠ pagado. Ninguna transición marca `PAID`: solo `registerAdminOrderCashPayment` registra el efectivo.
  touch(draft, at);
  const placed = placedOf(req.store, draft.id);
  if (placed) {
    placed.detail.status = to;
    placed.detail.updatedAt = at.toISOString();
  }
}

function runCommand(req: Req, command: AdminOrderCommand): AdminOrderTransitionResult {
  faultGuard(req);
  const spec = COMMAND_SPECS[command];
  const actor = requireStaff(req, spec.permission);
  const { expected, reason } = parseCommandBody(req, command);
  const draft = readableOrder(req, actor);
  if (!can(actor.grants, spec.permission, draft.branchId)) {
    problem(403, 'ORDER_ACTION_FORBIDDEN', 'No tienes permiso para esta acción en esa sucursal');
  }
  const rule = ruleOrderOf(draft, placedOf(req.store, draft.id));
  const snapshot = () => ({ status: ruleOrderOf(draft).status, updatedAt: draft.updatedAt });

  const check = checkCommand(rule, command, expected);
  if (!check.ok) {
    problem(422, 'ORDER_TRANSITION_INVALID', 'Transición no permitida', {
      violations: [
        { path: 'expectedStatus', code: check.code, message: VIOLATION_MESSAGE[check.code] },
      ],
      current: snapshot(),
    });
  }

  const at = now(req);
  // Fallos de prueba: otra persona se adelantó (los comandos solo existen en `to`).
  if (req.fault === 'other-applied' && lifecycleOf(draft.status, draft.fulfillment) === expected) {
    apply(req, draft, spec.to, { ...actor, name: 'Otra persona' }, reason, at);
  }
  if (
    req.fault === 'other-rejected' &&
    expected === 'pending' &&
    lifecycleOf(draft.status, draft.fulfillment) === 'pending' &&
    spec.to !== 'rejected'
  ) {
    apply(
      req,
      draft,
      'rejected',
      { ...actor, name: 'Otra persona' },
      'Otra persona lo rechazó',
      at,
    );
  }

  const current = ruleOrderOf(draft).status;
  const pendingActions = pendingActionsFor(command, Boolean(paymentRecord(req.store, draft.id)));
  const result = (replayed: boolean, byMe: boolean, when: string): AdminOrderTransitionResult => ({
    order: summaryOf(req, actor, draft),
    transition: { from: expected, to: spec.to, at: when, replayed, appliedByMe: byMe },
    pendingActions,
  });

  if (current === expected) {
    apply(req, draft, spec.to, actor, reason, at);
    return result(false, true, at.toISOString());
  }
  // Repetición idempotente: ya está en el destino y el último evento es exactamente `expected → destino`.
  const events = orderEvents(draft);
  const last = events[events.length - 1];
  const before = events[events.length - 2];
  if (
    current === spec.to &&
    last &&
    before &&
    lifecycleOf(last.status as never, draft.fulfillment) === spec.to &&
    lifecycleOf(before.status as never, draft.fulfillment) === expected
  ) {
    return result(true, last.detail === actor.name, last.at);
  }
  return problem(409, 'ORDER_STATE_CONFLICT', 'El pedido cambió mientras lo veías', {
    current: snapshot(),
  });
}

export const acceptAdminOrder: Handler = (req) => runCommand(req, 'accept');
export const rejectAdminOrder: Handler = (req) => runCommand(req, 'reject');
export const startPreparingAdminOrder: Handler = (req) => runCommand(req, 'start-preparing');
export const markReadyAdminOrder: Handler = (req) => runCommand(req, 'mark-ready');
export const completeAdminOrder: Handler = (req) => runCommand(req, 'complete');
export const cancelAdminOrder: Handler = (req) => runCommand(req, 'cancel');
