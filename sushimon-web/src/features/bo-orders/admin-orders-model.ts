import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminOrderActionState,
  AdminOrderBoard,
  AdminOrderBoardColumn,
  AdminOrderPendingAction,
  AdminOrderSummary,
  OrderLifecycleStatus,
} from '@/lib/data-access/models';
import type { AdminOrderCommand } from '@/services/admin-orders';

/**
 * F22 (spec 023 §10) — Modelo de vista PURO de los pedidos del backoffice. La web NO duplica la matriz de transiciones ni los
 * permisos: las acciones salen de `availableActions` del servidor. Aquí solo se agrupan columnas, se interpretan acciones y
 * errores y se valida el motivo. Nada lee el reloj: el "ahora" se corrige con `generatedAt` del servidor.
 */

/** Catálogo cerrado de estados, en el orden del contrato. */
export const LIFECYCLE_STATUSES: readonly OrderLifecycleStatus[] = [
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

export const TERMINAL_STATUSES: readonly OrderLifecycleStatus[] = [
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];

export const isLifecycleStatus = (value: unknown): value is OrderLifecycleStatus =>
  typeof value === 'string' && (LIFECYCLE_STATUSES as readonly string[]).includes(value);

export const isTerminalStatus = (status: OrderLifecycleStatus) =>
  TERMINAL_STATUSES.includes(status);

// ── Columnas del tablero (agrupadas como el prototipo) ──────────────────────────────────────────

export type BoardGroupKey =
  'nuevo' | 'aceptado' | 'preparacion' | 'listo' | 'en_camino' | 'finalizados';

export const BOARD_GROUPS: readonly {
  key: BoardGroupKey;
  statuses: readonly OrderLifecycleStatus[];
}[] = [
  { key: 'nuevo', statuses: ['pending'] },
  { key: 'aceptado', statuses: ['accepted'] },
  { key: 'preparacion', statuses: ['preparing'] },
  { key: 'listo', statuses: ['ready'] },
  { key: 'en_camino', statuses: ['on_the_way'] },
  { key: 'finalizados', statuses: ['delivered', 'picked_up', 'rejected', 'cancelled'] },
];

export interface BoardGroup {
  key: BoardGroupKey;
  statuses: readonly OrderLifecycleStatus[];
  /** Conteo REAL del servidor (suma de las columnas del grupo). */
  count: number;
  hasMore: boolean;
  items: AdminOrderSummary[];
}

/** Agrupa las 9 columnas del servidor en las 6 del prototipo. El orden de cada columna lo decide el servidor. */
export function groupBoard(board: Pick<AdminOrderBoard, 'columns'>): BoardGroup[] {
  const byStatus = new Map<OrderLifecycleStatus, AdminOrderBoardColumn>(
    board.columns.map((c) => [c.status, c]),
  );
  return BOARD_GROUPS.map(({ key, statuses }) => {
    const columns = statuses
      .map((s) => byStatus.get(s))
      .filter((c): c is AdminOrderBoardColumn => c !== undefined);
    const items =
      columns.length > 1
        ? columns.flatMap((c) => c.items).sort((a, b) => b.placedAt.localeCompare(a.placedAt))
        : (columns[0]?.items ?? []);
    return {
      key,
      statuses,
      count: columns.reduce((sum, c) => sum + c.count, 0),
      hasMore: columns.some((c) => c.hasMore),
      items,
    };
  });
}

/** Estados que filtran la tabla al elegir «Ver todos» de una columna del tablero. */
export function statusesOfGroup(key: BoardGroupKey): readonly OrderLifecycleStatus[] {
  return BOARD_GROUPS.find((g) => g.key === key)?.statuses ?? [];
}

// ── Acciones (salen de `availableActions` del servidor) ─────────────────────────────────────────

export const ACTION_COMMAND: Partial<Record<AdminOrderActionState['action'], AdminOrderCommand>> = {
  accept: 'accept',
  reject: 'reject',
  start_preparing: 'start-preparing',
  mark_ready: 'mark-ready',
  complete: 'complete',
  cancel: 'cancel',
};

/** Acciones de avance (el botón principal de la tarjeta, por orden de prioridad). */
const PRIMARY_ORDER: readonly AdminOrderActionState['action'][] = [
  'accept',
  'start_preparing',
  'mark_ready',
  'complete',
];

/** Acciones que la persona PUEDE ver: las `NO_PERMISSION` se ocultan; las demás deshabilitadas se muestran con su motivo. */
export function visibleActions(order: Pick<AdminOrderSummary, 'availableActions'>) {
  return order.availableActions.filter((a) => a.disabledReason !== 'NO_PERMISSION');
}

export function findAction(
  order: Pick<AdminOrderSummary, 'availableActions'>,
  action: AdminOrderActionState['action'],
): AdminOrderActionState | undefined {
  return visibleActions(order).find((a) => a.action === action);
}

/** Botón principal de la tarjeta: la primera acción de avance HABILITADA, si existe. */
export function primaryAction(
  order: Pick<AdminOrderSummary, 'availableActions'>,
): AdminOrderActionState['action'] | null {
  for (const action of PRIMARY_ORDER) {
    if (findAction(order, action)?.enabled) return action;
  }
  return null;
}

/** Acciones destructivas (con motivo) habilitadas: rechazar y cancelar. */
export function reasonActions(order: Pick<AdminOrderSummary, 'availableActions'>) {
  return (['reject', 'cancel'] as const).filter((a) => findAction(order, a)?.enabled);
}

/**
 * Estado informado de `dispatch` DESHABILITADA (motivo honesto) o `null` si no aplica o está HABILITADA (F28: entrega propia con
 * `deliveries.assign`; entonces se muestra el botón que abre Entregas, ver `dispatchEnabled`).
 */
export function dispatchInfo(
  order: Pick<AdminOrderSummary, 'availableActions'>,
): 'DISPATCH_NOT_AVAILABLE' | 'PROVIDER_BLOCKED_EXTERNAL' | null {
  const action = findAction(order, 'dispatch');
  if (!action || action.enabled) return null;
  return action.disabledReason === 'PROVIDER_BLOCKED_EXTERNAL'
    ? 'PROVIDER_BLOCKED_EXTERNAL'
    : 'DISPATCH_NOT_AVAILABLE';
}

/** ¿Ofrece el servidor `dispatch` habilitada (reparto propio con permiso)? La web solo abre Entregas: el servidor decide el resto. */
export const dispatchEnabled = (order: Pick<AdminOrderSummary, 'availableActions'>): boolean =>
  findAction(order, 'dispatch')?.enabled === true;

// ── Motivo (reject/cancel) ──────────────────────────────────────────────────────────────────────

export const REASON_MIN = 3;
export const REASON_MAX = 280;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export type ReasonProblem = 'required' | 'short' | 'long' | 'control';

/** Valida el motivo ya RECORTADO: 3..280 caracteres, sin caracteres de control. `null` = válido. */
export function validateReason(raw: string): ReasonProblem | null {
  const text = raw.trim();
  if (text.length === 0) return 'required';
  if (CONTROL_CHARS.test(text)) return 'control';
  if (text.length < REASON_MIN) return 'short';
  if (text.length > REASON_MAX) return 'long';
  return null;
}

// ── Reloj corregido con el servidor ─────────────────────────────────────────────────────────────

/** «Ahora» del servidor: `generatedAt` + lo transcurrido desde que se recibió (nunca el reloj del cliente sin corrección). */
export function serverNowMs(generatedAt: string, receivedAtMs: number, nowMs: number): number {
  const base = Date.parse(generatedAt);
  return base + Math.max(0, nowMs - receivedAtMs);
}

export function minutesSincePlaced(placedAt: string, serverNow: number): number {
  return Math.max(0, Math.floor((serverNow - Date.parse(placedAt)) / 60_000));
}

/** Pedido `pending` sin atender hace más de 5 minutos. */
export const LATE_MINUTES = 5;
export const isLatePending = (order: Pick<AdminOrderSummary, 'status' | 'placedAt'>, now: number) =>
  order.status === 'pending' && minutesSincePlaced(order.placedAt, now) > LATE_MINUTES;

// ── Resultados y errores de los comandos ────────────────────────────────────────────────────────

export type CommandErrorKind =
  | 'conflict'
  | 'invalid'
  | 'forbidden'
  | 'mfa'
  | 'notFound'
  | 'reason'
  | 'rate'
  | 'busy'
  | 'auth'
  | 'network'
  | 'unknown';

export interface CommandError {
  kind: CommandErrorKind;
  /** `ErrorResponse.code` (p. ej. `ORDER_STATE_CONFLICT`). */
  code: string | null;
  /** `violations[0].code` en un 422. */
  violation: string | null;
  /** Estado ACTUAL que informa el servidor en 409/422 (`current.status`). */
  currentStatus: OrderLifecycleStatus | null;
  retryAfterSec: number | null;
  message: string;
}

function readCurrent(body: unknown): OrderLifecycleStatus | null {
  if (!body || typeof body !== 'object') return null;
  const current = (body as { current?: unknown }).current;
  if (!current || typeof current !== 'object') return null;
  const status = (current as { status?: unknown }).status;
  return isLifecycleStatus(status) ? status : null;
}

/** Clasifica un error de la capa de datos SIN convertir un fallo de red en un estado de negocio. */
export function classifyCommandError(error: unknown): CommandError {
  if (!isApiError(error)) {
    return {
      kind: 'unknown',
      code: null,
      violation: null,
      currentStatus: null,
      retryAfterSec: null,
      message: error instanceof Error ? error.message : '',
    };
  }
  const code = error.businessCode ?? null;
  const base = {
    code,
    violation: error.violations?.[0]?.code ?? null,
    currentStatus: readCurrent(error.body),
    retryAfterSec: error.retryAfterSec ?? null,
    message: error.message,
  };
  const { status } = error;
  let kind: CommandErrorKind = 'unknown';
  if (status === 0 || (status >= 500 && code !== 'ORDERS_BUSY')) kind = 'network';
  else if (status === 503) kind = 'busy';
  else if (status === 429) kind = 'rate';
  else if (status === 401) kind = 'auth';
  else if (status === 403) kind = code === 'MFA_REQUIRED' ? 'mfa' : 'forbidden';
  else if (status === 404) kind = 'notFound';
  else if (status === 409) kind = 'conflict';
  else if (status === 422) kind = 'invalid';
  else if (status === 400) kind = code === 'ORDER_REASON_REQUIRED' ? 'reason' : 'unknown';
  return { kind, ...base };
}

export type CommandOutcome =
  | { kind: 'done'; to: OrderLifecycleStatus; pending: AdminOrderPendingAction[] }
  | {
      kind: 'replayed';
      to: OrderLifecycleStatus;
      byMe: boolean;
      pending: AdminOrderPendingAction[];
    };

export function outcomeOf(result: {
  transition: { to: OrderLifecycleStatus; replayed: boolean; appliedByMe: boolean };
  pendingActions: AdminOrderPendingAction[];
}): CommandOutcome {
  const { transition, pendingActions } = result;
  return transition.replayed
    ? { kind: 'replayed', to: transition.to, byMe: transition.appliedByMe, pending: pendingActions }
    : { kind: 'done', to: transition.to, pending: pendingActions };
}

// ── Avance del pedido (barra del detalle) ───────────────────────────────────────────────────────

export type StepState = 'done' | 'cur' | '';

/** Secuencia de la barra de avance (el retiro en tienda omite «En camino»). Rechazado/cancelado no tienen barra. */
export function progressSteps(
  order: Pick<AdminOrderSummary, 'status' | 'fulfillmentType'>,
): { status: OrderLifecycleStatus; state: StepState }[] {
  if (order.status === 'rejected' || order.status === 'cancelled') return [];
  const sequence: OrderLifecycleStatus[] =
    order.fulfillmentType === 'PICKUP'
      ? ['pending', 'accepted', 'preparing', 'ready', 'picked_up']
      : ['pending', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered'];
  const current = sequence.indexOf(order.status);
  const last = sequence.length - 1;
  return sequence.map((status, i) => ({
    status,
    state: i < current || (i === current && i === last) ? 'done' : i === current ? 'cur' : '',
  }));
}
