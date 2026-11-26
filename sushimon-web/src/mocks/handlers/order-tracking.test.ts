import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { OrderCreated } from '@/lib/data-access/models';
import { createHarness, type TestHarness } from '@/mocks/testing';
import { quoteCheckout } from '@/services/checkout';
import { advanceOrderDemo, createOrder, getOrder, getOrderTracking } from '@/services/orders';

/** F21 · mock de `GET /v1/orders/{id}/tracking`: forma real `OrderTracking` desde el historial del borrador, mismos errores. */
const cart = {
  branchId: 'sucursal-1',
  lines: [{ productId: 'dumplings', quantity: 2, selections: [] }],
};

async function place(
  h: TestHarness,
  key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
): Promise<OrderCreated> {
  const fulfillment = {
    type: 'DELIVERY',
    municipalityId: 'mun-guatemala-guatemala',
    zone: 'Zona 10',
  } as const;
  const quote = await quoteCheckout(h.client, { cart, fulfillment });
  return createOrder(
    h.client,
    {
      cart,
      fulfillment,
      deliveryAddress: { addressLine: '6a avenida 10-50', referenceNote: '' },
      quoteToken: quote.quote.token as string,
      contact: { fullName: 'Ana López', phone: '5555-1234' },
      paymentMethodPreference: 'cash',
    },
    key,
  );
}

async function error(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('se esperaba un error');
}

describe('F21 mock · getOrderTracking', () => {
  it('pedido recién creado: pending/received, un solo evento real, fases a domicilio, entrega propia aún sin estado', async () => {
    const h = createHarness();
    const created = await place(h);
    const t = await getOrderTracking(h.client, created.order.id, {
      guestToken: created.access?.guestToken,
    });
    expect(t).toMatchObject({
      orderId: created.order.id,
      displayNumber: created.order.displayNumber,
      branchId: 'sucursal-1',
      fulfillmentType: 'DELIVERY',
      status: 'pending',
      publicStatus: 'received',
      terminal: false,
      eventsTruncated: false,
      delivery: { provider: 'OWN', status: null },
      pollAfterSeconds: 15,
    });
    expect(t.events).toEqual([
      { seq: 1, status: 'pending', publicStatus: 'received', occurredAt: expect.any(String) },
    ]);
    expect(t.steps.map((s) => s.phase)).toEqual([
      'received',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'completed',
    ]);
    expect(t.steps.map((s) => s.reachedAt !== null)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    // Sin datos de más: ni contacto, importes, líneas, dirección ni notas.
    const json = JSON.stringify(t);
    for (const forbidden of [
      '5555',
      'Ana',
      'total',
      'lines',
      'phone',
      'address',
      'notes',
      'smo_',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('el avance de demostración alimenta el historial real; el estado terminal es delivered y pollAfterSeconds es null', async () => {
    const h = createHarness();
    const created = await place(h);
    const opts = { guestToken: created.access?.guestToken };
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await advanceOrderDemo(h.client, created.order.displayNumber);
      seen.push((await getOrderTracking(h.client, created.order.id, opts)).status);
    }
    expect(seen).toEqual(['accepted', 'preparing', 'ready', 'on_the_way', 'delivered']);
    const t = await getOrderTracking(h.client, created.order.id, opts);
    expect(t).toMatchObject({ publicStatus: 'completed', terminal: true, pollAfterSeconds: null });
    expect(t.events.map((e) => e.status)).toEqual([
      'pending',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'delivered',
    ]);
    expect(t.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t.steps.every((s) => s.reachedAt !== null)).toBe(true);
  });

  it('cancelado: el recorrido se corta (solo fases alcanzadas + cancelled)', async () => {
    const h = createHarness();
    const created = await place(h);
    await advanceOrderDemo(h.client, created.order.displayNumber); // accepted
    const draft = h.store.orders.find((o) => o.id === created.order.displayNumber)!;
    draft.status = 'cancelled';
    draft.history.push({
      at: '2026-11-18T19:00:00.000Z',
      kind: 'order',
      status: 'cancelled',
      reason: 'motivo interno',
      detail: null,
    });
    const t = await getOrderTracking(h.client, created.order.id, {
      guestToken: created.access?.guestToken,
    });
    expect(t).toMatchObject({ status: 'cancelled', publicStatus: 'cancelled', terminal: true });
    expect(t.steps.map((s) => s.phase)).toEqual(['received', 'accepted', 'cancelled']);
    expect(JSON.stringify(t)).not.toContain('motivo interno');
  });

  it('acceso: dueño por sesión o token; sin token, inválido, de otro pedido o ajeno => el MISMO 404 que getOrder', async () => {
    const h = createHarness();
    const created = await place(h);
    const other = await place(h, 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    const asGuest = await error(getOrderTracking(h.client, created.order.id));
    const byGet = await error(getOrder(h.client, created.order.id));
    expect(asGuest.status).toBe(404);
    expect(asGuest.message).toBe(byGet.message);
    expect(asGuest.businessCode).toBe(byGet.businessCode);
    const bad = await error(getOrderTracking(h.client, created.order.id, { guestToken: 'smo_x' }));
    const crossed = await error(
      getOrderTracking(h.client, created.order.id, { guestToken: other.access?.guestToken }),
    );
    const missing = await error(
      getOrderTracking(h.client, '00000000-0000-4000-8000-0000000000ff', { guestToken: 'smo_x' }),
    );
    for (const e of [bad, crossed, missing])
      expect([e.status, e.message]).toEqual([404, asGuest.message]);
  });

  it('un invitado con sesión de otro cliente tampoco ve pedidos de invitado (404)', async () => {
    const h = createHarness();
    const created = await place(h);
    h.asCustomer();
    expect((await error(getOrderTracking(h.client, created.order.id))).status).toBe(404);
  });

  it('fallos de prueba: 429 con Retry-After y 503 ORDERS_BUSY', async () => {
    const h = createHarness();
    const created = await place(h);
    const route = `GET /v1/orders/${created.order.id}/tracking`;
    (globalThis as { window?: unknown }).window = {
      __sushimonMockFaults: { [route]: ['rate-limited', 'busy'] },
    };
    try {
      const opts = { guestToken: created.access?.guestToken };
      const rate = await error(getOrderTracking(h.client, created.order.id, opts));
      expect([rate.status, rate.businessCode, rate.retryAfterSec]).toEqual([
        429,
        'RATE_LIMITED',
        2,
      ]);
      const busy = await error(getOrderTracking(h.client, created.order.id, opts));
      expect([busy.status, busy.businessCode]).toEqual([503, 'ORDERS_BUSY']);
      expect((await getOrderTracking(h.client, created.order.id, opts)).status).toBe('pending');
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
