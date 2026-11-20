import { afterEach, describe, expect, it } from 'vitest';
import type {
  AdminCashPaymentResult,
  AdminOrderDetail,
  AdminOrderPage,
  AdminOrderPayment,
  AdminOrderTransitionResult,
  AdminPaymentHistory,
  OrderReceipt,
  OrderTracking,
} from '@/lib/data-access/models';
import { createHarness, type TestHarness } from '../testing';

/** F24 (spec 025 §13 #8–#31, #33, #38–#39, #57): el mock responde las MISMAS rutas con la forma y las reglas del servidor. */

const PICKUP = 'MON-307057'; // PICKUP · sucursal 1 · pendiente de aceptación
const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const KEY2 = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002';

const as = (role: Parameters<TestHarness['asStaff']>[0]) => {
  const h = createHarness();
  h.asStaff(role);
  return h;
};
const payment = (h: TestHarness, id = PICKUP) =>
  h.client.get<AdminOrderPayment>(`/v1/admin/orders/${id}/payment`);
const register = (
  h: TestHarness,
  body: unknown,
  key: string | null = KEY,
  id = PICKUP,
): Promise<AdminCashPaymentResult> =>
  h.client.post<AdminCashPaymentResult>(`/v1/admin/orders/${id}/payment/cash`, body, {
    headers: key ? { 'Idempotency-Key': key } : undefined,
  });
const ok = (tendered: string) => ({ tendered, receivedConfirmed: true });
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error as { status: number; businessCode?: string; body?: Record<string, unknown> };
  }
  throw new Error('se esperaba un error');
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('GET /v1/admin/orders/:id/payment', () => {
  it('pedido nuevo: CASH PENDING, deuda, pendiente, contexto BRANCH y registro permitido (solo con payments.confirm)', async () => {
    const p = await payment(as('admin'));
    expect(p).toMatchObject({
      method: 'CASH',
      status: 'PENDING',
      outstanding: p.amountDue,
      paidAt: null,
      possibleRefundReview: false,
      registration: { allowed: true, blockedReason: null },
      orderId: PICKUP,
      displayNumber: PICKUP,
      orderStatus: 'pending',
      fulfillmentType: 'PICKUP',
      currency: 'GTQ',
      collectionContext: 'BRANCH',
      reception: null,
    });
    expect(p.amountDue).toMatch(/^\d+\.\d{2}$/);
  });

  it('sin payments.read (encargado) → 403; sin sesión → 401', async () => {
    await expect(payment(as('manager'))).rejects.toMatchObject({ status: 403 });
    await expect(payment(createHarness())).rejects.toMatchObject({ status: 401 });
  });

  it('pedido inexistente → 404 ORDER_NOT_FOUND', async () => {
    await expect(payment(as('admin'), 'MON-999999')).rejects.toMatchObject({
      status: 404,
      businessCode: 'ORDER_NOT_FOUND',
    });
  });
});

