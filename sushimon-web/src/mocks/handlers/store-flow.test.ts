import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { CreateOrderRequest, Order } from '@/lib/data-access/models';
import * as orders from '@/services/orders';
import { getBranchAvailability } from '@/services/branch-schedule';
import * as branchProducts from '@/services/branch-products';
import * as products from '@/services/products';
import * as store from '@/services/store';
import { createHarness } from '../testing';

const customer = { name: 'Ana Prueba', phone: '5555-0000', email: 'ana@ejemplo.com' };

const deliveryOrder = (over: Partial<CreateOrderRequest> = {}): CreateOrderRequest => ({
  fulfillment: 'delivery',
  schedule: { kind: 'now' },
  customer,
  address: {
    department: 'Guatemala',
    municipality: 'Guatemala',
    zone: '10',
    line: '6a avenida 10-50',
    references: '',
  },
  lines: [
    { productId: 'california-roll', quantity: 2, note: 'Sin pepino' },
    { productId: 'te-lipton', quantity: 1 },
  ],
  paymentMethod: 'cash',
  ...over,
});

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('se esperaba ApiError');
}

describe('datos públicos', () => {
  it('config incluye serverTime del reloj y reglas de programación', async () => {
    const { client } = createHarness();
    const config = await store.getStoreConfig(client);
    expect(config.serverTime).toBe('2026-11-11T20:25:00.000Z');
    expect(config.schedule).toEqual({
      stepMinutes: 30,
      lastOrderBeforeClose: 30,
      minLeadMinutes: 45,
      days: 7,
    });
    // F09: los niveles/ETA del borrador se retiraron; tarifa y cobertura salen de las zonas propias (checkDeliveryCoverage).
    expect(config.deliveryTiers).toEqual([]);
    expect(config.departments).toEqual([]);
  });

  it('sucursales: 3 activas abiertas ahora y 2 próximamente', async () => {
    const { client } = createHarness();
    const branches = await store.listBranches(client);
    const open: string[] = [];
    for (const b of branches.filter((x) => x.status === 'active')) {
      if ((await getBranchAvailability(client, b.id)).isOpenNow) open.push(b.id);
    }
    expect(open).toEqual(['sucursal-1', 'sucursal-2', 'sucursal-3']);
    expect(branches.filter((b) => b.status === 'coming_soon')).toHaveLength(2);
  });

  it('catálogo F11: lista pública (solo visibles) y extras simulados por sucursal', async () => {
    const { client } = createHarness();
    const all = await products.listAllStoreProducts(client);
    // 29 del menú; los 2 de demostración (inactivo y bajo categoría oculta) no se publican.
    expect(all).toHaveLength(29);
    const rolls = await products.listStoreProducts(client, { categorySlug: 'rolls' });
    expect(rolls.items.length).toBeGreaterThan(0);
    expect(
      rolls.items.every((p) => ['rolls', 'rolls-frios', 'rolls-tempura'].includes(p.category.slug)),
    ).toBe(true);
    const s3 = await branchProducts.getStoreBranchMenu(client, { branchId: 'sucursal-3' });
    expect(s3.items.find((p) => p.productId === 'joselito-roll')?.available).toBe(false);
    expect(s3.items.find((p) => p.productId === 'california-roll')?.available).toBe(true);
    expect(
      (await apiError(branchProducts.getStoreBranchMenu(client, { branchId: 'zzz' }))).status,
    ).toBe(404);
  });

  it('postulación válida y errores de validación', async () => {
    const { client } = createHarness();
    const ok = await store.submitJobApplication(client, {
      name: 'Ana López',
      email: 'ana.lopez@ejemplo.com',
      phone: '5555-6789',
      position: 'mesero',
      experience: 'y1to3',
      message: '',
      consent: true,
      cvFileName: 'CV.pdf',
      cvSizeBytes: 1000,
    });
    expect(ok).toMatchObject({ id: 'JOB-0001', status: 'received' });
    const bad = await apiError(
      store.submitJobApplication(client, {
        name: 'An',
        email: 'x',
        phone: '1',
        position: '',
        experience: 'none',
        consent: false,
        cvFileName: 'cv.doc',
        cvSizeBytes: 1,
      }),
    );
    expect(bad).toMatchObject({ status: 400, code: 'bad_request' });
  });
});

