import type { PillTone } from '@/components/ui/Pill';
import { isApiError } from '@/lib/data-access/errors';
import type {
  AdminDeliveryAction,
  AdminDeliveryActionState,
  AdminDeliveryEvent,
  AdminDeliveryStatus,
  AdminDeliverySummary,
  AdminRiderSummary,
  OrderLifecycleStatus,
} from '@/lib/data-access/models';
import type { AdminDeliveryFilters } from '@/services/admin-deliveries';

/**
 * Entregas PROPIAS (UI) — F28 (spec 029 §13). Lógica pura de filtros, acciones visibles, errores y conflictos. La web NO decide
 * transiciones ni permisos: solo muestra u oculta lo que el servidor informa (`availableActions`, `contactVisible`); la validación
 * definitiva es del servidor (403/404/409/422). Nada de esto toca `localStorage` ni la URL (el contacto es PII).
 */

export const DELIVERY_PAGE_SIZE = 25;
/** Máximo de motoristas que se piden para el selector de asignación (el contrato admite `pageSize` ≤ 100). */
export const ELIGIBLE_RIDERS_LIMIT = 100;
export const MAX_BUSY_RETRIES = 2;
export const DELIVERY_REASON_MIN = 3;
export const DELIVERY_REASON_MAX = 280;

// ── Filtros ───────────────────────────────────────────────────────────────────────────────

/** `open` = el valor por defecto del servidor (pendiente, asignada, recogida y entregada sin retorno). */
export type DeliveryStatusFilter = 'open' | AdminDeliveryStatus;

export interface DeliveryListState {
  /** '' = todas las sucursales autorizadas. */
  branchId: string;
  status: DeliveryStatusFilter;
  /** '' = todos los motoristas. */
  riderId: string;
}

export const DEFAULT_DELIVERY_LIST: DeliveryListState = {
  branchId: '',
  status: 'open',
  riderId: '',
};

export const STATUS_FILTER_OPTIONS: readonly DeliveryStatusFilter[] = [
  'open',
  'pending',
  'assigned',
  'picked_up',
  'delivered',
  'returned',
  'cancelled',
];

export function toDeliveryFilters(state: DeliveryListState): AdminDeliveryFilters {
  return {
    branchId: state.branchId || undefined,
    // Sin `status` el servidor devuelve los ABIERTOS (por defecto, sin ventana de fechas).
    status: state.status === 'open' ? undefined : [state.status],
    riderId: state.riderId || undefined,
    limit: DELIVERY_PAGE_SIZE,
  };
}

export const hasDeliveryFilters = (state: DeliveryListState): boolean =>
  state.branchId !== '' || state.status !== 'open' || state.riderId !== '';

// ── Presentación ──────────────────────────────────────────────────────────────────────────

export const DELIVERY_STATUS_TONE: Record<AdminDeliveryStatus, PillTone> = {
  pending: 'warning',
  assigned: 'info',
  picked_up: 'active',
  delivered: 'success',
  returned: 'muted',
  cancelled: 'muted',
};

/** Tolera estados futuros del contrato («los clientes deben tolerar valores futuros»). */
export const KNOWN_STATUSES: readonly string[] = [
  'pending',
  'assigned',
  'picked_up',
  'delivered',
  'returned',
  'cancelled',
];
export const isKnownStatus = (value: string): value is AdminDeliveryStatus =>
  KNOWN_STATUSES.includes(value);

export const KNOWN_EVENTS: readonly string[] = [
  'created',
  'reopened',
  'rider_assigned',
  'rider_reassigned',
  'rider_unassigned',
  'picked_up',
  'delivered',
  'returned',
  'cancelled',
];
export const isKnownEvent = (value: string): value is AdminDeliveryEvent =>
  KNOWN_EVENTS.includes(value);

export const KNOWN_ACTIONS: readonly string[] = [
  'assign_rider',
  'reassign_rider',
  'unassign_rider',
  'mark_picked_up',
  'mark_delivered',
  'return_to_branch',
  'cancel',
];

export const ORDER_STATUSES: readonly OrderLifecycleStatus[] = [
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
export const isOrderStatus = (value: unknown): value is OrderLifecycleStatus =>
  typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);

// ── Acciones (las decide el servidor; la web solo oculta) ─────────────────────────────────

/** Acciones que la persona PUEDE ver: las `NO_PERMISSION` se ocultan; las demás deshabilitadas se muestran con su motivo. */
export function visibleActions(
  delivery: Pick<AdminDeliverySummary, 'availableActions'>,
): AdminDeliveryActionState[] {
  return delivery.availableActions.filter(
    (a) => a.disabledReason !== 'NO_PERMISSION' && KNOWN_ACTIONS.includes(a.action),
  );
}

export function findAction(
  delivery: Pick<AdminDeliverySummary, 'availableActions'>,
  action: AdminDeliveryAction,
): AdminDeliveryActionState | undefined {
  return visibleActions(delivery).find((a) => a.action === action);
}