describe('POST /v1/admin/orders/:id/payment/cash', () => {
  it('pago exacto: cambio 0.00 e ingreso = deuda; luego PAID con la recepción del servidor', async () => {
    const h = as('admin');
    const due = (await payment(h)).amountDue;
    const r = await register(h, ok(due));
    expect(r).toMatchObject({ replayed: false, appliedByMe: true });
    expect(r.payment).toMatchObject({
      status: 'PAID',
      outstanding: '0.00',
      registration: { allowed: false, blockedReason: 'ALREADY_PAID' },
      reception: {
        amountApplied: due,
        tendered: due,
        change: '0.00',
        collectorType: 'STAFF',
        context: 'BRANCH',
      },
    });
    expect(r.payment.paidAt).toBe(r.payment.reception?.receivedAt);
  });

  it('con cambio: 200.00 sobre un total menor → cambio calculado en centavos enteros; el ingreso sigue siendo la deuda', async () => {
    const h = as('admin');
    const due = (await payment(h)).amountDue;
    const r = await register(h, ok('500.00'));
    const cents = Math.round(Number(due) * 100);
    expect(r.payment.reception?.amountApplied).toBe(due);
    expect(r.payment.reception?.tendered).toBe('500.00');
    expect(Math.round(Number(r.payment.reception?.change) * 100)).toBe(50000 - cents);
    expect(r.payment.amountDue).toBe(due);
  });

  it('insuficiente → 422 CASH_AMOUNT_INSUFFICIENT y NO escribe; tope 5000.00 sí, 5000.01 no', async () => {
    const h = as('admin');
    const due = Math.round(Number((await payment(h)).amountDue) * 100);
    const short = `${Math.floor((due - 1) / 100)}.${String((due - 1) % 100).padStart(2, '0')}`;
    expect(await fails(register(h, ok(short)))).toMatchObject({
      status: 422,
      businessCode: 'CASH_AMOUNT_INSUFFICIENT',
    });
    expect((await payment(h)).status).toBe('PENDING');
    expect(await fails(register(h, ok('5000.01')))).toMatchObject({
      status: 422,
      businessCode: 'CASH_TENDERED_TOO_LARGE',
    });
    expect((await register(h, ok('5000.00'))).payment.status).toBe('PAID');
  });

  it.each([
    ['negativo', '-5'],
    ['cero', '0'],
    ['cero decimal', '0.00'],
    ['vacío', ''],
    ['texto', 'abc'],
    ['científica', '1e2'],
    ['miles', '1,000.00'],
    ['NaN', 'NaN'],
    ['3 decimales (sin redondeo)', '200.001'],
  ])('tendered %s (%j) → 400 PAYMENT_AMOUNT_INVALID', async (_n, tendered) => {
    expect(await fails(register(as('admin'), ok(tendered)))).toMatchObject({
      status: 400,
      businessCode: 'PAYMENT_AMOUNT_INVALID',
    });
  });

  it('receivedConfirmed ausente/false → 400 PAYMENT_CONFIRMATION_REQUIRED; campos ajenos (staff, cambio, fecha, sucursal) → 400', async () => {
    const h = as('admin');
    expect(await fails(register(h, { tendered: '500.00' }))).toMatchObject({
      status: 400,
      businessCode: 'PAYMENT_CONFIRMATION_REQUIRED',
    });
    expect(
      await fails(register(h, { tendered: '500.00', receivedConfirmed: false })),
    ).toMatchObject({ businessCode: 'PAYMENT_CONFIRMATION_REQUIRED' });
    for (const extra of ['staffId', 'change', 'receivedAt', 'branchId', 'collectorType']) {
      expect(await fails(register(h, { ...ok('500.00'), [extra]: 'x' }))).toMatchObject({
        status: 400,
      });
    }
    expect((await payment(h)).status).toBe('PENDING');
  });

  it('Idempotency-Key ausente o malformada → 400 IDEMPOTENCY_KEY_INVALID', async () => {
    const h = as('admin');
    for (const key of [null, 'corta', 'tiene espacios y símbolos!!!!!!!!!!']) {
      expect(await fails(register(h, ok('500.00'), key))).toMatchObject({
        status: 400,
        businessCode: 'IDEMPOTENCY_KEY_INVALID',
      });
    }
  });

  it('doble clic / reintento: misma clave y mismo cuerpo → replayed con la recepción original y UN solo cobro', async () => {
    const h = as('admin');
    const first = await register(h, ok('500.00'));
    const again = await register(h, ok('500'));
    expect(again).toMatchObject({ replayed: true, appliedByMe: true });
    expect(again.payment.reception).toEqual(first.payment.reception);
    expect(Object.keys(h.store.cashPayments ?? {})).toEqual([PICKUP]);
    const history = await h.client.get<AdminPaymentHistory>(
      `/v1/admin/orders/${PICKUP}/payment/history`,
    );
    expect(history.items.map((e) => e.type)).toEqual(['CREATED', 'CASH_RECEIVED']);
  });

  it('misma clave con OTRO importe → 409 IDEMPOTENCY_KEY_REUSED; otra clave tras cobrar → 409 PAYMENT_ALREADY_REGISTERED con `current` y sin cobrar de nuevo', async () => {
    const h = as('admin');
    const first = await register(h, ok('500.00'));
    expect(await fails(register(h, ok('600.00')))).toMatchObject({
      status: 409,
      businessCode: 'IDEMPOTENCY_KEY_REUSED',
    });
    const conflict = await fails(register(h, ok('500.00'), KEY2));
    expect(conflict).toMatchObject({ status: 409, businessCode: 'PAYMENT_ALREADY_REGISTERED' });
    expect((conflict.body?.current as AdminOrderPayment).reception).toEqual(
      first.payment.reception,
    );
    expect(h.store.cashPayments?.[PICKUP]?.tendered).toBe('500.00');
  });

  it('la recepción es de OTRA persona: appliedByMe=false en la repetición', async () => {
    const h = as('admin');
    await h.client.post(`/v1/admin/orders/${PICKUP}/payment/cash`, ok('500.00'), {
      headers: { 'Idempotency-Key': KEY },
    });
    h.store.cashPayments![PICKUP]!.collectorId = 'otra-persona';
    expect(await register(h, ok('500.00'))).toMatchObject({ replayed: true, appliedByMe: false });
  });

  it('sin payments.confirm → 403; sin sesión → 401', async () => {
    expect(await fails(register(as('manager'), ok('500.00')))).toMatchObject({ status: 403 });
    expect(await fails(register(createHarness(), ok('500.00')))).toMatchObject({ status: 401 });
  });

  it('pedido inexistente → 404', async () => {
    expect(await fails(register(as('admin'), ok('500.00'), KEY, 'MON-999999'))).toMatchObject({
      status: 404,
      businessCode: 'ORDER_NOT_FOUND',
    });
  });

  it('registrar NO cambia el estado del pedido ni lo avanza; ninguna transición lo marca PAID', async () => {
    const h = as('admin');
    await register(h, ok('500.00'));
    const detail = await h.client.get<AdminOrderDetail>(`/v1/admin/orders/${PICKUP}`);
    expect(detail.status).toBe('pending');
    expect(detail.payment.status).toBe('PAID');
    // Un PICKUP puede completarse con pago PENDING y nada lo marca PAID.
    const other = 'MON-307054';
    const before = await payment(h, other);
    for (const [command, expected] of [
      ['accept', 'pending'],
      ['start-preparing', 'accepted'],
      ['mark-ready', 'preparing'],
      ['complete', 'ready'],
    ] as const) {
      const d = await h.client.get<AdminOrderDetail>(`/v1/admin/orders/${other}`);
      if (d.fulfillmentType !== 'PICKUP') break;
      await h.client.post<AdminOrderTransitionResult>(`/v1/admin/orders/${other}/${command}`, {
        expectedStatus: expected,
      });
    }
    expect((await payment(h, other)).status).toBe(before.status);
    expect(h.store.cashPayments?.[other]).toBeUndefined();
  });
});