describe('crear pedido', () => {
  it('calcula precios y totales en el "servidor"', async () => {
    const { client } = createHarness();
    const order = await orders.createOrder(client, deliveryOrder());
    expect(order.id).toBe('MON-307059');
    expect(order.status).toBe('received');
    expect(order.lines[0]).toMatchObject({ unitPrice: 57, subtotal: 114, note: 'Sin pepino' });
    expect(order.subtotal).toBe(136);
    expect(order).toMatchObject({ deliveryFee: 15, total: 151, branchId: 'sucursal-1' });
    expect(order.payment).toMatchObject({ method: 'cash', status: 'pending', amount: 151 });
    // El invitado que lo creó puede verlo en la misma sesión.
    expect((await orders.getOrder(client, order.id)).id).toBe(order.id);
  });

  it('valida entradas (400/404/409/422)', async () => {
    const { client } = createHarness();
    const cases: [Partial<CreateOrderRequest>, number][] = [
      [{ lines: [] }, 400],
      [{ lines: [{ productId: 'california-roll', quantity: 100 }] }, 400],
      [{ lines: [{ productId: 'california-roll', quantity: 0 }] }, 400],
      [{ customer: { ...customer, phone: '123' } }, 400],
      [{ lines: [{ productId: 'no-existe', quantity: 1 }] }, 422],
      [{ address: { ...deliveryOrder().address!, zone: '' } }, 400],
      [
        {
          address: {
            department: 'Escuintla',
            municipality: 'Escuintla',
            zone: '',
            line: 'Calle 1',
            references: '',
          },
        },
        422,
      ],
      [{ fulfillment: 'pickup', address: undefined }, 400],
      [{ fulfillment: 'pickup', branchId: 'sucursal-4', address: undefined }, 422],
      [{ schedule: { kind: 'scheduled', date: '2026-11-11', time: '14:30' } }, 422],
    ];
    for (const [over, status] of cases) {
      expect((await apiError(orders.createOrder(client, deliveryOrder(over)))).status).toBe(status);
    }
    // Producto sin stock en la sucursal → 409
    const e = await apiError(
      orders.createOrder(
        client,
        deliveryOrder({
          fulfillment: 'pickup',
          branchId: 'sucursal-3',
          address: undefined,
          lines: [{ productId: 'joselito-roll', quantity: 1 }],
        }),
      ),
    );
    expect(e.status).toBe(409);
  });

  it('programado válido (≥45 min, dentro del horario)', async () => {
    const { client } = createHarness();
    const order = await orders.createOrder(
      client,
      deliveryOrder({ schedule: { kind: 'scheduled', date: '2026-11-11', time: '15:30' } }),
    );
    expect(order.schedule).toEqual({ kind: 'scheduled', date: '2026-11-11', time: '15:30' });
  });

  it('branch-closed: no permite "ahora" pero sí programar', async () => {
    const { client } = createHarness('branch-closed');
    expect((await apiError(orders.createOrder(client, deliveryOrder()))).status).toBe(409);
    const ok = await orders.createOrder(
      client,
      deliveryOrder({ schedule: { kind: 'scheduled', date: '2026-11-12', time: '13:00' } }),
    );
    expect(ok.status).toBe('received');
  });

  it('product-unavailable: rechaza los productos marcados', async () => {
    const { client } = createHarness('product-unavailable');
    const e = await apiError(
      orders.createOrder(
        client,
        deliveryOrder({ lines: [{ productId: 'calientito-roll', quantity: 1 }] }),
      ),
    );
    expect(e.status).toBe(409);
  });

  it('un pedido creado en la tienda aparece en el backoffice', async () => {
    const h = createHarness();
    const order = await orders.createOrder(h.client, deliveryOrder());
    h.asStaff('admin');
    const list = await h.client.get<Order[]>('/v1/backoffice/orders');
    expect(list.map((o) => o.id)).toContain(order.id);
  });
});

