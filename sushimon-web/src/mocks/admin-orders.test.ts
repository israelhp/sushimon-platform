import { describe, expect, it } from 'vitest';
import type { OrderLifecycleStatus, StaffPermission } from '@/lib/data-access/models';
import type { AdminOrderCommand } from '@/services/admin-orders';
import {
  COMMANDS,
  COMMAND_SPECS,
  availableActionsFor,
  checkCommand,
  draftStatusOf,
  lifecycleOf,
  pendingActionsFor,
  type DeliveryProvider,
  type FulfillmentType,
  type RuleOrder,
  type ViolationCode,
} from './admin-orders';

/**
 * Spec 023 §3.2 y §11 #1/#56: la MISMA tabla de casos que la API real. Se escribe a mano desde la spec (no se deriva de la
 * implementación): origen permitido por comando y los códigos de violación de cada celda.
 */
const STATUSES: OrderLifecycleStatus[] = [
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
const TERMINAL = ['delivered', 'picked_up', 'rejected', 'cancelled'];
const MODES: { fulfillment: FulfillmentType; provider: DeliveryProvider; label: string }[] = [
  { fulfillment: 'PICKUP', provider: null, label: 'PICKUP' },
  { fulfillment: 'DELIVERY', provider: 'OWN', label: 'DELIVERY OWN' },
  { fulfillment: 'DELIVERY', provider: 'PEDIDOSYA', label: 'DELIVERY PEDIDOSYA' },
];
const ALLOWED_ORIGINS: Record<AdminOrderCommand, OrderLifecycleStatus[]> = {
  accept: ['pending'],
  reject: ['pending'],
  'start-preparing': ['accepted'],
  'mark-ready': ['preparing'],
  complete: ['ready'],
  cancel: ['pending', 'accepted', 'preparing', 'ready'],
};

function expected(
  command: AdminOrderCommand,
  origin: OrderLifecycleStatus,
  fulfillment: FulfillmentType,
): ViolationCode | 'OK' {
  if (TERMINAL.includes(origin)) return 'ORDER_TERMINAL';
  if (command === 'cancel' && origin === 'on_the_way') {
    return fulfillment === 'PICKUP' ? 'ORDER_SOURCE_INVALID' : 'ORDER_CANCEL_NOT_ALLOWED';
  }
  if (!ALLOWED_ORIGINS[command].includes(origin)) return 'ORDER_SOURCE_INVALID';
  if (command === 'complete' && fulfillment === 'DELIVERY') return 'ORDER_FULFILLMENT_MISMATCH';
  return 'OK';
}

describe('matriz de transiciones (§3.2): cada comando × origen × modalidad × proveedor', () => {
  for (const mode of MODES) {
    for (const command of COMMANDS) {
      it(`${mode.label} · ${command}`, () => {
        for (const origin of STATUSES) {
          const result = checkCommand(
            { fulfillmentType: mode.fulfillment, deliveryProvider: mode.provider },
            command,
            origin,
          );
          const want = expected(command, origin, mode.fulfillment);
          expect(result.ok ? 'OK' : result.code, `${command} desde ${origin}`).toBe(want);
        }
      });
    }
  }

  it('ningún comando produce on_the_way ni delivered (los escribe F28)', () => {
    for (const command of COMMANDS) {
      expect(['on_the_way', 'delivered']).not.toContain(COMMAND_SPECS[command].to);
    }
  });

  it('filas explícitas de la spec', () => {
    const own = { fulfillmentType: 'DELIVERY', deliveryProvider: 'OWN' } as const;
    const py = { fulfillmentType: 'DELIVERY', deliveryProvider: 'PEDIDOSYA' } as const;
    const pickup = { fulfillmentType: 'PICKUP', deliveryProvider: null } as const;
    expect(checkCommand(pickup, 'complete', 'ready')).toEqual({ ok: true });
    expect(checkCommand(own, 'complete', 'ready')).toEqual({
      ok: false,
      code: 'ORDER_FULFILLMENT_MISMATCH',
    });
    expect(checkCommand(py, 'complete', 'ready')).toEqual({
      ok: false,
      code: 'ORDER_FULFILLMENT_MISMATCH',
    });
    expect(checkCommand(py, 'mark-ready', 'preparing')).toEqual({ ok: true });
    expect(checkCommand(own, 'cancel', 'ready')).toEqual({ ok: true });
    expect(checkCommand(own, 'cancel', 'on_the_way')).toEqual({
      ok: false,
      code: 'ORDER_CANCEL_NOT_ALLOWED',
    });
    expect(checkCommand(pickup, 'cancel', 'on_the_way')).toEqual({
      ok: false,
      code: 'ORDER_SOURCE_INVALID',
    });
    expect(checkCommand(pickup, 'accept', 'preparing')).toEqual({
      ok: false,
      code: 'ORDER_SOURCE_INVALID',
    });
  });
});

describe('availableActionsFor (§4.2)', () => {
  const all = () => true;
  const none = () => false;
  const rule = (
    status: OrderLifecycleStatus,
    f: FulfillmentType,
    p: DeliveryProvider = null,
  ): RuleOrder => ({
    status,
    fulfillmentType: f,
    deliveryProvider: p,
  });
  const names = (r: RuleOrder, can: (p: StaffPermission) => boolean = all) =>
    availableActionsFor(r, can).map((a) => a.action);

  it('lista solo las acciones que existen para el estado y la modalidad', () => {
    expect(names(rule('pending', 'PICKUP'))).toEqual(['accept', 'reject', 'cancel']);
    expect(names(rule('accepted', 'PICKUP'))).toEqual(['start_preparing', 'cancel']);
    expect(names(rule('preparing', 'DELIVERY', 'OWN'))).toEqual(['mark_ready', 'cancel']);
    expect(names(rule('ready', 'PICKUP'))).toEqual(['complete', 'cancel']);
    expect(names(rule('ready', 'DELIVERY', 'OWN'))).toEqual(['cancel', 'dispatch']);
    for (const status of [
      'on_the_way',
      'delivered',
      'picked_up',
      'rejected',
      'cancelled',
    ] as const) {
      expect(names(rule(status, 'DELIVERY', 'OWN'))).toEqual([]);
    }
  });

  it('sin permiso: enabled=false con NO_PERMISSION; con permiso: enabled', () => {
    expect(availableActionsFor(rule('pending', 'PICKUP'), none)).toEqual([
      { action: 'accept', enabled: false, disabledReason: 'NO_PERMISSION' },
      { action: 'reject', enabled: false, disabledReason: 'NO_PERMISSION' },
      { action: 'cancel', enabled: false, disabledReason: 'NO_PERMISSION' },
    ]);
    const kitchen = (p: StaffPermission) => p !== 'orders.cancel';
    expect(availableActionsFor(rule('pending', 'PICKUP'), kitchen).map((a) => a.enabled)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('dispatch SIEMPRE deshabilitada: propia → DISPATCH_NOT_AVAILABLE, PedidosYa → PROVIDER_BLOCKED_EXTERNAL', () => {
    const own = availableActionsFor(rule('ready', 'DELIVERY', 'OWN'), all).find(
      (a) => a.action === 'dispatch',
    );
    const py = availableActionsFor(rule('ready', 'DELIVERY', 'PEDIDOSYA'), all).find(
      (a) => a.action === 'dispatch',
    );
    expect(own).toEqual({
      action: 'dispatch',
      enabled: false,
      disabledReason: 'DISPATCH_NOT_AVAILABLE',
    });
    expect(py).toEqual({
      action: 'dispatch',
      enabled: false,
      disabledReason: 'PROVIDER_BLOCKED_EXTERNAL',
    });
  });
});

describe('mapeos y pendingActions', () => {
  it('received ↔ pending y delivered → picked_up en recoger', () => {
    expect(lifecycleOf('received', 'pickup')).toBe('pending');
    expect(lifecycleOf('delivered', 'pickup')).toBe('picked_up');
    expect(lifecycleOf('delivered', 'delivery')).toBe('delivered');
    expect(lifecycleOf('on_the_way', 'delivery')).toBe('on_the_way');
    expect(draftStatusOf('pending')).toBe('received');
    expect(draftStatusOf('picked_up')).toBe('delivered');
    expect(draftStatusOf('rejected')).toBe('rejected');
  });

  it('payment_review solo en reject/cancel con transferencia; efectivo → []', () => {
    expect(pendingActionsFor('cancel', 'bank_transfer')).toEqual(['payment_review']);
    expect(pendingActionsFor('reject', 'bank_transfer')).toEqual(['payment_review']);
    expect(pendingActionsFor('cancel', 'cash')).toEqual([]);
    expect(pendingActionsFor('cancel', null)).toEqual([]);
    expect(pendingActionsFor('accept', 'bank_transfer')).toEqual([]);
  });
});