describe('cancelado/rechazado y «posible devolución pendiente»', () => {
  it('SIN cobro: rechazar → pendingActions [] y registrar → 409 ORDER_NOT_PAYABLE (pago sigue PENDING)', async () => {
    const h = as('admin');
    const r = await h.client.post<AdminOrderTransitionResult>(`/v1/admin/orders/${PICKUP}/reject`, {
      expectedStatus: 'pending',
      reason: 'Producto agotado',
    });
    expect(r.pendingActions).toEqual([]);
    const p = await payment(h);
    expect(p).toMatchObject({
      status: 'PENDING',
      possibleRefundReview: false,
      registration: { allowed: false, blockedReason: 'ORDER_CLOSED' },
    });
    const conflict = await fails(register(h, ok('500.00')));
    expect(conflict).toMatchObject({ status: 409, businessCode: 'ORDER_NOT_PAYABLE' });
    expect((conflict.body?.current as AdminOrderPayment).status).toBe('PENDING');
  });

  it('CON cobro: cancelar → pendingActions [payment_review]; el pago sigue PAID con possibleRefundReview', async () => {
    const h = as('admin');
    await register(h, ok('500.00'));
    const r = await h.client.post<AdminOrderTransitionResult>(`/v1/admin/orders/${PICKUP}/cancel`, {
      expectedStatus: 'pending',
      reason: 'El cliente lo pidió',
    });
    expect(r.pendingActions).toEqual(['payment_review']);
    const p = await payment(h);
    expect(p).toMatchObject({ status: 'PAID', possibleRefundReview: true });
    const detail = await h.client.get<AdminOrderDetail>(`/v1/admin/orders/${PICKUP}`);
    expect(detail.payment).toMatchObject({ status: 'PAID', possibleRefundReview: true });
  });
});

