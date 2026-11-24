import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type {
  AdminDeliveryActionState,
  AdminDeliveryStatus,
  AdminRiderSummary,
} from '@/lib/data-access/models';
import {
  DEFAULT_DELIVERY_LIST,
  DELIVERY_PAGE_SIZE,
  actionEnabled,
  applyCurrent,
  assignAction,
  busyDelayMs,
  classifyDeliveryError,
  eligibleRiders,
  findAction,
  hasDeliveryFilters,
  isDeliveriesBusy,
  isStaleError,
  outcomeOf,
  toDeliveryFilters,
  validateDeliveryReason,
  visibleActions,
} from './delivery-model';

/** F28 (spec 029 §13, W01–W04): lógica pura de filtros, acciones visibles, elegibles, motivo y conflictos. */

const act = (
  action: AdminDeliveryActionState['action'],
  enabled = true,
  disabledReason: AdminDeliveryActionState['disabledReason'] = null,
): AdminDeliveryActionState => ({ action, enabled, disabledReason });
const view = (...availableActions: AdminDeliveryActionState[]) => ({ availableActions });

const apiError = (
  status: number,
  businessCode?: string,
  extra: {
    body?: unknown;
    violations?: { path: string; code: string; message: string }[];
    retry?: number;
  } = {},
) =>
  new ApiError(
    status,
    'x',
    'mensaje que NO se usa para ramificar',
    undefined,
    undefined,
    businessCode,
    extra.violations,
    extra.retry,
    extra.body,
  );

describe('filtros', () => {
  it('por defecto: abiertas (sin status), sin sucursal ni motorista y página de 25', () => {
    expect(toDeliveryFilters(DEFAULT_DELIVERY_LIST)).toEqual({
      branchId: undefined,
      status: undefined,
      riderId: undefined,
      limit: DELIVERY_PAGE_SIZE,
    });
    expect(hasDeliveryFilters(DEFAULT_DELIVERY_LIST)).toBe(false);
  });

  it('un estado concreto se envía como lista; «Esperando retorno» es delivered', () => {
    const f = toDeliveryFilters({
      branchId: 'sucursal-1',
      status: 'delivered',
      riderId: 'rider-1',
    });
    expect(f).toMatchObject({ branchId: 'sucursal-1', status: ['delivered'], riderId: 'rider-1' });
    expect(hasDeliveryFilters({ ...DEFAULT_DELIVERY_LIST, status: 'returned' })).toBe(true);
  });
});

describe('acciones (las decide el servidor; la web solo oculta)', () => {
  it('NO_PERMISSION se oculta; ORDER_NOT_READY se muestra deshabilitada con su motivo', () => {
    const d = view(
      act('reassign_rider'),
      act('unassign_rider', false, 'NO_PERMISSION'),
      act('mark_picked_up', false, 'ORDER_NOT_READY'),
      act('cancel'),
    );
    expect(visibleActions(d).map((a) => a.action)).toEqual([
      'reassign_rider',
      'mark_picked_up',
      'cancel',
    ]);
    expect(findAction(d, 'unassign_rider')).toBeUndefined();
    expect(actionEnabled(d, 'mark_picked_up')).toBe(false);
    expect(findAction(d, 'mark_picked_up')?.disabledReason).toBe('ORDER_NOT_READY');
    expect(actionEnabled(d, 'cancel')).toBe(true);
  });

  it('asignar vs. reasignar: según lo que el servidor ofrece; ninguna si no hay permiso', () => {
    expect(assignAction(view(act('assign_rider'), act('cancel')))).toBe('assign_rider');
    expect(assignAction(view(act('reassign_rider')))).toBe('reassign_rider');
    expect(assignAction(view(act('assign_rider', false, 'NO_PERMISSION')))).toBeNull();
    expect(assignAction(view())).toBeNull();
  });

  it('ignora acciones futuras que la web no conoce', () => {
    const d = view(act('cancel'), {
      action: 'teleport' as never,
      enabled: true,
      disabledReason: null,
    });
    expect(visibleActions(d).map((a) => a.action)).toEqual(['cancel']);
  });
});