/** ¿Ofrece el servidor la acción (existe para esta persona y estado) y está habilitada? */
export const actionEnabled = (
  delivery: Pick<AdminDeliverySummary, 'availableActions'>,
  action: AdminDeliveryAction,
): boolean => findAction(delivery, action)?.enabled === true;

/** La primera acción de asignación disponible (`assign_rider` o `reassign_rider`) o `null`. */
export function assignAction(
  delivery: Pick<AdminDeliverySummary, 'availableActions'>,
): 'assign_rider' | 'reassign_rider' | null {
  if (actionEnabled(delivery, 'assign_rider')) return 'assign_rider';
  if (actionEnabled(delivery, 'reassign_rider')) return 'reassign_rider';
  return null;
}

// ── Motoristas elegibles (cosmético: el servidor revalida con 422 `RIDER_NOT_ELIGIBLE`) ───

/**
 * Motoristas que se OFRECEN en el selector: de la sucursal de la entrega, activos, marcados disponibles y sin otra entrega
 * (`busy` derivado por el servidor). El motorista actual no se ofrece al reasignar. La elegibilidad real la decide el servidor.
 */
export function eligibleRiders(
  riders: readonly AdminRiderSummary[],
  branchId: string,
  currentRiderId: string | null,
): AdminRiderSummary[] {
  return riders.filter(
    (r) =>
      r.branchId === branchId &&
      r.active &&
      r.availability === 'AVAILABLE' &&
      !r.busy &&
      r.id !== currentRiderId,
  );
}

// ── Motivo (cancelar / desasignar) ────────────────────────────────────────────────────────

const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
export type ReasonProblem = 'required' | 'short' | 'long' | 'control';

/** Valida el motivo ya RECORTADO (3–280 sin caracteres de control). `required=false` acepta vacío (desasignar). */
export function validateDeliveryReason(raw: string, required: boolean): ReasonProblem | null {
  const text = raw.trim();
  if (text.length === 0) return required ? 'required' : null;
  if (CONTROL_CHARS.test(text)) return 'control';
  if (text.length < DELIVERY_REASON_MIN) return 'short';
  if (text.length > DELIVERY_REASON_MAX) return 'long';
  return null;
}

// ── Errores y conflictos ──────────────────────────────────────────────────────────────────

export type DeliveryErrorKind =
  | 'stateConflict'
  | 'orderConflict'
  | 'hasActiveDelivery'
  | 'riderNotEligible'
  | 'orderNotEligible'
  | 'reasonRequired'
  | 'cursorInvalid'
  | 'actionForbidden'
  | 'forbidden'
  | 'mfa'
  | 'auth'
  | 'deliveryNotFound'
  | 'riderNotFound'
  | 'orderNotFound'
  | 'notFound'
  | 'rate'
  | 'busy'
  | 'network'
  | 'invalid'
  | 'unknown';

export const RIDER_REASONS = [
  'INACTIVE',
  'WRONG_BRANCH',
  'UNAVAILABLE',
  'BUSY',
  'OWN_DELIVERY_DISABLED',
] as const;
export type RiderReason = (typeof RIDER_REASONS)[number];
export const ORDER_REASONS = [
  'ORDER_STATUS_NOT_DISPATCHABLE',
  'ORDER_NOT_DELIVERY',
  'ORDER_PROVIDER_NOT_OWN',
] as const;
export type OrderReason = (typeof ORDER_REASONS)[number];

export interface DeliveryError {
  kind: DeliveryErrorKind;
  code: string | null;
  /** `violations[].code` de un 422 (motivos de no elegibilidad). */
  violations: string[];
  /** Estado ACTUAL de la entrega que informa un 409 `DELIVERY_STATE_CONFLICT`. */
  current: { status: AdminDeliveryStatus; version: number } | null;
  /** Estado ACTUAL del pedido que informa un 409 `ORDER_STATE_CONFLICT` / `ORDER_HAS_ACTIVE_DELIVERY`. */
  currentOrder: OrderLifecycleStatus | null;
  retryAfterSec: number | null;
}

function readCurrent(body: unknown): {
  delivery: DeliveryError['current'];
  order: OrderLifecycleStatus | null;
} {
  const current = (body as { current?: unknown } | undefined)?.current;
  if (!current || typeof current !== 'object') return { delivery: null, order: null };
  const { status, version } = current as { status?: unknown; version?: unknown };
  if (typeof status === 'string' && typeof version === 'number' && isKnownStatus(status)) {
    return { delivery: { status, version }, order: null };
  }
  return { delivery: null, order: isOrderStatus(status) ? status : null };
}