describe('historial, tablero y vistas del cliente', () => {
  it('historial CREATED → CASH_RECEIVED con nombre del actor y montos; sin ids ni claves', async () => {
    const h = as('admin');
    await register(h, ok('500.00'));
    const history = await h.client.get<AdminPaymentHistory>(
      `/v1/admin/orders/${PICKUP}/payment/history`,
    );
    expect(history.items[0]).toMatchObject({ seq: 1, type: 'CREATED', actorName: null });
    expect(history.items[1]).toMatchObject({
      seq: 2,
      type: 'CASH_RECEIVED',
      tendered: '500.00',
    });
    expect(history.items[1]?.actorName).toBeTruthy();
    expect(JSON.stringify(history)).not.toMatch(/collectorId|key|hash/i);
    await expect(
      as('manager').client.get(`/v1/admin/orders/${PICKUP}/payment/history`),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('listado/tablero: paymentStatus real por pedido (PENDING→PAID)', async () => {
    const h = as('admin');
    const before = await h.client.get<AdminOrderPage>('/v1/admin/orders', {
      query: { limit: '50' },
    });
    expect(before.items.find((o) => o.id === PICKUP)?.paymentStatus).toBe('PENDING');
    await register(h, ok('500.00'));
    const after = await h.client.get<AdminOrderPage>('/v1/admin/orders', {
      query: { limit: '50' },
    });
    expect(after.items.find((o) => o.id === PICKUP)?.paymentStatus).toBe('PAID');
  });

  it('el cliente ve el mismo pago REAL en detalle, seguimiento y recibo (sin empleado)', async () => {
    const h = createHarness();
    h.asCustomer();
    const mine = await h.client.get<{ items: { id: string; displayNumber: string }[] }>(
      '/v1/me/orders',
    );
    const order = mine.items[0]!;
    const draftId = order.displayNumber;
    const pendingReceipt = await h.client.get<OrderReceipt>(`/v1/orders/${order.id}/receipt`);
    expect(pendingReceipt.payment).toEqual({
      method: 'CASH',
      status: 'PENDING',
      paidAt: null,
      amountPaid: null,
      tendered: null,
      change: null,
    });
    h.store.cashPayments = {
      [draftId]: {
        amountApplied: pendingReceipt.total,
        tendered: '500.00',
        change: '400.00',
        receivedAt: '2026-11-11T20:00:00.000Z',
        collectorId: 'x',
        collectorName: 'Nombre Secreto',
        context: 'BRANCH',
        key: KEY,
        requestHash: 'h',
      },
    };
    const paid = await h.client.get<OrderReceipt>(`/v1/orders/${order.id}/receipt`);
    expect(paid.payment).toMatchObject({
      status: 'PAID',
      tendered: '500.00',
      change: '400.00',
      paidAt: '2026-11-11T20:00:00.000Z',
    });
    const tracking = await h.client.get<OrderTracking>(`/v1/orders/${order.id}/tracking`);
    expect(tracking.payment).toEqual({
      method: 'CASH',
      status: 'PAID',
      paidAt: '2026-11-11T20:00:00.000Z',
    });
    // El pago no entra al timeline operativo ni se filtra el empleado.
    expect(JSON.stringify(tracking.steps) + JSON.stringify(tracking.events)).not.toMatch(
      /PAID|payment|efectivo/i,
    );
    expect(JSON.stringify([paid, tracking])).not.toMatch(/Nombre Secreto|collector/i);
  });
});

describe('fallos de prueba', () => {
  const setFaults = (faults: Record<string, string[]>) => {
    (globalThis as { window?: unknown }).window = { __sushimonMockFaults: faults };
  };

  it('payment-already-registered: otra persona cobró justo antes → 409 con current y sin pisar su cobro', async () => {
    const h = as('admin');
    setFaults({ [`POST /v1/admin/orders/${PICKUP}/payment/cash`]: ['payment-already-registered'] });
    const conflict = await fails(register(h, ok('500.00')));
    expect(conflict).toMatchObject({ status: 409, businessCode: 'PAYMENT_ALREADY_REGISTERED' });
    expect((conflict.body?.current as AdminOrderPayment).reception?.collectorName).toBe(
      'Otra persona',
    );
  });

  it('payment-busy → 503 ORDERS_BUSY (Retry-After) y NO cobra; luego la misma clave funciona', async () => {
    const h = as('admin');
    setFaults({ [`POST /v1/admin/orders/${PICKUP}/payment/cash`]: ['payment-busy'] });
    expect(await fails(register(h, ok('500.00')))).toMatchObject({
      status: 503,
      businessCode: 'ORDERS_BUSY',
    });
    expect(h.store.cashPayments?.[PICKUP]).toBeUndefined();
    expect((await register(h, ok('500.00'))).replayed).toBe(false);
  });

  it('lost-response: el cobro se persiste pero la respuesta se pierde; el reintento con la MISMA clave responde replayed', async () => {
    const h = as('admin');
    setFaults({ [`POST /v1/admin/orders/${PICKUP}/payment/cash`]: ['lost-response'] });
    expect(await fails(register(h, ok('500.00')))).toMatchObject({ status: 0 });
    expect(h.store.cashPayments?.[PICKUP]).toBeDefined();
    expect(await register(h, ok('500.00'))).toMatchObject({ replayed: true, appliedByMe: true });
  });
});
