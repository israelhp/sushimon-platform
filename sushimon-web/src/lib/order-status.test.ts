import { describe, expect, it } from 'vitest';
import type { Order, OrderStatus } from './data-access/models';
import {
  canDispatch,
  checkTransition,
  nextBackofficeAction,
  nextDeliveryStatus,
  orderStatusForDelivery,
  toBackofficeColumn,
  toBackofficeLogistics,
  toStoreOrderState,
  toStoreTrackingStep,
  fromBackofficeColumn,
} from './order-status';

type O = Pick<Order, 'status' | 'fulfillment' | 'payment' | 'delivery'>;

const payment = (method: 'cash' | 'card', status: Order['payment']['status']) =>
  ({
    method,
    status,
    amount: 100,
    reference: null,
    cardBrand: null,
    cardLast4: null,
    simulated: true,
    processedAt: null,
  }) satisfies Order['payment'];

const order = (over: Partial<O> = {}): O => ({
  status: 'received',
  fulfillment: 'delivery',
  payment: payment('cash', 'pending'),
  delivery: null,
  ...over,
});

describe('máquina de estados', () => {
  it('permite el flujo normal y rechaza saltos', () => {
    expect(checkTransition(order(), 'accepted').ok).toBe(true);
    expect(checkTransition(order(), 'ready').ok).toBe(false);
    expect(checkTransition(order({ status: 'delivered' }), 'cancelled', 'staff', 'x').ok).toBe(
      false,
    );
    expect(checkTransition(order({ status: 'rejected' }), 'accepted').ok).toBe(false);
  });

  it('exige motivo para rechazar/cancelar', () => {
    expect(checkTransition(order(), 'rejected').ok).toBe(false);
    expect(checkTransition(order(), 'rejected', 'staff', 'Producto agotado').ok).toBe(true);
  });

  it('no acepta pedidos con tarjeta sin aprobar', () => {
    expect(checkTransition(order({ payment: payment('card', 'pending') }), 'accepted').ok).toBe(
      false,
    );
    expect(checkTransition(order({ payment: payment('card', 'review') }), 'accepted').ok).toBe(
      false,
    );
    expect(checkTransition(order({ payment: payment('card', 'approved') }), 'accepted').ok).toBe(
      true,
    );
  });

  it('en camino/entregado a domicilio solo por logística', () => {
    const ready = order({ status: 'ready' });
    expect(checkTransition(ready, 'on_the_way', 'staff').ok).toBe(false);
    expect(checkTransition(ready, 'on_the_way', 'logistics').ok).toBe(true);
    expect(checkTransition(ready, 'delivered', 'staff').ok).toBe(false);
    expect(checkTransition({ ...ready, fulfillment: 'pickup' }, 'delivered', 'staff').ok).toBe(
      true,
    );
    expect(checkTransition({ ...ready, fulfillment: 'pickup' }, 'on_the_way', 'logistics').ok).toBe(
      false,
    );
  });

  it('reglas de despacho', () => {
    const ready = order({ status: 'ready' });
    expect(canDispatch(ready, 'manager')).toBe(true);
    expect(canDispatch(ready, 'kitchen')).toBe(false);
    expect(canDispatch({ ...ready, fulfillment: 'pickup' })).toBe(false);
    const withDelivery = {
      ...ready,
      delivery: {
        provider: 'pedidosya' as const,
        status: 'searching' as const,
        riderId: null,
        riderName: null,
        reference: null,
        cost: 15,
        requestedAt: '',
        etaAt: null,
        deliveredAt: null,
        simulated: true,
      },
    };
    expect(canDispatch(withDelivery)).toBe(false);
    expect(
      canDispatch({ ...withDelivery, delivery: { ...withDelivery.delivery, status: 'failed' } }),
    ).toBe(true);
  });

  it('secuencias logísticas', () => {
    expect(nextDeliveryStatus('pedidosya', 'searching')).toBe('assigned');
    expect(nextDeliveryStatus('own', 'assigned')).toBe('on_the_way');
    expect(nextDeliveryStatus('own', 'delivered')).toBeNull();
    expect(orderStatusForDelivery('pedidosya', 'picked_up')).toBe('on_the_way');
    expect(orderStatusForDelivery('pedidosya', 'on_the_way')).toBeNull();
    expect(orderStatusForDelivery('own', 'on_the_way')).toBe('on_the_way');
    expect(orderStatusForDelivery('own', 'delivered')).toBe('delivered');
  });
});

describe('mapeos de UI', () => {
  it('tienda: claves de estado del prototipo', () => {
    expect(toStoreOrderState(order())).toBe('pending_acceptance');
    expect(toStoreOrderState(order({ payment: payment('card', 'approved') }))).toBe(
      'paid_pending_acceptance',
    );
    expect(toStoreOrderState(order({ payment: payment('card', 'pending') }))).toBe(
      'awaiting_payment',
    );
    expect(toStoreOrderState(order({ payment: payment('card', 'declined') }))).toBe(
      'awaiting_payment',
    );
    expect(toStoreOrderState(order({ payment: payment('card', 'review') }))).toBe('payment_review');
    expect(toStoreOrderState(order({ status: 'preparing' }))).toBe('in_progress');
    expect(toStoreOrderState(order({ status: 'delivered' }))).toBe('completed');
  });

  it('tienda: pasos de seguimiento (6 domicilio / 5 recoger)', () => {
    const step = (
      status: OrderStatus,
      fulfillment: 'delivery' | 'pickup' = 'delivery',
      paid = false,
    ) =>
      toStoreTrackingStep(
        order({
          status,
          fulfillment,
          payment: paid ? payment('card', 'approved') : payment('cash', 'pending'),
        }),
      );
    expect(step('received')).toMatchObject({ total: 6, progress: 1, payOnDelivery: true });
    expect(step('received', 'delivery', true)).toMatchObject({ progress: 2, payOnDelivery: false });
    expect(step('preparing').progress).toBe(2);
    expect(step('ready').progress).toBe(3);
    expect(step('on_the_way').progress).toBe(4);
    expect(step('delivered').progress).toBe(6);
    expect(step('delivered', 'pickup')).toMatchObject({ total: 5, progress: 5, variant: 'pickup' });
    expect(step('rejected').halted).toBe(true);
  });

  it('backoffice: columnas, logística y siguiente acción', () => {
    expect(toBackofficeColumn(order())).toBe('nuevo');
    expect(toBackofficeColumn(order({ status: 'cancelled' }))).toBe('cancelado');
    expect(fromBackofficeColumn('cancelado')).toEqual(['rejected', 'cancelled']);
    expect(toBackofficeLogistics(order())).toBe('none');
    expect(toBackofficeLogistics(order({ status: 'delivered' }))).toBe('entregado');
    expect(nextBackofficeAction(order(), 'kitchen')).toBe('accept');
    expect(nextBackofficeAction(order({ status: 'accepted' }), 'kitchen')).toBe('prepare');
    expect(nextBackofficeAction(order({ status: 'ready' }), 'kitchen')).toBeNull();
    expect(nextBackofficeAction(order({ status: 'ready' }), 'manager')).toBe('dispatch');
    expect(nextBackofficeAction(order({ status: 'ready', fulfillment: 'pickup' }), 'kitchen')).toBe(
      'deliver',
    );
  });
});