describe('consulta, seguimiento e incidencias', () => {
  it('lookup con número + teléfono; mismo 404 si no coincide', async () => {
    const { client } = createHarness();
    expect((await apiError(orders.getOrder(client, 'MON-490217'))).status).toBe(404);
    const o = await orders.lookupOrder(client, { orderNumber: '490217', phone: '5555 1234' });
    expect(o.id).toBe('MON-490217');
    expect((await orders.getOrder(client, 'MON-490217')).id).toBe('MON-490217');
    const wrongPhone = await apiError(
      orders.lookupOrder(client, { orderNumber: 'MON-490217', phone: '5555-0000' }),
    );
    const missing = await apiError(
      orders.lookupOrder(client, { orderNumber: 'MON-000000', phone: '5555-1234' }),
    );
    expect(wrongPhone).toMatchObject({ status: 404, message: missing.message });
  });

  it('lookup: tras 5 fallos del mismo pedido responde 429 genérico, incluso con datos correctos', async () => {
    const { client } = createHarness();
    const wrong = { orderNumber: 'MON-490217', phone: '5555-0000' };
    for (let i = 0; i < 5; i++) {
      expect((await apiError(orders.lookupOrder(client, wrong))).status).toBe(404);
    }
    const blocked = await apiError(orders.lookupOrder(client, wrong));
    expect(blocked).toMatchObject({ status: 429, code: 'too_many_requests' });
    expect(blocked.message).toBe('No encontramos un pedido con esos datos');
    // Con el teléfono correcto tampoco se revela nada una vez bloqueado.
    const right = await apiError(
      orders.lookupOrder(client, { orderNumber: 'MON-490217', phone: '5555-1234' }),
    );
    expect(right.status).toBe(429);
  });

  it('lookup: el bloqueo 429 se levanta a los 60 s del último fallo (la demo no queda sin salida)', async () => {
    const { client, clock } = createHarness();
    const wrong = { orderNumber: 'MON-490217', phone: '5555-0000' };
    for (let i = 0; i < 5; i++) await apiError(orders.lookupOrder(client, wrong));
    expect((await apiError(orders.lookupOrder(client, wrong))).status).toBe(429);
    // Antes de la ventana sigue bloqueado, incluso con el teléfono correcto.
    clock.advance(59_000);
    const right = { orderNumber: 'MON-490217', phone: '5555-1234' };
    expect((await apiError(orders.lookupOrder(client, right))).status).toBe(429);
    // Pasada la ventana (60 s desde el último intento fallido) vuelve a funcionar.
    clock.advance(61_000);
    await expect(orders.lookupOrder(client, right)).resolves.toMatchObject({ id: 'MON-490217' });
  });

  it('lookup: el bloqueo es por pedido (otro número sigue en 404) y un acierto no resetea', async () => {
    const { client } = createHarness();
    for (let i = 0; i < 3; i++) {
      await apiError(orders.lookupOrder(client, { orderNumber: 'MON-490217', phone: '5555-0000' }));
    }
    // Acierto del mismo pedido: no resetea los 3 fallos previos.
    await orders.lookupOrder(client, { orderNumber: 'MON-490217', phone: '5555-1234' });
    await apiError(orders.lookupOrder(client, { orderNumber: 'MON-490217', phone: '5555-0000' }));
    await apiError(orders.lookupOrder(client, { orderNumber: 'MON-490217', phone: '5555-0000' }));
    expect(
      (
        await apiError(
          orders.lookupOrder(client, { orderNumber: 'MON-490217', phone: '5555-0000' }),
        )
      ).status,
    ).toBe(429);
    // Pedido inexistente: cuenta igual y no revela existencia.
    expect(
      (
        await apiError(
          orders.lookupOrder(client, { orderNumber: 'MON-000001', phone: '5555-1234' }),
        )
      ).status,
    ).toBe(404);
  });

  it('el dueño con sesión ve sus pedidos', async () => {
    const h = createHarness();
    h.asCustomer();
    expect((await orders.getOrder(h.client, 'MON-482193')).status).toBe('delivered');
  });

  it('incidencia: valida y la agrega al pedido', async () => {
    const h = createHarness();
    const inc = await orders.createIncident(h.client, {
      orderId: 'MON-490217',
      phone: '5555-1234',
      type: 'quality',
      items: ['calientito-roll'],
      description: 'El roll llegó frío y sin salsa.',
      resolution: 'replace',
    });
    expect(inc).toMatchObject({ id: 'INC-1043', status: 'received' });
    expect((await orders.getOrder(h.client, 'MON-490217')).incidents).toHaveLength(1);
    const bad = await apiError(
      orders.createIncident(h.client, {
        orderId: 'MON-490217',
        type: 'quality',
        items: ['dumplings'],
        description: 'Producto que no pedí en realidad.',
        resolution: 'refund',
      }),
    );
    expect(bad.status).toBe(422);
    const anon = createHarness();
    const e = await apiError(
      orders.createIncident(anon.client, {
        orderId: 'MON-490217',
        type: 'late',
        items: [],
        description: 'Llegó muy tarde, más de una hora.',
        resolution: 'inform',
      }),
    );
    expect(e.status).toBe(404);
  });

  it('avance de demostración recorre la máquina hasta entregado (domicilio)', async () => {
    const h = createHarness();
    const order = await orders.createOrder(h.client, deliveryOrder());
    const seen: string[] = [];
    let current = order;
    for (let i = 0; i < 10 && current.status !== 'delivered'; i++) {
      current = await orders.advanceOrderDemo(h.client, order.id);
      seen.push(current.status);
    }
    expect(seen).toEqual(['accepted', 'preparing', 'ready', 'on_the_way', 'delivered']);
    expect(current.delivery).toMatchObject({ provider: 'own', status: 'delivered' });
    expect(current.payment.status).toBe('approved');
    expect((await apiError(orders.advanceOrderDemo(h.client, order.id))).status).toBe(409);
  });
});

