import { toOrderDetail, toPublicPayment, toReceiptPayment } from '../order-mapper.js';
import { toOrderReceipt } from '../receipt/order-receipt.mapper.js';
import { toOrderTracking } from '../order-tracking.mapper.js';
import { source } from '../../../test/support/order-source-fixtures.js';
import { buildOrderRecord } from '../order-record.js';
import {
  blockedReasonOf,
  collectionContextOf,
  notCollectableOf,
  possibleRefundReviewOf,
  toAdminPayment,
  toPaymentHistory,
  toPaymentSummary,
  type PaymentSummarySource,
} from './payment-view.js';
import type { PaymentOrderView } from './payments.types.js';

const NOW = new Date('2026-11-19T20:00:00.000Z');
const PAID_AT = new Date('2026-11-19T19:05:12.000Z');
const dec = (v: string) => ({ toFixed: () => v });
const src = (over: Partial<PaymentSummarySource> = {}): PaymentSummarySource => ({
  orderStatus: 'pending',
  fulfillmentType: 'PICKUP',
  deliveryProvider: null,
  total: '185.00',
  paymentStatus: 'pending',
  paidAt: null,
  ...over,
});

describe('registration (blockedReason) y possibleRefundReview', () => {
  it.each([
    [src(), true, null],
    [src(), false, 'NO_PERMISSION'],
    [src({ paymentStatus: 'paid', paidAt: PAID_AT }), true, 'ALREADY_PAID'],
    [src({ paymentStatus: 'paid', orderStatus: 'cancelled' }), false, 'ALREADY_PAID'],
    [src({ orderStatus: 'rejected' }), true, 'ORDER_CLOSED'],
    [src({ orderStatus: 'cancelled' }), true, 'ORDER_CLOSED'],
    [
      src({ fulfillmentType: 'DELIVERY', deliveryProvider: 'PEDIDOSYA' }),
      true,
      'PROVIDER_BLOCKED_EXTERNAL',
    ],
    // DELIVERY sin proveedor: sin contexto de cobro => mismo criterio que el POST (nunca `allowed: true` y luego 422)
    [
      src({ fulfillmentType: 'DELIVERY', deliveryProvider: null }),
      true,
      'PROVIDER_BLOCKED_EXTERNAL',
    ],
    [src({ fulfillmentType: 'DELIVERY', deliveryProvider: 'OWN' }), true, null],
    [src({ paymentStatus: null }), true, 'LEGACY_PAYMENT_METHOD'],
    [src({ total: '0.00' }), true, 'AMOUNT_ZERO'],
  ] as const)('%j (confirm=%s) => %s', (input, canConfirm, reason) => {
    expect(blockedReasonOf(input, canConfirm)).toBe(reason);
  });

  it('possibleRefundReview solo con PAID + pedido rejected|cancelled (nunca sin cobro)', () => {
    const paid = (orderStatus: string) => src({ paymentStatus: 'paid', orderStatus });
    expect(possibleRefundReviewOf(paid('cancelled'))).toBe(true);
    expect(possibleRefundReviewOf(paid('rejected'))).toBe(true);
    expect(possibleRefundReviewOf(paid('picked_up'))).toBe(false);
    expect(possibleRefundReviewOf(src({ orderStatus: 'cancelled' }))).toBe(false);
    expect(possibleRefundReviewOf(src({ paymentStatus: null, orderStatus: 'cancelled' }))).toBe(
      false,
    );
  });

  it('una sola fuente de verdad: allowed <=> hay contexto de cobro derivable (GET y POST coinciden)', () => {
    for (const [fulfillmentType, deliveryProvider] of [
      ['PICKUP', null],
      ['DELIVERY', 'OWN'],
      ['DELIVERY', 'PEDIDOSYA'],
      ['DELIVERY', null],
      ['DELIVERY', 'RAPPI'],
    ] as const) {
      const input = src({ fulfillmentType, deliveryProvider });
      const allowed = blockedReasonOf(input, true) === null;
      expect(allowed).toBe(collectionContextOf(fulfillmentType, deliveryProvider) !== null);
      expect(notCollectableOf(input) === null).toBe(allowed);
    }
  });

  it('contexto de cobro derivado: PICKUP => BRANCH, DELIVERY OWN => OWN_DELIVERY, PedidosYa => null', () => {
    expect(collectionContextOf('PICKUP', null)).toBe('BRANCH');
    expect(collectionContextOf('DELIVERY', 'OWN')).toBe('OWN_DELIVERY');
    expect(collectionContextOf('DELIVERY', 'PEDIDOSYA')).toBeNull();
    expect(collectionContextOf('DELIVERY', null)).toBeNull();
  });

  it('resumen: PENDING => outstanding = deuda; PAID => outstanding 0.00 y paidAt', () => {
    expect(toPaymentSummary(src(), true)).toMatchObject({
      status: 'PENDING',
      amountDue: '185.00',
      outstanding: '185.00',
      paidAt: null,
    });
    expect(toPaymentSummary(src({ paymentStatus: 'paid', paidAt: PAID_AT }), true)).toMatchObject({
      status: 'PAID',
      outstanding: '0.00',
      paidAt: '2026-11-19T19:05:12.000Z',
    });
  });
});

