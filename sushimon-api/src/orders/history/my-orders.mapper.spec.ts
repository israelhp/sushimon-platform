import { isTerminalStatus, toPublicStatus } from '../order-tracking.mapper.js';
import { toMyOrderSummary } from './my-orders.mapper.js';
import type { MyOrderRow } from './my-orders.types.js';

const row = (over: Partial<MyOrderRow> = {}): MyOrderRow => ({
  id: '7c1f0f52-3b5e-4c63-9a4d-5f6e8f0a1b2c',
  orderNumber: 1042n,
  status: 'picked_up',
  branchId: '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a6b',
  branchName: 'Sushi Mon Zona 10',
  fulfillmentType: 'PICKUP',
  deliveryProvider: null,
  total: '165.00',
  paymentMethodPreference: 'cash',
  placedAt: new Date('2026-11-18T19:42:10.000Z'),
  updatedAt: new Date('2026-11-18T20:15:44.000Z'),
  itemCount: 3,
  placedAtKey: '2026-11-18T19:42:10.000000Z',
  ...over,
});

const STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
] as const;

describe('toMyOrderSummary (spec 024 §4.1)', () => {
  it('forma exacta del contrato y NADA más (sin líneas, contacto, dirección, notas ni motivo)', () => {
    const s = toMyOrderSummary(row());
    expect(Object.keys(s).sort()).toEqual(
      [
        'branchId',
        'branchName',
        'currency',
        'deliveryProvider',
        'displayNumber',
        'fulfillmentType',
        'id',
        'itemCount',
        'orderNumber',
        'paymentMethodPreference',
        'placedAt',
        'publicStatus',
        'status',
        'terminal',
        'total',
        'updatedAt',
      ].sort(),
    );
    expect(s).toMatchObject({
      displayNumber: 'MON-001042',
      orderNumber: 1042,
      total: '165.00',
      currency: 'GTQ',
      itemCount: 3,
      placedAt: '2026-11-18T19:42:10.000Z',
    });
  });

  it.each(STATUSES)('%s: publicStatus y terminal son los del mapeo de F21', (status) => {
    const s = toMyOrderSummary(row({ status }));
    expect(s.status).toBe(status);
    expect(s.publicStatus).toBe(toPublicStatus(status));
    expect(s.terminal).toBe(isTerminalStatus(status));
  });

  it('el total es siempre cadena (nunca number) y el PEDIDOSYA histórico se muestra tal cual', () => {
    const s = toMyOrderSummary(
      row({ fulfillmentType: 'DELIVERY', deliveryProvider: 'PEDIDOSYA', total: '5.00' }),
    );
    expect(typeof s.total).toBe('string');
    expect(s.total).toBe('5.00');
    expect(s).toMatchObject({ fulfillmentType: 'DELIVERY', deliveryProvider: 'PEDIDOSYA' });
  });

  it('valores fuera de catálogo se normalizan (nunca se expone un valor crudo)', () => {
    const s = toMyOrderSummary(
      row({ fulfillmentType: 'X', deliveryProvider: 'RAPPI', paymentMethodPreference: 'bitcoin' }),
    );
    expect(s).toMatchObject({
      fulfillmentType: 'PICKUP',
      deliveryProvider: null,
      paymentMethodPreference: null,
    });
  });
});