describe('pago con tarjeta (NeoNet simulado)', () => {
  async function cardOrder(scenario: Parameters<typeof createHarness>[0] = 'default') {
    const h = createHarness(scenario);
    const order = await orders.createOrder(h.client, deliveryOrder({ paymentMethod: 'card' }));
    return { h, order };
  }
  const pay = (h: ReturnType<typeof createHarness>, orderId: string, cardNumber: string) =>
    orders.payWithCard(h.client, {
      orderId,
      cardNumber,
      holderName: 'CLIENTE DEMO',
      expiry: '12/28',
      cvv: '123',
    });

  it.each([
    ['4242 4242 4242 4242', 'approved'],
    ['5555555555554444', 'approved'],
    ['4000000000000002', 'declined'],
    ['4000000000000077', 'review'],
  ])('tarjeta %s → %s', async (number, status) => {
    const { h, order } = await cardOrder();
    const result = await pay(h, order.id, number);
    expect(result).toMatchObject({ status, simulated: true, amount: order.total });
    const stored = h.store.orders.find((o) => o.id === order.id);
    expect(stored?.payment.cardLast4).toBe(number.replace(/\s/g, '').slice(-4));
    // Nunca se guarda el número completo ni el CVV.
    expect(JSON.stringify(h.store)).not.toContain(number.replace(/\s/g, ''));
    expect(JSON.stringify(h.store)).not.toMatch(/"cvv"/);
  });

  it('el pedido con tarjeta no llega al backoffice hasta que se paga', async () => {
    const { h, order } = await cardOrder();
    h.asStaff('admin');
    const ids = async () => (await h.client.get<Order[]>('/v1/backoffice/orders')).map((o) => o.id);
    expect(await ids()).not.toContain(order.id);
    await pay(h, order.id, '4000000000000002');
    expect(await ids()).not.toContain(order.id);
    await pay(h, order.id, '4242424242424242'); // reintento tras rechazo
    expect(await ids()).toContain(order.id);
    expect((await apiError(pay(h, order.id, '4242424242424242'))).status).toBe(409);
  });

  it('review se confirma pasados 20 s del reloj', async () => {
    const { h, order } = await cardOrder();
    await pay(h, order.id, '4000000000000077');
    expect((await orders.getOrder(h.client, order.id)).payment.status).toBe('review');
    h.clock.advance(21_000);
    expect((await orders.getOrder(h.client, order.id)).payment.status).toBe('approved');
  });

  it('rechaza tarjetas que no son de prueba y datos inválidos', async () => {
    const { h, order } = await cardOrder();
    expect((await apiError(pay(h, order.id, '4111111111111111'))).status).toBe(422);
    expect((await apiError(pay(h, order.id, '4242'))).status).toBe(400);
    const expired = await apiError(
      orders.payWithCard(h.client, {
        orderId: order.id,
        cardNumber: '4242424242424242',
        holderName: 'X Y',
        expiry: '10/26',
        cvv: '123',
      }),
    );
    expect(expired.status).toBe(400);
  });

  it('payment-rejected rechaza siempre; order-pending deja en verificación', async () => {
    const r = await cardOrder('payment-rejected');
    expect((await pay(r.h, r.order.id, '4242424242424242')).status).toBe('declined');
    const p = await cardOrder('order-pending');
    expect((await pay(p.h, p.order.id, '4242424242424242')).status).toBe('review');
    p.h.clock.advance(60_000);
    expect((await orders.getOrder(p.h.client, p.order.id)).payment.status).toBe('review');
  });

  it('pago rechazado y cambio a efectivo: el pedido con tarjeta previo se cancela (sin huérfanos)', async () => {
    const { h, order } = await cardOrder('payment-rejected');
    expect((await pay(h, order.id, '4242424242424242')).status).toBe('declined');
    const cash = await orders.createOrder(h.client, deliveryOrder({ paymentMethod: 'cash' }));
    const stale = h.store.orders.find((o) => o.id === order.id);
    expect(stale).toMatchObject({ status: 'cancelled' });
    expect(stale?.history.at(-1)).toMatchObject({ kind: 'order', status: 'cancelled' });
    // El nuevo pedido en efectivo sigue vivo y no se toca.
    expect(h.store.orders.find((o) => o.id === cash.id)?.status).toBe('received');
    // Ya no admite pago.
    expect((await apiError(pay(h, order.id, '4242424242424242'))).status).toBe(409);
  });

  it('un pedido de otro cliente con tarjeta pendiente no se cancela', async () => {
    const { h, order } = await cardOrder();
    await orders.createOrder(
      h.client,
      deliveryOrder({ customer: { ...customer, phone: '5555-9999' }, paymentMethod: 'cash' }),
    );
    expect(h.store.orders.find((o) => o.id === order.id)?.status).toBe('received');
  });
});
