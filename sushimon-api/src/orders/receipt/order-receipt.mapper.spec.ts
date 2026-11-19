import { toOrderDetail } from '../order-mapper.js';
import { source } from '../../../test/support/order-source-fixtures.js';
import { sourceToOrderRecord } from '../order-source.repository.js';
import { toOrderReceipt } from './order-receipt.mapper.js';

const NOW = new Date('2026-11-19T15:00:00.000Z');

describe('toOrderReceipt (spec 024 §4.2)', () => {
  it('campos EXACTOS del contrato', () => {
    const r = toOrderReceipt(source(), NOW);
    expect(Object.keys(r).sort()).toEqual(
      [
        'address',
        'branch',
        'contact',
        'currency',
        'deliveryFee',
        'discountTotal',
        'displayNumber',
        'extrasTotal',
        'fiscalStatus',
        'fulfillment',
        'generatedAt',
        'lines',
        'notes',
        'payment',
        'placedAt',
        'promotions',
        'publicStatus',
        'status',
        'subtotal',
        'timeZone',
        'total',
      ].sort(),
    );
    expect(r).toMatchObject({
      fiscalStatus: 'NOT_FISCAL',
      timeZone: 'America/Guatemala',
      currency: 'GTQ',
      displayNumber: 'MON-001042',
      status: 'delivered',
      publicStatus: 'completed',
      generatedAt: NOW.toISOString(),
      placedAt: '2026-11-18T19:42:10.000Z',
      branch: { name: 'Sushi Mon Zona 10', address: '5a Av. 10-20 Zona 10', phone: '2222-3333' },
      fulfillment: { type: 'DELIVERY', provider: 'OWN' },
      contact: { fullName: 'Ana Pérez', phoneMasked: '****1234' },
      payment: { methodPreference: 'cash', status: 'NOT_STARTED' },
    });
  });

  it('NO contiene ids, teléfono completo, tokens, correo, coordenadas ni historial (barrido de claves y valores)', () => {
    const json = JSON.stringify(toOrderReceipt(source(), NOW));
    for (const forbidden of [
      '7c1f0f52',
      '0b9d3c1e',
      '00000000-0000-4000',
      '55551234',
      'smo_',
      'email',
      'latitude',
      'longitude',
      'reason',
      'changedBy',
      'history',
      'updatedAt',
      'orderId',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('mismas cifras que getOrder (toOrderDetail) y total = subtotal − descuento + entrega', () => {
    const s = source();
    const receipt = toOrderReceipt(s, NOW);
    const detail = toOrderDetail(sourceToOrderRecord(s));
    expect(receipt.lines).toEqual(detail.lines);
    expect(receipt.promotions).toEqual(detail.promotions);
    for (const k of ['subtotal', 'extrasTotal', 'discountTotal', 'deliveryFee', 'total'] as const) {
      expect(receipt[k]).toBe(detail[k]);
    }
    const cents = (v: string) => Math.round(Number(v) * 100);
    expect(cents(receipt.total)).toBe(
      cents(receipt.subtotal) - cents(receipt.discountTotal) + cents(receipt.deliveryFee),
    );
    expect(receipt.lines[0]).toMatchObject({
      unitPrice: '80.00',
      extrasPerUnit: '5.00',
      lineSubtotal: '170.00',
      discount: '20.00',
      lineTotal: '150.00',
      notes: 'bien frío',
    });
  });

  it('PICKUP: address y provider null; sucursal sin teléfono', () => {
    const r = toOrderReceipt(
      source({
        fulfillmentType: 'PICKUP',
        deliveryProvider: null,
        address: null,
        branchPhone: null,
      }),
      NOW,
    );
    expect(r.address).toBeNull();
    expect(r.fulfillment).toEqual({ type: 'PICKUP', provider: null });
    expect(r.branch.phone).toBeNull();
  });

  it.each(['pending', 'accepted', 'ready', 'picked_up', 'delivered', 'rejected', 'cancelled'])(
    'disponible en %s, con pago NOT_STARTED y sin motivo',
    (status) => {
      const r = toOrderReceipt(source({ status }), NOW);
      expect(r.status).toBe(status);
      expect(r.payment.status).toBe('NOT_STARTED');
      expect(JSON.stringify(r)).not.toMatch(/reason|motivo/i);
    },
  );

  it('PEDIDOSYA histórico se muestra tal cual, sin estados externos', () => {
    const r = toOrderReceipt(source({ deliveryProvider: 'PEDIDOSYA' }), NOW);
    expect(r.fulfillment.provider).toBe('PEDIDOSYA');
    expect(Object.keys(r)).not.toContain('delivery');
  });

  it('importes como cadena de 2 decimales (nunca number) tal como vienen del snapshot', () => {
    const r = toOrderReceipt(
      source({ total: '0.50', subtotal: '0.50', discountTotal: '0.00', deliveryFee: '0.00' }),
      NOW,
    );
    expect(r.total).toBe('0.50');
    expect(typeof r.total).toBe('string');
  });
});