describe('toAdminPayment / toPaymentHistory: sin ids de empleado ni hashes', () => {
  const view = (over: Partial<PaymentOrderView> = {}): PaymentOrderView => ({
    orderId: 'o1',
    orderNumber: 1042n,
    orderStatus: 'picked_up',
    branchId: 'b1',
    fulfillmentType: 'PICKUP',
    deliveryProvider: null,
    total: '185.00',
    payment: {
      id: 'p1',
      status: 'paid',
      amount: '185.00',
      tendered: '200.00',
      change: '15.00',
      receivedAt: PAID_AT,
      collectionContext: 'BRANCH',
      receivedByStaffId: 'STAFF-SECRETO',
      collectorName: 'María Pérez',
      confirmKeyHash: Buffer.alloc(32, 1),
      confirmRequestHash: Buffer.alloc(32, 2),
    },
    ...over,
  });

  it('PAID: recepción completa; NUNCA el id del empleado ni los hashes', () => {
    const dto = toAdminPayment(view(), false, NOW);
    expect(dto).toMatchObject({
      displayNumber: 'MON-001042',
      method: 'CASH',
      status: 'PAID',
      currency: 'GTQ',
      collectionContext: 'BRANCH',
      reception: {
        amountApplied: '185.00',
        tendered: '200.00',
        change: '15.00',
        receivedAt: '2026-11-19T19:05:12.000Z',
        collectorType: 'STAFF',
        collectorName: 'María Pérez',
        branchId: 'b1',
        context: 'BRANCH',
      },
      generatedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(dto)).not.toMatch(/STAFF-SECRETO|hash|receivedByStaffId/i);
  });

  it('el efectivo entregado y el cambio nunca se suman como ingreso: amountApplied = amountDue', () => {
    const dto = toAdminPayment(view(), false, NOW);
    expect(dto.reception?.amountApplied).toBe(dto.amountDue);
  });

  it('sin fila de pago: CASH/PENDING, sin recepción', () => {
    expect(toAdminPayment(view({ payment: null }), true, NOW)).toMatchObject({
      status: 'PENDING',
      reception: null,
      registration: { allowed: false, blockedReason: 'LEGACY_PAYMENT_METHOD' },
    });
  });

  it('historial: eventos conocidos, seq 1..N, desconocidos omitidos, sin ids', () => {
    const at = (m: number) => new Date(PAID_AT.getTime() + m);
    const h = toPaymentHistory(
      {
        orderId: 'o1',
        orderNumber: 7n,
        events: [
          {
            id: 'e1',
            type: 'created',
            at: at(0),
            actorName: null,
            amount: '185.00',
            tendered: null,
            change: null,
          },
          {
            id: 'e2',
            type: 'voided',
            at: at(1),
            actorName: 'X',
            amount: '185.00',
            tendered: null,
            change: null,
          },
          {
            id: 'e3',
            type: 'cash_received',
            at: at(2),
            actorName: 'María',
            amount: '185.00',
            tendered: '200.00',
            change: '15.00',
          },
        ],
      },
      NOW,
    );
    expect(h.items.map((e) => [e.seq, e.type])).toEqual([
      [1, 'CREATED'],
      [2, 'CASH_RECEIVED'],
    ]);
    expect(JSON.stringify(h)).not.toMatch(/"id"|e1|e3/);
  });
});

describe('vocabulario público de pago (detalle, seguimiento y recibo)', () => {
  const paid = {
    status: 'paid',
    amount: dec('185.00'),
    tendered: dec('200.00'),
    change: dec('15.00'),
    receivedAt: PAID_AT,
  };
  const pending = {
    status: 'pending',
    amount: dec('185.00'),
    tendered: null,
    change: null,
    receivedAt: null,
  };

  it('toPublicPayment: PENDING/PAID, paidAt solo con PAID; ausencia de fila => PENDING', () => {
    expect(toPublicPayment(pending)).toEqual({ method: 'CASH', status: 'PENDING', paidAt: null });
    expect(toPublicPayment(null)).toEqual({ method: 'CASH', status: 'PENDING', paidAt: null });
    expect(toPublicPayment(undefined)).toEqual({ method: 'CASH', status: 'PENDING', paidAt: null });
    expect(toPublicPayment(paid)).toEqual({
      method: 'CASH',
      status: 'PAID',
      paidAt: '2026-11-19T19:05:12.000Z',
    });
    // un estado desconocido jamás se declara pagado
    expect(toPublicPayment({ ...paid, status: 'voided' }).status).toBe('PENDING');
  });

  it('#42 recibo PENDING: importes null; #43 recibo PAID: pagado = total, entregado y cambio', () => {
    expect(toReceiptPayment(pending)).toEqual({
      method: 'CASH',
      status: 'PENDING',
      paidAt: null,
      amountPaid: null,
      tendered: null,
      change: null,
    });
    expect(toReceiptPayment(paid)).toEqual({
      method: 'CASH',
      status: 'PAID',
      paidAt: '2026-11-19T19:05:12.000Z',
      amountPaid: '185.00',
      tendered: '200.00',
      change: '15.00',
    });
    const r = toOrderReceipt(
      source({
        payment: {
          status: 'paid',
          amount: '165.00',
          tendered: '200.00',
          change: '35.00',
          receivedAt: PAID_AT,
        },
      }),
      NOW,
    );
    expect(r.payment).toMatchObject({
      status: 'PAID',
      amountPaid: '165.00',
      tendered: '200.00',
      change: '35.00',
    });
    expect(r.payment.amountPaid).toBe(r.total);
    expect(toOrderReceipt(source({ payment: null }), NOW).payment.status).toBe('PENDING');
  });

  it('#46 OrderDetail/OrderTracking: solo method/status/paidAt (sin importes, empleado, contexto, hashes)', () => {
    const detail = toOrderDetail({
      ...buildOrderRecord(
        {
          orderId: 'o1',
          customerId: null,
          branchId: 'b',
          customerName: 'Ana',
          customerPhone: '55551234',
          customerEmail: null,
          fulfillmentType: 'PICKUP',
          deliveryProvider: null,
          notes: null,
          subtotal: '10.00',
          extrasTotal: '0.00',
          discountTotal: '0.00',
          deliveryFee: '0.00',
          total: '10.00',
          paymentMethodPreference: 'cash',
          address: null,
          lines: [],
          promotions: [],
          guestToken: null,
          itemCount: 0,
        },
        { orderNumber: 1n, placedAt: NOW, updatedAt: NOW },
      ),
      payment: paid,
    });
    expect(detail.payment).toEqual({
      method: 'CASH',
      status: 'PAID',
      paidAt: '2026-11-19T19:05:12.000Z',
    });
    const t = toOrderTracking(
      {
        id: 'o1',
        orderNumber: 1n,
        branchId: 'b',
        fulfillmentType: 'PICKUP',
        deliveryProvider: null,
        status: 'pending',
        placedAt: NOW,
        updatedAt: NOW,
        payment: paid,
        history: [],
      },
      NOW,
    );
    expect(t.payment).toEqual({
      method: 'CASH',
      status: 'PAID',
      paidAt: '2026-11-19T19:05:12.000Z',
    });
    // el pago no entra en el timeline operativo
    expect(JSON.stringify([t.steps, t.events])).not.toMatch(/paid|PAID|payment/);
    expect(JSON.stringify([detail.payment, t.payment])).not.toMatch(
      /tendered|change|amount|staff|hash|context/i,
    );
  });

  it('cambiar el estado del pedido no cambia payment.status (#45)', () => {
    const base = {
      id: 'o1',
      orderNumber: 1n,
      branchId: 'b',
      fulfillmentType: 'PICKUP',
      deliveryProvider: null,
      placedAt: NOW,
      updatedAt: NOW,
      payment: pending,
      history: [],
    };
    for (const status of ['pending', 'accepted', 'cancelled', 'picked_up']) {
      expect(toOrderTracking({ ...base, status }, NOW).payment.status).toBe('PENDING');
    }
  });
});

describe('barrido: el payload público NO contiene datos internos aunque el origen los traiga (F24 #46)', () => {
  const dirty = {
    status: 'paid',
    amount: dec('185.00'),
    tendered: dec('200.00'),
    change: dec('15.00'),
    receivedAt: PAID_AT,
    // un origen descuidado podría arrastrar estas claves: ningún mapeador público debe copiarlas
    receivedByStaffId: 'STAFF-ID-SECRETO',
    staffId: 'STAFF-ID-SECRETO',
    collectorName: 'Cajera Secreta',
    actorName: 'Cajera Secreta',
    confirmKeyHash: Buffer.alloc(32, 1),
    confirmRequestHash: Buffer.alloc(32, 2),
    collectionContext: 'BRANCH',
  };
  const FORBIDDEN =
    /receivedByStaffId|staffId|collectorName|actorName|Hash|hash|STAFF-ID|Cajera|collectionContext/;

  it('OrderDetail, OrderTracking y OrderReceipt', () => {
    const detail = toOrderDetail({
      ...buildOrderRecord(
        {
          orderId: 'o1',
          customerId: null,
          branchId: 'b',
          customerName: 'Ana',
          customerPhone: '55551234',
          customerEmail: null,
          fulfillmentType: 'PICKUP',
          deliveryProvider: null,
          notes: null,
          subtotal: '10.00',
          extrasTotal: '0.00',
          discountTotal: '0.00',
          deliveryFee: '0.00',
          total: '10.00',
          paymentMethodPreference: 'cash',
          address: null,
          lines: [],
          promotions: [],
          guestToken: null,
          itemCount: 0,
        },
        { orderNumber: 1n, placedAt: NOW, updatedAt: NOW },
      ),
      payment: dirty,
    });
    const tracking = toOrderTracking(
      {
        id: 'o1',
        orderNumber: 1n,
        branchId: 'b',
        fulfillmentType: 'PICKUP',
        deliveryProvider: null,
        status: 'pending',
        placedAt: NOW,
        updatedAt: NOW,
        payment: dirty,
        history: [],
      },
      NOW,
    );
    const receipt = toOrderReceipt(
      source({
        payment: { ...dirty, amount: '165.00', tendered: '200.00', change: '35.00' },
      }),
      NOW,
    );
    for (const payload of [detail, tracking, receipt]) {
      expect(JSON.stringify(payload)).not.toMatch(FORBIDDEN);
      expect(JSON.stringify(payload)).not.toContain('STAFF-ID-SECRETO');
    }
    expect(Object.keys(detail.payment).sort()).toEqual(['method', 'paidAt', 'status']);
    expect(Object.keys(tracking.payment).sort()).toEqual(['method', 'paidAt', 'status']);
    expect(Object.keys(receipt.payment).sort()).toEqual([
      'amountPaid',
      'change',
      'method',
      'paidAt',
      'status',
      'tendered',
    ]);
  });
});