describe('motoristas elegibles del selector (cosmético)', () => {
  const rider = (over: Partial<AdminRiderSummary>): AdminRiderSummary => ({
    id: 'r',
    branchId: 'b1',
    branchName: 'B1',
    fullName: 'X',
    phoneMasked: '+502****1111',
    vehicleType: null,
    active: true,
    availability: 'AVAILABLE',
    busy: false,
    busyKnown: true,
    operationalState: 'AVAILABLE',
    version: 1,
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  it('solo activos, disponibles, sin otra entrega, de la sucursal y distintos del actual', () => {
    const riders = [
      rider({ id: 'ok' }),
      rider({ id: 'inactive', active: false }),
      rider({ id: 'off', availability: 'UNAVAILABLE' }),
      rider({ id: 'busy', busy: true, operationalState: 'BUSY' }),
      rider({ id: 'other', branchId: 'b2' }),
      rider({ id: 'current' }),
    ];
    expect(eligibleRiders(riders, 'b1', 'current').map((r) => r.id)).toEqual(['ok']);
  });
});

describe('motivo (cancelar / quitar)', () => {
  it('cancelar exige 3–280 sin caracteres de control; quitar acepta vacío', () => {
    expect(validateDeliveryReason('', true)).toBe('required');
    expect(validateDeliveryReason('   ', true)).toBe('required');
    expect(validateDeliveryReason('ab', true)).toBe('short');
    expect(validateDeliveryReason('x'.repeat(281), true)).toBe('long');
    expect(validateDeliveryReason('hola\u0007', true)).toBe('control');
    expect(validateDeliveryReason('hola​', true)).toBe('control'); // formato: ancho cero
    expect(validateDeliveryReason('  Cliente ausente  ', true)).toBeNull();
    expect(validateDeliveryReason('', false)).toBeNull();
    expect(validateDeliveryReason('ab', false)).toBe('short');
  });
});

describe('classifyDeliveryError (ramifica por code, nunca por message)', () => {
  it('409 DELIVERY_STATE_CONFLICT con current de la entrega', () => {
    const e = classifyDeliveryError(
      apiError(409, 'DELIVERY_STATE_CONFLICT', {
        body: { current: { status: 'assigned', version: 3 } },
      }),
    );
    expect(e).toMatchObject({
      kind: 'stateConflict',
      current: { status: 'assigned', version: 3 },
      currentOrder: null,
    });
    expect(isStaleError(e.kind)).toBe(true);
  });

  it('409 ORDER_STATE_CONFLICT y ORDER_HAS_ACTIVE_DELIVERY con current del PEDIDO', () => {
    const body = { current: { status: 'preparing', updatedAt: '2026-11-11T20:00:00Z' } };
    expect(classifyDeliveryError(apiError(409, 'ORDER_STATE_CONFLICT', { body }))).toMatchObject({
      kind: 'orderConflict',
      currentOrder: 'preparing',
      current: null,
    });
    expect(
      classifyDeliveryError(apiError(409, 'ORDER_HAS_ACTIVE_DELIVERY', { body })),
    ).toMatchObject({
      kind: 'hasActiveDelivery',
      currentOrder: 'preparing',
    });
  });

  it('422 RIDER_NOT_ELIGIBLE y DELIVERY_ORDER_NOT_ELIGIBLE traen las razones (violations)', () => {
    const v = (code: string) => ({ path: 'riderId', code, message: 'x' });
    expect(
      classifyDeliveryError(
        apiError(422, 'RIDER_NOT_ELIGIBLE', { violations: [v('BUSY'), v('UNAVAILABLE')] }),
      ),
    ).toMatchObject({ kind: 'riderNotEligible', violations: ['BUSY', 'UNAVAILABLE'] });
    expect(
      classifyDeliveryError(
        apiError(422, 'DELIVERY_ORDER_NOT_ELIGIBLE', { violations: [v('ORDER_NOT_DELIVERY')] }),
      ).kind,
    ).toBe('orderNotEligible');
  });

  it('403/404/400/429/503/red por código y estado', () => {
    const kind = (e: unknown) => classifyDeliveryError(e).kind;
    expect(kind(apiError(403, 'MFA_REQUIRED'))).toBe('mfa');
    expect(kind(apiError(403, 'DELIVERY_ACTION_FORBIDDEN'))).toBe('actionForbidden');
    expect(kind(apiError(403))).toBe('forbidden');
    expect(kind(apiError(401))).toBe('auth');
    expect(kind(apiError(404, 'DELIVERY_NOT_FOUND'))).toBe('deliveryNotFound');
    expect(kind(apiError(404, 'RIDER_NOT_FOUND'))).toBe('riderNotFound');
    expect(kind(apiError(404, 'ORDER_NOT_FOUND'))).toBe('orderNotFound');
    expect(kind(apiError(400, 'DELIVERY_REASON_REQUIRED'))).toBe('reasonRequired');
    expect(kind(apiError(400, 'DELIVERY_CURSOR_INVALID'))).toBe('cursorInvalid');
    expect(kind(apiError(400))).toBe('invalid');
    expect(kind(apiError(429, 'RATE_LIMITED', { retry: 7 }))).toBe('rate');
    expect(classifyDeliveryError(apiError(429, 'RATE_LIMITED', { retry: 7 })).retryAfterSec).toBe(
      7,
    );
    expect(kind(apiError(503, 'DELIVERIES_BUSY'))).toBe('busy');
    expect(kind(apiError(0))).toBe('network');
    expect(kind(apiError(500))).toBe('network');
    expect(kind(new Error('boom'))).toBe('unknown');
  });

  it('un fallo de red NO se convierte en un estado de negocio', () => {
    const e = classifyDeliveryError(apiError(0));
    expect(e.current).toBeNull();
    expect(e.currentOrder).toBeNull();
    expect(isStaleError(e.kind)).toBe(false);
  });

  it('reintento automático solo del 503 DELIVERIES_BUSY, acotado a 1–3 s', () => {
    expect(isDeliveriesBusy(apiError(503, 'DELIVERIES_BUSY'))).toBe(true);
    expect(isDeliveriesBusy(apiError(503, 'OTRA'))).toBe(false);
    expect(isDeliveriesBusy(apiError(409, 'DELIVERY_STATE_CONFLICT'))).toBe(false);
    expect(busyDelayMs(apiError(503, 'DELIVERIES_BUSY', { retry: 0 }))).toBe(1000);
    expect(busyDelayMs(apiError(503, 'DELIVERIES_BUSY', { retry: 2 }))).toBe(2000);
    expect(busyDelayMs(apiError(503, 'DELIVERIES_BUSY', { retry: 60 }))).toBe(3000);
  });
});

describe('applyCurrent y outcomeOf', () => {
  const base = { status: 'pending' as AdminDeliveryStatus, version: 1, id: 'd' };

  it('aplica el estado y la versión actuales; sin cambio devuelve la MISMA referencia', () => {
    expect(applyCurrent(base, { status: 'assigned', version: 3 })).toEqual({
      ...base,
      status: 'assigned',
      version: 3,
    });
    expect(applyCurrent(base, { status: 'pending', version: 1 })).toBe(base);
    expect(applyCurrent(base, null)).toBe(base);
  });

  it('replayed ⇒ «ya estaba hecho» (con quién lo aplicó); si no, hecho', () => {
    const transition = (replayed: boolean, appliedByMe: boolean) => ({
      transition: {
        to: 'assigned' as const,
        event: 'rider_assigned' as const,
        replayed,
        appliedByMe,
      },
    });
    expect(outcomeOf(transition(false, true))).toEqual({
      kind: 'done',
      event: 'rider_assigned',
      status: 'assigned',
    });
    expect(outcomeOf(transition(true, false))).toEqual({
      kind: 'replayed',
      event: 'rider_assigned',
      status: 'assigned',
      byMe: false,
    });
  });
});
