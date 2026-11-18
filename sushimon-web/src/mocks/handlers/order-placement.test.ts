import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type {
  CheckoutQuoteRequest,
  OrderCreateRequest,
  OrderCreated,
} from '@/lib/data-access/models';
import { createHarness, markSoldOutEverywhere, type TestHarness } from '@/mocks/testing';
import { quoteCheckout } from '@/services/checkout';
import { createOrder, getDraftOrder, getOrder, prepareDraftCardOrder } from '@/services/orders';

/** F20 · mock de `POST /v1/orders` y `GET /v1/orders/{id}` (SIMULADO, paridad de forma y de errores con el contrato). */
const key = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;
const quoteReq = (over: Partial<CheckoutQuoteRequest> = {}): CheckoutQuoteRequest => ({
  cart: {
    branchId: 'sucursal-1',
    lines: [{ productId: 'dumplings', quantity: 2, selections: [] }],
  },
  fulfillment: { type: 'PICKUP' },
  ...over,
});
const contact = { fullName: 'Ana López', phone: '5555-1234' };

async function body(
  h: TestHarness,
  over: Partial<OrderCreateRequest> = {},
  q: CheckoutQuoteRequest = quoteReq(),
): Promise<OrderCreateRequest> {
  const quote = await quoteCheckout(h.client, q);
  return {
    cart: q.cart,
    fulfillment: q.fulfillment,
    quoteToken: quote.quote.token as string,
    contact,
    paymentMethodPreference: 'cash',
    ...over,
  };
}

async function fail(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('se esperaba un error');
}
const codeOf = (e: ApiError) => `${e.status}:${e.businessCode ?? ''}`;

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});
const faults = (f: Record<string, string[]>) => {
  (globalThis as { window?: unknown }).window = { __sushimonMockFaults: f };
};

describe('F20 mock · crear pedido', () => {
  it('recoger como invitado: forma real, estado pending, sin pago, teléfono enmascarado, credencial ficticia y pedido borrador enlazado', async () => {
    const h = createHarness();
    const created = await createOrder(h.client, await body(h), key(1));
    const { order, access } = created;
    expect(order).toMatchObject({
      status: 'pending',
      fulfillmentType: 'PICKUP',
      deliveryProvider: null,
      currency: 'GTQ',
      subtotal: '106.00',
      deliveryFee: '0.00',
      total: '106.00',
      address: null,
      contact: { fullName: 'Ana López', phoneMasked: '****1234' },
      payment: { methodPreference: 'cash', status: 'NOT_STARTED' },
    });
    expect(order.displayNumber).toMatch(/^MON-\d{6}$/);
    expect(order.lines[0]).toMatchObject({
      productName: expect.any(String),
      quantity: 2,
      lineTotal: '106.00',
    });
    expect(JSON.stringify(order)).not.toContain('5555');
    expect(access?.guestToken).toMatch(/^smo_[0-9a-f]{43}$/);
    // Borrador enlazado para el seguimiento/backoffice simulados.
    const draft = h.store.orders.find((o) => o.id === order.displayNumber);
    expect(draft).toMatchObject({ status: 'received', total: 106, fulfillment: 'pickup' });
    expect((await getDraftOrder(h.client, order.displayNumber)).id).toBe(order.displayNumber);
  });

  it('a domicilio con entrega propia: tarifa del servidor y snapshot de la dirección', async () => {
    const h = createHarness();
    const q = quoteReq({
      fulfillment: { type: 'DELIVERY', municipalityId: 'mun-guatemala-guatemala', zone: 'Zona 10' },
    });
    const b = await body(
      h,
      { deliveryAddress: { addressLine: '6a avenida 10-50', referenceNote: 'Portón negro' } },
      q,
    );
    const { order } = await createOrder(h.client, b, key(2));
    expect(order.fulfillmentType).toBe('DELIVERY');
    expect(order.deliveryProvider).toBe('OWN');
    expect(Number(order.deliveryFee)).toBeGreaterThan(0);
    expect(order.address).toEqual({
      municipalityName: 'Guatemala',
      zone: 'Zona 10',
      addressLine: '6a avenida 10-50',
      referenceNote: 'Portón negro',
    });
    expect(order.total).toBe((Number(order.subtotal) + Number(order.deliveryFee)).toFixed(2));
  });

  it('cliente con cuenta: sin credencial (access=null), contacto del perfil; una cuenta nueva sin teléfono => 422 CONTACT_INCOMPLETE', async () => {
    const h = createHarness();
    h.asCustomer();
    const mine = await createOrder(h.client, await body(h, { contact: undefined }), key(3));
    expect(mine.access).toBeNull();
    expect(mine.order.contact.phoneMasked).toMatch(/^\*{4}\d{4}$/);
    h.asCustomer('nueva@ejemplo.com');
    const b = await body(h, { contact: undefined });
    expect(codeOf(await fail(createOrder(h.client, b, key(4))))).toBe('422:CONTACT_INCOMPLETE');
    const ok = await createOrder(
      h.client,
      { ...b, contact: { fullName: 'Nueva', phone: '5555-1234' } },
      key(4),
    );
    expect(ok.access).toBeNull();
  });

  it('validaciones de forma (400) y reglas de negocio (422)', async () => {
    const h = createHarness();
    const b = await body(h);
    const cases: [string, unknown, string][] = [
      ['importes en el cuerpo', { ...b, total: '1.00' }, '400:'],
      ['campo desconocido', { ...b, status: 'paid' }, '400:'],
      ['invitado sin contacto', { ...b, contact: undefined }, '400:'],
      ['teléfono inválido', { ...b, contact: { fullName: 'Ana', phone: '123' } }, '400:'],
      ['notas largas', { ...b, notes: 'x'.repeat(281) }, '400:'],
      ['dirección con recoger', { ...b, deliveryAddress: { addressLine: 'x' } }, '400:'],
      ['tarjeta', { ...b, paymentMethodPreference: 'card' }, '422:PAYMENT_METHOD_UNAVAILABLE'],
      ['token ilegible', { ...b, quoteToken: 'basura' }, '422:QUOTE_INVALID'],
    ];
    for (const [name, payload, code] of cases) {
      expect(
        codeOf(await fail(createOrder(h.client, payload as OrderCreateRequest, key(5)))),
        name,
      ).toBe(code);
    }
    expect(h.store.placedOrders ?? []).toHaveLength(0);
  });

  it('IDEMPOTENCY_KEY_INVALID: ausente o mal formada', async () => {
    const h = createHarness();
    const b = await body(h);
    expect(codeOf(await fail(createOrder(h.client, b, 'corta')))).toBe(
      '400:IDEMPOTENCY_KEY_INVALID',
    );
    expect(codeOf(await fail(createOrder(h.client, b, '')))).toBe('400:IDEMPOTENCY_KEY_INVALID');
  });

  it('un token de invitado no sirve con sesión (sub distinto) => 422 QUOTE_INVALID', async () => {
    const h = createHarness();
    const b = await body(h);
    h.asCustomer();
    expect(codeOf(await fail(createOrder(h.client, b, key(6))))).toBe('422:QUOTE_INVALID');
  });
});

