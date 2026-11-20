import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type {
  AdminOrderActionState,
  AdminOrderBoard,
  AdminOrderSummary,
  OrderLifecycleStatus,
} from '@/lib/data-access/models';
import {
  BOARD_GROUPS,
  LIFECYCLE_STATUSES,
  classifyCommandError,
  dispatchInfo,
  findAction,
  groupBoard,
  isLatePending,
  minutesSincePlaced,
  outcomeOf,
  primaryAction,
  progressSteps,
  reasonActions,
  serverNowMs,
  validateReason,
  visibleActions,
} from './admin-orders-model';

const order = (
  over: Partial<AdminOrderSummary> & { actions?: AdminOrderActionState[] } = {},
): AdminOrderSummary => ({
  id: over.id ?? 'o1',
  orderNumber: 1,
  displayNumber: 'MON-000001',
  status: 'pending',
  branchId: 'b1',
  branchName: 'Sucursal 1',
  fulfillmentType: 'PICKUP',
  deliveryProvider: null,
  customerName: 'Ana',
  itemCount: 1,
  total: '10.00',
  paymentMethodPreference: 'cash',
  paymentStatus: 'PENDING',
  scheduledFor: null,
  placedAt: '2026-11-18T18:00:00.000Z',
  updatedAt: '2026-11-18T18:00:00.000Z',
  availableActions: over.actions ?? [],
  ...over,
});
const act = (
  action: AdminOrderActionState['action'],
  enabled = true,
  disabledReason: AdminOrderActionState['disabledReason'] = null,
): AdminOrderActionState => ({ action, enabled, disabledReason });