/** Clasifica un error de la capa de datos SIN convertir un fallo de red en un estado de negocio. Ramifica por `code`, no por `message`. */
export function classifyDeliveryError(error: unknown): DeliveryError {
  const base: DeliveryError = {
    kind: 'unknown',
    code: null,
    violations: [],
    current: null,
    currentOrder: null,
    retryAfterSec: null,
  };
  if (!isApiError(error)) return base;
  const code = error.businessCode ?? null;
  const read = readCurrent(error.body);
  const result: DeliveryError = {
    ...base,
    code,
    violations: (error.violations ?? []).map((v) => v.code),
    current: read.delivery,
    currentOrder: read.order,
    retryAfterSec: error.retryAfterSec ?? null,
  };
  const { status } = error;
  if (status === 0 || (status >= 500 && status !== 503)) return { ...result, kind: 'network' };
  if (status === 503) return { ...result, kind: 'busy' };
  if (status === 429) return { ...result, kind: 'rate' };
  if (status === 401) return { ...result, kind: 'auth' };
  if (status === 403) {
    return {
      ...result,
      kind:
        code === 'MFA_REQUIRED'
          ? 'mfa'
          : code === 'DELIVERY_ACTION_FORBIDDEN'
            ? 'actionForbidden'
            : 'forbidden',
    };
  }
  if (status === 404) {
    const kind: DeliveryErrorKind =
      code === 'DELIVERY_NOT_FOUND'
        ? 'deliveryNotFound'
        : code === 'RIDER_NOT_FOUND'
          ? 'riderNotFound'
          : code === 'ORDER_NOT_FOUND'
            ? 'orderNotFound'
            : 'notFound';
    return { ...result, kind };
  }
  if (status === 409) {
    const kind: DeliveryErrorKind =
      code === 'DELIVERY_STATE_CONFLICT'
        ? 'stateConflict'
        : code === 'ORDER_STATE_CONFLICT'
          ? 'orderConflict'
          : code === 'ORDER_HAS_ACTIVE_DELIVERY'
            ? 'hasActiveDelivery'
            : 'unknown';
    return { ...result, kind };
  }
  if (status === 422) {
    const kind: DeliveryErrorKind =
      code === 'RIDER_NOT_ELIGIBLE'
        ? 'riderNotEligible'
        : code === 'DELIVERY_ORDER_NOT_ELIGIBLE'
          ? 'orderNotEligible'
          : 'invalid';
    return { ...result, kind };
  }
  if (status === 400) {
    return {
      ...result,
      kind:
        code === 'DELIVERY_REASON_REQUIRED'
          ? 'reasonRequired'
          : code === 'DELIVERY_CURSOR_INVALID'
            ? 'cursorInvalid'
            : 'invalid',
    };
  }
  return result;
}

/** Errores tras los cuales la vista ya está desactualizada: se aplica `current` (si viene) y se refresca. */
export const isStaleError = (kind: DeliveryErrorKind): boolean =>
  kind === 'stateConflict' ||
  kind === 'orderConflict' ||
  kind === 'hasActiveDelivery' ||
  kind === 'deliveryNotFound';

/** ¿Merece un reintento automático acotado? Solo el 503 `DELIVERIES_BUSY` (la solicitud ni se procesó) y solo en LECTURAS. */
export const isDeliveriesBusy = (error: unknown): boolean =>
  isApiError(error) &&
  error.status === 503 &&
  (error.businessCode ?? 'DELIVERIES_BUSY') === 'DELIVERIES_BUSY';

/** Espera (ms) entre reintentos de `DELIVERIES_BUSY`: respeta `Retry-After`, acotada a 1–3 s. */
export const busyDelayMs = (error: unknown): number => {
  const sec = isApiError(error) ? (error.retryAfterSec ?? 1) : 1;
  return Math.min(3, Math.max(1, sec)) * 1000;
};

/**
 * Aplica el estado ACTUAL que informó un 409 (`current`) sobre una vista (resumen o detalle) para que la persona vea el estado real
 * y el `expectedVersion` correcto mientras llega la relectura. Devuelve la MISMA referencia si no hay nada que aplicar.
 */
export function applyCurrent<T extends Pick<AdminDeliverySummary, 'status' | 'version'>>(
  view: T,
  current: DeliveryError['current'],
): T {
  if (!current) return view;
  if (view.status === current.status && view.version === current.version) return view;
  return { ...view, status: current.status, version: current.version };
}

// ── Resultado de un comando ───────────────────────────────────────────────────────────────

export type DeliveryOutcome =
  | { kind: 'done'; event: AdminDeliveryEvent; status: AdminDeliveryStatus }
  | { kind: 'replayed'; event: AdminDeliveryEvent; status: AdminDeliveryStatus; byMe: boolean };

export function outcomeOf(result: {
  transition: {
    to: AdminDeliveryStatus;
    event: AdminDeliveryEvent;
    replayed: boolean;
    appliedByMe: boolean;
  };
}): DeliveryOutcome {
  const { transition } = result;
  return transition.replayed
    ? {
        kind: 'replayed',
        event: transition.event,
        status: transition.to,
        byMe: transition.appliedByMe,
      }
    : { kind: 'done', event: transition.event, status: transition.to };
}