describe('F20 mock · idempotencia', () => {
  it('misma clave y mismo cuerpo => el MISMO pedido, sin duplicar; el invitado recibe un token nuevo y el anterior se revoca', async () => {
    const h = createHarness();
    const b = await body(h);
    const first = await createOrder(h.client, b, key(7));
    const drafts = h.store.orders.length;
    // Repetición aun con un token de cotización distinto y vencido: no se recotiza.
    h.clock.advance(11 * 60_000);
    const again = await createOrder(h.client, { ...b, quoteToken: 'otro-token' }, key(7));
    expect(again.order.id).toBe(first.order.id);
    expect(h.store.orders).toHaveLength(drafts);
    expect(again.access?.guestToken).not.toBe(first.access?.guestToken);
    expect(
      codeOf(
        await fail(getOrder(h.client, first.order.id, { guestToken: first.access!.guestToken })),
      ),
    ).toBe('404:');
    expect(
      (await getOrder(h.client, first.order.id, { guestToken: again.access!.guestToken })).id,
    ).toBe(first.order.id);
  });

  it('misma clave con otros productos => 409 IDEMPOTENCY_KEY_REUSED y no crea nada', async () => {
    const h = createHarness();
    await createOrder(h.client, await body(h), key(8));
    const other = quoteReq({
      cart: {
        branchId: 'sucursal-1',
        lines: [{ productId: 'dumplings', quantity: 3, selections: [] }],
      },
    });
    const e = await fail(createOrder(h.client, await body(h, {}, other), key(8)));
    expect(codeOf(e)).toBe('409:IDEMPOTENCY_KEY_REUSED');
    expect(h.store.placedOrders).toHaveLength(1);
  });

  it('el ámbito forma parte de la clave: invitado y cuenta con la misma clave son pedidos distintos', async () => {
    const h = createHarness();
    const g = await createOrder(h.client, await body(h), key(9));
    h.asCustomer();
    const c = await createOrder(
      h.client,
      await body(h, { contact: { fullName: 'Prueba', phone: '5555-1234' } }),
      key(9),
    );
    expect(c.order.id).not.toBe(g.order.id);
  });

  it('pérdida de respuesta (fallo lost-response): el servidor crea el pedido, el cliente ve «sin conexión» y el reintento con la misma clave devuelve el mismo', async () => {
    const h = createHarness();
    const b = await body(h);
    faults({ 'POST /v1/orders': ['lost-response'] });
    const lost = await fail(createOrder(h.client, b, key(10)));
    expect(lost.status).toBe(0);
    expect(h.store.placedOrders).toHaveLength(1);
    const again = await createOrder(h.client, b, key(10));
    expect(again.order.id).toBe(h.store.placedOrders![0]!.detail.id);
    expect(h.store.placedOrders).toHaveLength(1);
  });
});