describe('groupBoard: 9 columnas del servidor → 6 del prototipo', () => {
  const column = (status: OrderLifecycleStatus, ids: string[], count = ids.length) => ({
    status,
    count,
    hasMore: count > ids.length,
    items: ids.map((id, i) =>
      order({ id, status, placedAt: `2026-11-18T18:0${i}:00.000Z`, displayNumber: id }),
    ),
  });
  const board: Pick<AdminOrderBoard, 'columns'> = {
    columns: [
      column('pending', ['p1', 'p2'], 5),
      column('accepted', []),
      column('preparing', ['q1']),
      column('ready', []),
      column('on_the_way', []),
      column('delivered', ['d1']),
      column('picked_up', ['k1', 'k2']),
      column('rejected', []),
      column('cancelled', ['c1'], 4),
    ],
  };

  it('conserva el conteo REAL y hasMore aunque haya menos tarjetas', () => {
    const groups = groupBoard(board);
    expect(groups.map((g) => g.key)).toEqual(BOARD_GROUPS.map((g) => g.key));
    expect(groups[0]).toMatchObject({ key: 'nuevo', count: 5, hasMore: true });
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['p1', 'p2']);
  });

  it('Finalizados une las 4 terminales (suma de conteos, más recientes primero)', () => {
    const fin = groupBoard(board).find((g) => g.key === 'finalizados')!;
    expect(fin.count).toBe(1 + 2 + 0 + 4);
    expect(fin.hasMore).toBe(true);
    const times = fin.items.map((i) => i.placedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});

describe('acciones: salen de availableActions del servidor', () => {
  it('NO_PERMISSION se oculta; dispatch deshabilitada se conserva con su motivo', () => {
    const o = order({
      actions: [
        act('accept'),
        act('reject', false, 'NO_PERMISSION'),
        act('cancel'),
        act('dispatch', false, 'PROVIDER_BLOCKED_EXTERNAL'),
      ],
    });
    expect(visibleActions(o).map((a) => a.action)).toEqual(['accept', 'cancel', 'dispatch']);
    expect(findAction(o, 'reject')).toBeUndefined();
    expect(dispatchInfo(o)).toBe('PROVIDER_BLOCKED_EXTERNAL');
    expect(reasonActions(o)).toEqual(['cancel']);
  });

  it('primaryAction elige la primera acción de avance HABILITADA y nunca dispatch', () => {
    expect(primaryAction(order({ actions: [act('accept'), act('reject'), act('cancel')] }))).toBe(
      'accept',
    );
    expect(
      primaryAction(order({ actions: [act('accept', false, 'NO_PERMISSION'), act('cancel')] })),
    ).toBeNull();
    expect(
      primaryAction(
        order({ actions: [act('cancel'), act('dispatch', false, 'DISPATCH_NOT_AVAILABLE')] }),
      ),
    ).toBeNull();
    expect(primaryAction(order({ actions: [act('start_preparing'), act('cancel')] }))).toBe(
      'start_preparing',
    );
    expect(primaryAction(order({ actions: [act('complete'), act('cancel')] }))).toBe('complete');
    expect(primaryAction(order({ actions: [] }))).toBeNull();
  });

  it('dispatchInfo diferencia reparto propio y PedidosYa; sin dispatch no hay nota', () => {
    expect(
      dispatchInfo(order({ actions: [act('dispatch', false, 'DISPATCH_NOT_AVAILABLE')] })),
    ).toBe('DISPATCH_NOT_AVAILABLE');
    expect(dispatchInfo(order({ actions: [act('cancel')] }))).toBeNull();
  });
});

describe('validateReason: 3–280 tras recortar, sin caracteres de control', () => {
  it('casos límite', () => {
    expect(validateReason('')).toBe('required');
    expect(validateReason('    ')).toBe('required');
    expect(validateReason(' ab ')).toBe('short');
    expect(validateReason(' abc ')).toBeNull();
    expect(validateReason('a'.repeat(280))).toBeNull();
    expect(validateReason('a'.repeat(281))).toBe('long');
    expect(validateReason('hola\u0000')).toBe('control');
    expect(validateReason('línea\nsalto')).toBe('control');
  });
});

describe('reloj corregido con el servidor', () => {
  it('serverNowMs = generatedAt + lo transcurrido desde que se recibió (nunca negativo)', () => {
    const generated = '2026-11-18T18:10:00.000Z';
    const base = Date.parse(generated);
    expect(serverNowMs(generated, 1_000, 61_000)).toBe(base + 60_000);
    expect(serverNowMs(generated, 5_000, 1_000)).toBe(base);
  });

  it('espera y atraso del pendiente (> 5 min)', () => {
    const now = Date.parse('2026-11-18T18:08:00.000Z');
    expect(minutesSincePlaced('2026-11-18T18:00:00.000Z', now)).toBe(8);
    expect(isLatePending(order({ status: 'pending' }), now)).toBe(true);
    expect(isLatePending(order({ status: 'accepted' }), now)).toBe(false);
    expect(
      isLatePending(order({ status: 'pending' }), Date.parse('2026-11-18T18:05:00.000Z')),
    ).toBe(false);
  });
});

describe('classifyCommandError: errores del servidor vs. red', () => {
  const api = (
    status: number,
    businessCode?: string,
    extra: { retry?: number; body?: unknown; violation?: string } = {},
  ) =>
    new ApiError(
      status,
      'x',
      'm',
      undefined,
      undefined,
      businessCode,
      extra.violation
        ? [{ path: 'expectedStatus', code: extra.violation, message: 'm' }]
        : undefined,
      extra.retry,
      extra.body,
    );

  it('409 conserva el estado actual del cuerpo (solo si es del catálogo)', () => {
    const e = classifyCommandError(
      api(409, 'ORDER_STATE_CONFLICT', {
        body: { current: { status: 'rejected', updatedAt: 'x' } },
      }),
    );
    expect(e).toMatchObject({
      kind: 'conflict',
      currentStatus: 'rejected',
      code: 'ORDER_STATE_CONFLICT',
    });
    expect(
      classifyCommandError(
        api(409, 'ORDER_STATE_CONFLICT', { body: { current: { status: 'raro' } } }),
      ).currentStatus,
    ).toBeNull();
  });

  it('422 conserva violations[0].code', () => {
    const e = classifyCommandError(
      api(422, 'ORDER_TRANSITION_INVALID', { violation: 'ORDER_TERMINAL' }),
    );
    expect(e).toMatchObject({ kind: 'invalid', violation: 'ORDER_TERMINAL' });
  });

  it('403 distingue MFA_REQUIRED y ORDER_ACTION_FORBIDDEN; 404, 400 de motivo, 429 y 503', () => {
    expect(classifyCommandError(api(403, 'MFA_REQUIRED')).kind).toBe('mfa');
    expect(classifyCommandError(api(403, 'ORDER_ACTION_FORBIDDEN')).kind).toBe('forbidden');
    expect(classifyCommandError(api(401)).kind).toBe('auth');
    expect(classifyCommandError(api(404, 'ORDER_NOT_FOUND')).kind).toBe('notFound');
    expect(classifyCommandError(api(400, 'ORDER_REASON_REQUIRED')).kind).toBe('reason');
    expect(classifyCommandError(api(400)).kind).toBe('unknown');
    expect(classifyCommandError(api(429, 'RATE_LIMITED', { retry: 12 }))).toMatchObject({
      kind: 'rate',
      retryAfterSec: 12,
    });
    expect(classifyCommandError(api(503, 'ORDERS_BUSY', { retry: 2 }))).toMatchObject({
      kind: 'busy',
      retryAfterSec: 2,
    });
  });

  it('red caída y 5xx son «network» (nunca un estado de negocio); lo desconocido, «unknown»', () => {
    expect(classifyCommandError(new ApiError(0, 'offline', 'sin conexión')).kind).toBe('network');
    expect(classifyCommandError(api(500)).kind).toBe('network');
    expect(classifyCommandError(new Error('x')).kind).toBe('unknown');
  });
});

describe('outcomeOf y barra de avance', () => {
  it('distingue éxito normal, repetición propia y de otra persona', () => {
    const base = { pendingActions: ['payment_review' as const] };
    expect(
      outcomeOf({ ...base, transition: { to: 'accepted', replayed: false, appliedByMe: true } }),
    ).toEqual({
      kind: 'done',
      to: 'accepted',
      pending: ['payment_review'],
    });
    expect(
      outcomeOf({ ...base, transition: { to: 'accepted', replayed: true, appliedByMe: false } }),
    ).toMatchObject({
      kind: 'replayed',
      byMe: false,
    });
    expect(
      outcomeOf({ ...base, transition: { to: 'accepted', replayed: true, appliedByMe: true } }),
    ).toMatchObject({
      kind: 'replayed',
      byMe: true,
    });
  });

  it('retiro omite «En camino»; rechazado/cancelado no tienen barra; el último paso queda hecho', () => {
    expect(
      progressSteps({ status: 'preparing', fulfillmentType: 'PICKUP' }).map((s) => s.status),
    ).toEqual(['pending', 'accepted', 'preparing', 'ready', 'picked_up']);
    expect(
      progressSteps({ status: 'preparing', fulfillmentType: 'PICKUP' }).map((s) => s.state),
    ).toEqual(['done', 'done', 'cur', '', '']);
    expect(progressSteps({ status: 'delivered', fulfillmentType: 'DELIVERY' }).at(-1)).toEqual({
      status: 'delivered',
      state: 'done',
    });
    expect(progressSteps({ status: 'rejected', fulfillmentType: 'PICKUP' })).toEqual([]);
    expect(LIFECYCLE_STATUSES).toHaveLength(9);
  });
});