describe('F20 mock · cotización: QUOTE_CHANGED / QUOTE_EXPIRED / CHECKOUT_BLOCKED', () => {
  it('cambio de precio (aunque sea una mejora) => 409 QUOTE_CHANGED con cambios y cotización nueva; con el token nuevo y otra clave se crea', async () => {
    const h = createHarness();
    const b = await body(h);
    h.store.branchProducts.push({
      branchId: 'sucursal-1',
      productId: 'dumplings',
      priceOverride: '50.00',
      available: true,
      updatedAt: '2026-11-11T00:00:00.000Z',
    });
    const e = await fail(createOrder(h.client, b, key(11)));
    expect(codeOf(e)).toBe('409:QUOTE_CHANGED');
    const conflict = e.body as {
      changes: { field: string; previous: string; current: string }[];
      quote: { total: string; quote: { token: string } };
    };
    expect(conflict.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['subtotal', 'total', 'lines']),
    );
    expect(conflict.changes.find((c) => c.field === 'total')).toMatchObject({
      previous: '106.00',
      current: '100.00',
    });
    expect(conflict.quote.total).toBe('100.00');
    expect(h.store.placedOrders ?? []).toHaveLength(0);
    const ok = await createOrder(
      h.client,
      { ...b, quoteToken: conflict.quote.quote.token },
      key(12),
    );
    expect(ok.order.total).toBe('100.00');
  });

  it('fallo price-change: sube el precio y reproduce QUOTE_CHANGED de forma natural', async () => {
    const h = createHarness();
    const b = await body(h);
    faults({ 'POST /v1/orders': ['price-change'] });
    const e = await fail(createOrder(h.client, b, key(13)));
    expect(codeOf(e)).toBe('409:QUOTE_CHANGED');
    expect((e.body as { quote: { total: string } }).quote.total).toBe('108.00');
  });

  it('cotización vencida (reloj) => 409 QUOTE_EXPIRED con la cotización nueva y sin cambios', async () => {
    const h = createHarness();
    const b = await body(h);
    h.clock.advance(10 * 60_000 + 1);
    const e = await fail(createOrder(h.client, b, key(14)));
    expect(codeOf(e)).toBe('409:QUOTE_EXPIRED');
    expect((e.body as { changes: unknown[]; quote: { quote: { token: string } } }).changes).toEqual(
      [],
    );
    expect((e.body as { quote: { quote: { token: string } } }).quote.quote.token).toMatch(
      /^mockq\./,
    );
  });

  it('producto agotado tras cotizar => 422 CHECKOUT_BLOCKED con los bloqueos', async () => {
    const h = createHarness();
    const b = await body(h);
    markSoldOutEverywhere(h.store, 'dumplings');
    const e = await fail(createOrder(h.client, b, key(15)));
    expect(codeOf(e)).toBe('422:CHECKOUT_BLOCKED');
    expect((e.body as { blockers: { scope: string }[] }).blockers[0]?.scope).toBe('LINE');
  });

  it('PedidosYa elegido => nunca se crea (la cotización lo bloquea)', async () => {
    const h = createHarness();
    const q = quoteReq({
      fulfillment: {
        type: 'DELIVERY',
        municipalityId: 'mun-guatemala-guatemala',
        zone: 'Zona 10',
        deliveryProvider: 'PEDIDOSYA',
      },
    });
    const quote = await quoteCheckout(h.client, q);
    expect(quote.quote.token).toBeNull();
    const e = await fail(
      createOrder(
        h.client,
        {
          cart: q.cart,
          fulfillment: q.fulfillment,
          quoteToken: 'mockq.x',
          contact,
          deliveryAddress: { addressLine: 'Calle 1' },
        },
        key(16),
      ),
    );
    expect(e.status).toBe(422);
    expect(h.store.placedOrders ?? []).toHaveLength(0);
  });
});

describe('F20 mock · fallos reproducibles de la capa', () => {
  it.each([
    ['busy', 503, 'ORDERS_BUSY', undefined],
    ['unavailable', 503, 'ORDERS_UNAVAILABLE', undefined],
    ['rate-limited', 429, 'RATE_LIMITED', 2],
    ['expired', 409, 'QUOTE_EXPIRED', undefined],
  ])('%s => %s %s', async (fault, status, code, retryAfter) => {
    const h = createHarness();
    const b = await body(h);
    faults({ 'POST /v1/orders': [fault] });
    const e = await fail(createOrder(h.client, b, key(17)));
    expect(e.status).toBe(status);
    expect(e.businessCode).toBe(code);
    expect(e.retryAfterSec).toBe(retryAfter);
    expect(h.store.placedOrders ?? []).toHaveLength(0);
    // El fallo se consume una vez: el siguiente intento procede.
    expect((await createOrder(h.client, b, key(17))).order.status).toBe('pending');
  });

  it('tope de pedidos pendientes por teléfono => 429 PENDING_ORDERS_LIMIT', async () => {
    const h = createHarness();
    for (let i = 0; i < 3; i++) await createOrder(h.client, await body(h), key(20 + i));
    const e = await fail(createOrder(h.client, await body(h), key(30)));
    expect(codeOf(e)).toBe('429:PENDING_ORDERS_LIMIT');
  });
});

describe('F20 mock · GET /v1/orders/{id}: dueño o credencial, 404 idéntico', () => {
  it('con la credencial vigente OK; sin ella, con otra, de otro pedido o sin sesión: el MISMO 404', async () => {
    const h = createHarness();
    const a = await createOrder(h.client, await body(h), key(40));
    h.clock.advance(1000);
    const b2 = await createOrder(h.client, await body(h), key(41));
    expect((await getOrder(h.client, a.order.id, { guestToken: a.access!.guestToken })).id).toBe(
      a.order.id,
    );
    const denied = [
      await fail(getOrder(h.client, a.order.id)),
      await fail(getOrder(h.client, a.order.id, { guestToken: 'smo_' + 'x'.repeat(43) })),
      await fail(getOrder(h.client, a.order.id, { guestToken: b2.access!.guestToken })),
      await fail(
        getOrder(h.client, '00000000-0000-4000-8000-000000009999', {
          guestToken: a.access!.guestToken,
        }),
      ),
    ];
    for (const e of denied) expect([e.status, e.message]).toEqual([404, 'Pedido no encontrado']);
    // Vencida (14 días).
    h.clock.advance(15 * 24 * 3600_000);
    expect(
      (await fail(getOrder(h.client, a.order.id, { guestToken: a.access!.guestToken }))).status,
    ).toBe(404);
  });

  it('el dueño por sesión lo ve; otro cliente o un invitado no; un cliente no ve con su sesión un pedido de invitado', async () => {
    const h = createHarness();
    h.asCustomer();
    const mine = await createOrder(h.client, await body(h, { contact }), key(50));
    expect((await getOrder(h.client, mine.order.id)).id).toBe(mine.order.id);
    h.asCustomer('otra@ejemplo.com');
    expect((await fail(getOrder(h.client, mine.order.id))).status).toBe(404);
    h.asCustomer(null);
    expect((await fail(getOrder(h.client, mine.order.id))).status).toBe(404);
    const guest = await createOrder(h.client, await body(h), key(51));
    h.asCustomer();
    expect((await fail(getOrder(h.client, guest.order.id))).status).toBe(404);
  });
});

describe('F20 mock · pasarela NeoNet simulada sobre el pedido borrador', () => {
  it('prepareDraftCardOrder marca el borrador para tarjeta (pendiente de pago) y un segundo pedido del mismo teléfono cancela el abandonado', async () => {
    const h = createHarness();
    const first: OrderCreated = await createOrder(h.client, await body(h), key(60));
    const draft = await prepareDraftCardOrder(h.client, first.order.displayNumber);
    expect(draft.payment).toMatchObject({ method: 'card', status: 'pending' });
    await createOrder(h.client, await body(h), key(61));
    expect(h.store.orders.find((o) => o.id === first.order.displayNumber)?.status).toBe(
      'cancelled',
    );
    expect(h.store.placedOrders!.find((p) => p.detail.id === first.order.id)?.detail.status).toBe(
      'cancelled',
    );
  });
});
