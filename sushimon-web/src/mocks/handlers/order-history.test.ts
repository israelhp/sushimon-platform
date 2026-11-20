import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { OrderCreated } from '@/lib/data-access/models';
import { createHarness, type TestHarness } from '../testing';
import { quoteCheckout } from '@/services/checkout';
import {
  createOrder,
  getOrder,
  getOrderReceipt,
  listMyOrders,
  previewOrderReorder,
} from '@/services/orders';

/** F23 · mocks de `GET /v1/me/orders`, `GET /v1/orders/{id}/receipt` y `POST /v1/orders/{id}/reorder-preview` (forma real, mismos errores). */
const DEMO_FIRST = '00000000-0000-4000-8000-000000490217';
const DEMO_HISTORY = '00000000-0000-4000-8000-000000479850';

async function error(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('se esperaba un error');
}

async function place(
  h: TestHarness,
  lines: {
    productId: string;
    quantity: number;
    selections: { groupId: string; optionId: string; quantity: number }[];
  }[] = [{ productId: 'dumplings', quantity: 2, selections: [] }],
  key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
): Promise<OrderCreated> {
  const cart = { branchId: 'sucursal-1', lines };
  const fulfillment = { type: 'PICKUP' } as const;
  const quote = await quoteCheckout(h.client, { cart, fulfillment });
  return createOrder(
    h.client,
    {
      cart,
      fulfillment,
      quoteToken: quote.quote.token as string,
      contact: { fullName: 'Ana López', phone: '5555-1234' },
      paymentMethodPreference: 'cash',
    },
    key,
  );
}

describe('F23 mock · listMyOrders', () => {
  it('sin sesión: 401 (nunca se degrada a invitado)', async () => {
    const h = createHarness();
    expect((await error(listMyOrders(h.client))).status).toBe(401);
  });

  it('forma MyOrderPage: columnas mínimas, más reciente primero, UUID real, importes como cadena de 2 decimales', async () => {
    const h = createHarness();
    h.asCustomer();
    const page = await listMyOrders(h.client);
    expect(page.items.map((o) => o.displayNumber)).toEqual([
      'MON-490217',
      'MON-482193',
      'MON-479850',
    ]);
    expect(page.nextCursor).toBeNull();
    const first = page.items[0]!;
    expect(first.id).toBe(DEMO_FIRST);
    expect(Object.keys(first).sort()).toEqual(
      [
        'id',
        'orderNumber',
        'displayNumber',
        'status',
        'publicStatus',
        'terminal',
        'branchId',
        'branchName',
        'fulfillmentType',
        'deliveryProvider',
        'itemCount',
        'total',
        'currency',
        'paymentMethodPreference',
        'placedAt',
        'updatedAt',
      ].sort(),
    );
    expect(first).toMatchObject({
      status: 'pending',
      publicStatus: 'received',
      terminal: false,
      itemCount: 4,
      currency: 'GTQ',
      branchName: 'Sucursal 1',
    });
    for (const o of page.items) expect(o.total).toMatch(/^\d+\.\d{2}$/);
    const json = JSON.stringify(page);
    for (const forbidden of [
      'lines',
      'modifiers',
      'address',
      'phone',
      'email',
      'notes',
      'reason',
    ]) {
      expect(json).not.toContain(`"${forbidden}"`);
    }
  });

  it('estado: «en curso» e «historial» se filtran en el servidor; valores fuera del catálogo o más de 9 => 400', async () => {
    const h = createHarness();
    h.asCustomer();
    const active = await listMyOrders(h.client, {
      status: ['pending', 'accepted', 'preparing', 'ready', 'on_the_way'],
    });
    expect(active.items.map((o) => o.displayNumber)).toEqual(['MON-490217']);
    const past = await listMyOrders(h.client, {
      status: ['delivered', 'picked_up', 'rejected', 'cancelled'],
    });
    expect(past.items.map((o) => o.displayNumber)).toEqual(['MON-482193', 'MON-479850']);
    expect(past.items[0]).toMatchObject({
      status: 'picked_up',
      publicStatus: 'completed',
      terminal: true,
    });
    expect(
      (await error(h.client.get('/v1/me/orders', { query: { status: 'pending,bogus' } }))).status,
    ).toBe(400);
    const ten = Array.from({ length: 10 }, () => 'pending').join(',');
    expect((await error(h.client.get('/v1/me/orders', { query: { status: ten } }))).status).toBe(
      400,
    );
  });

  it('keyset: recorre todo sin duplicados ni saltos; el último cursor es null; un cursor alterado => 400 ORDER_CURSOR_INVALID', async () => {
    const h = createHarness();
    h.asCustomer();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page = await listMyOrders(h.client, { limit: 1 }, cursor);
      seen.push(...page.items.map((o) => o.displayNumber));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(['MON-490217', 'MON-482193', 'MON-479850']);
    expect(cursor).toBeNull();
    const first = await listMyOrders(h.client, { limit: 1 });
    const bad = await error(listMyOrders(h.client, {}, `${first.nextCursor}x`));
    expect(bad).toMatchObject({ status: 400, businessCode: 'ORDER_CURSOR_INVALID' });
    expect((await error(listMyOrders(h.client, {}, '!!!'))).businessCode).toBe(
      'ORDER_CURSOR_INVALID',
    );
  });

  it('limit 1..50; fechas con zona, to > from y a lo sumo 366 días', async () => {
    const h = createHarness();
    h.asCustomer();
    for (const limit of ['0', '51', 'x']) {
      expect((await error(h.client.get('/v1/me/orders', { query: { limit } }))).status).toBe(400);
    }
    const q = (query: Record<string, string>) => h.client.get('/v1/me/orders', { query });
    expect((await error(q({ from: '2026-11-01T00:00:00' }))).status).toBe(400);
    expect(
      (await error(q({ from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' }))).status,
    ).toBe(400);
    expect(
      (await error(q({ from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }))).status,
    ).toBe(400);
    // El pedido más antiguo (hace ~24 días) queda fuera de una ventana reciente.
    const recent = await listMyOrders(h.client, {
      from: new Date(h.clock.now().getTime() - 5 * 86_400_000).toISOString(),
    });
    expect(recent.items.map((o) => o.displayNumber)).toEqual(['MON-490217']);
  });

  it('sucursal: filtra por branchId; otra sucursal sin pedidos devuelve una página vacía', async () => {
    const h = createHarness();
    h.asCustomer();
    expect((await listMyOrders(h.client, { branchId: 'sucursal-1' })).items).toHaveLength(3);
    const none = await listMyOrders(h.client, { branchId: 'sucursal-2' });
    expect(none).toMatchObject({ items: [], nextCursor: null });
  });

  it('un pedido de invitado NUNCA se lista, aunque comparta el correo de la cuenta', async () => {
    const h = createHarness();
    const guest = await place(h);
    h.asCustomer();
    const page = await listMyOrders(h.client);
    expect(page.items.map((o) => o.displayNumber)).not.toContain(guest.order.displayNumber);
    expect(page.items).toHaveLength(3);
  });

  it('un pedido nuevo de la cuenta aparece primero y con estado pending', async () => {
    const h = createHarness();
    h.asCustomer();
    const created = await place(h);
    const page = await listMyOrders(h.client);
    expect(page.items[0]).toMatchObject({ id: created.order.id, status: 'pending' });
  });
});

describe('F23 mock · getOrderReceipt', () => {
  it('dueño: campos exactos, NOT_FISCAL, America/Guatemala, importes de los snapshots y total = subtotal − descuento + entrega', async () => {
    const h = createHarness();
    h.asCustomer();
    const r = await getOrderReceipt(h.client, DEMO_HISTORY);
    expect(r).toMatchObject({
      fiscalStatus: 'NOT_FISCAL',
      timeZone: 'America/Guatemala',
      currency: 'GTQ',
      displayNumber: 'MON-479850',
      status: 'delivered',
      publicStatus: 'completed',
      payment: { method: 'CASH', status: 'PENDING', paidAt: null, tendered: null },
    });
    expect(Object.keys(r).sort()).toEqual(
      [
        'fiscalStatus',
        'displayNumber',
        'status',
        'publicStatus',
        'placedAt',
        'generatedAt',
        'timeZone',
        'currency',
        'branch',
        'fulfillment',
        'address',
        'contact',
        'lines',
        'promotions',
        'notes',
        'subtotal',
        'extrasTotal',
        'discountTotal',
        'deliveryFee',
        'total',
        'payment',
      ].sort(),
    );
    const detail = await getOrder(h.client, DEMO_HISTORY);
    expect(r.total).toBe(detail.total);
    expect(r.lines).toEqual(detail.lines);
    const cents = (v: string) => Math.round(Number(v) * 100);
    expect(cents(r.total)).toBe(cents(r.subtotal) - cents(r.discountTotal) + cents(r.deliveryFee));
  });

  it('no contiene ids, tokens, hashes, correo, teléfono completo, coordenadas, motivo ni historial', async () => {
    const h = createHarness();
    h.asCustomer();
    const created = await place(h);
    const json = JSON.stringify(await getOrderReceipt(h.client, created.order.id));
    const keys = [...json.matchAll(/"([A-Za-z]+)":/g)].map((m) => m[1]);
    for (const forbidden of [
      'id',
      'branchId',
      'customerId',
      'email',
      'token',
      'guestToken',
      'reason',
      'rejectionReason',
      'history',
      'changedBy',
      'actor',
      'latitude',
      'longitude',
    ]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    expect(json).not.toContain('smo_');
    expect(json).not.toContain('@');
    expect(json).not.toContain('5555-1234');
    expect(json).toContain('****1234');
    expect(json).not.toContain(created.order.id);
  });

  it('un cambio posterior del catálogo no altera el recibo (sin recomputar)', async () => {
    const h = createHarness();
    h.asCustomer();
    const created = await place(h);
    const before = await getOrderReceipt(h.client, created.order.id);
    const product = h.store.products.find((p) => p.id === 'dumplings')!;
    product.name = 'Renombrado';
    product.basePrice = '99.00';
    const after = await getOrderReceipt(h.client, created.order.id);
    expect({ ...after, generatedAt: '' }).toEqual({ ...before, generatedAt: '' });
  });

  it('invitado: con X-Order-Token vigente 200; sin token, ajeno e inexistente => el MISMO 404', async () => {
    const h = createHarness();
    const created = await place(h);
    const id = created.order.id;
    const token = created.access?.guestToken ?? null;
    expect((await getOrderReceipt(h.client, id, { guestToken: token })).displayNumber).toBe(
      created.order.displayNumber,
    );
    const noToken = await error(getOrderReceipt(h.client, id));
    const wrong = await error(
      getOrderReceipt(h.client, id, { guestToken: 'smo_' + 'a'.repeat(43) }),
    );
    const missing = await error(
      getOrderReceipt(h.client, '00000000-0000-4000-8000-0000000000aa', { guestToken: token }),
    );
    for (const e of [noToken, wrong, missing]) {
      expect(e.status).toBe(404);
      expect(e.businessCode).toBeUndefined();
      expect(e.message).toBe(noToken.message);
    }
  });

  it('otra cuenta con sesión ve el mismo 404 que un pedido inexistente', async () => {
    const h = createHarness();
    h.asCustomer();
    const created = await place(h);
    h.asCustomer('otra.persona@ejemplo.com');
    const foreign = await error(getOrderReceipt(h.client, created.order.id));
    const missing = await error(getOrderReceipt(h.client, '00000000-0000-4000-8000-0000000000bb'));
    expect(foreign).toMatchObject({ status: 404, message: missing.message });
    expect(foreign.businessCode).toBeUndefined();
  });

  it('un pedido rechazado/cancelado tiene recibo SIN motivo y sin afirmar pago', async () => {
    const h = createHarness();
    h.asCustomer();
    const draft = h.store.orders.find((o) => o.id === 'MON-479850')!;
    draft.status = 'rejected';
    draft.rejectionReason = 'motivo interno secreto';
    const r = await getOrderReceipt(h.client, DEMO_HISTORY);
    expect(r).toMatchObject({
      status: 'rejected',
      publicStatus: 'rejected',
      payment: { status: 'PENDING', amountPaid: null },
    });
    expect(JSON.stringify(r)).not.toContain('secreto');
  });

  it('el número del borrador simulado (MON-…) también se resuelve para su dueño', async () => {
    const h = createHarness();
    h.asCustomer();
    expect((await getOrderReceipt(h.client, 'MON-479850')).displayNumber).toBe('MON-479850');
    h.asCustomer(null);
    expect((await error(getOrderReceipt(h.client, 'MON-479850'))).status).toBe(404);
  });
});

describe('F23 mock · previewOrderReorder', () => {
  it('pedido histórico: disponible, precio cambiado (antes → ahora), producto retirado; candidatas con la forma del carrito', async () => {
    const h = createHarness();
    h.asCustomer();
    const p = await previewOrderReorder(h.client, DEMO_HISTORY);
    expect(p.source).toMatchObject({ displayNumber: 'MON-479850', status: 'delivered' });
    expect(p.branch).toMatchObject({
      originalBranchId: 'sucursal-1',
      requestedBranchId: 'sucursal-1',
      sameBranch: true,
      active: true,
    });
    expect(p.lines.map((l) => [l.original.productName, l.status])).toEqual([
      ['La Suegra Roll', 'AVAILABLE'],
      ['Loco Ribs', 'AVAILABLE'],
      ['Helados Asiáticos', 'AVAILABLE'],
      ['Roll de Temporada', 'UNAVAILABLE'],
    ]);
    const ribs = p.lines[1]!;
    expect(ribs.issues).toEqual([
      expect.objectContaining({
        code: 'PRICE_CHANGED',
        severity: 'info',
        previousUnitPrice: '42.00',
        currentUnitPrice: '46.00',
      }),
    ]);
    expect(p.lines[3]).toMatchObject({
      issues: [expect.objectContaining({ code: 'PRODUCT_REMOVED', severity: 'blocking' })],
      current: null,
      candidate: null,
    });
    expect(p.lines[0]!.candidate).toMatchObject({
      line: { productId: 'la-suegra-roll', quantity: 1, selections: [] },
      note: 'Salsa aparte',
    });
    expect(p.summary).toMatchObject({
      lines: 4,
      available: 3,
      needsConfiguration: 0,
      unavailable: 1,
      priceChanged: 1,
      canAddAny: true,
    });
    expect(p.summary.estimatedSubtotal).toMatch(/^\d+\.\d{2}$/);
  });

  it('no escribe: ni pedidos, ni secuencias, ni borradores; no copia precios, promociones, tarifa ni pago', async () => {
    const h = createHarness();
    h.asCustomer();
    await listMyOrders(h.client); // materializa los registros derivados antes de medir
    const before = JSON.stringify([
      h.store.orders,
      h.store.placedOrders,
      h.store.sequences,
      h.store.orderIdempotency,
    ]);
    const p = await previewOrderReorder(h.client, DEMO_HISTORY);
    expect(
      JSON.stringify([
        h.store.orders,
        h.store.placedOrders,
        h.store.sequences,
        h.store.orderIdempotency,
      ]),
    ).toBe(before);
    const json = JSON.stringify(p);
    for (const forbidden of [
      'deliveryFee',
      'discountTotal',
      'promotions',
      'couponCode',
      'paymentMethod',
      'address',
      '"id"',
      'customer',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('autorización: dueño y invitado con token; ajeno/inexistente/token inválido => mismo 404 sin code; BRANCH_NOT_FOUND solo tras autorizar', async () => {
    const h = createHarness();
    const created = await place(h);
    const id = created.order.id;
    const token = created.access?.guestToken ?? null;
    expect((await previewOrderReorder(h.client, id, { guestToken: token })).summary.available).toBe(
      1,
    );

    const denied = await error(previewOrderReorder(h.client, id, { branchId: 'no-existe' }));
    expect(denied).toMatchObject({ status: 404 });
    expect(denied.businessCode).toBeUndefined();
    const authorized = await error(
      previewOrderReorder(h.client, id, { guestToken: token, branchId: 'no-existe' }),
    );
    expect(authorized).toMatchObject({ status: 404, businessCode: 'BRANCH_NOT_FOUND' });
  });

  it('cuerpo: {} y ausente válidos; campos desconocidos (precios, líneas, customerId, __proto__) => 400', async () => {
    const h = createHarness();
    h.asCustomer();
    const call = (body?: unknown) =>
      h.client.request(`/v1/orders/${DEMO_HISTORY}/reorder-preview`, { method: 'POST', body });
    await expect(call()).resolves.toBeTruthy();
    await expect(call({})).resolves.toBeTruthy();
    for (const bad of [
      { prices: [1] },
      { lines: [] },
      { customerId: 'x' },
      JSON.parse('{"__proto__":{"a":1}}'),
      { branchId: 7 },
      [],
    ]) {
      expect((await error(call(bad))).status).toBe(400);
    }
  });

  it('otra sucursal: precios y disponibilidad de ESA sucursal; sameBranch=false', async () => {
    const h = createHarness();
    h.asCustomer();
    h.store.branchProducts.push({
      branchId: 'sucursal-2',
      productId: 'helados-asiaticos',
      priceOverride: null,
      available: false,
      updatedAt: '2026-11-01T12:00:00.000Z',
    });
    const p = await previewOrderReorder(h.client, DEMO_HISTORY, { branchId: 'sucursal-2' });
    expect(p.branch).toMatchObject({ requestedBranchId: 'sucursal-2', sameBranch: false });
    expect(p.lines[2]).toMatchObject({
      status: 'UNAVAILABLE',
      issues: [expect.objectContaining({ code: 'PRODUCT_OUT_OF_STOCK' })],
    });
    expect(p.lines[2]!.current).not.toBeNull();
  });

  it('sucursal inactiva: todas las líneas UNAVAILABLE con BRANCH_UNAVAILABLE', async () => {
    const h = createHarness();
    h.asCustomer();
    const branch = h.store.branches.find((b) => b.id === 'sucursal-2')!;
    branch.active = false;
    const p = await previewOrderReorder(h.client, DEMO_HISTORY, { branchId: 'sucursal-2' });
    expect(p.branch).toMatchObject({ active: false, acceptingOrders: false, reason: 'INACTIVE' });
    expect(p.lines.every((l) => l.status === 'UNAVAILABLE')).toBe(true);
    expect(p.lines.every((l) => l.issues[0]?.code === 'BRANCH_UNAVAILABLE')).toBe(true);
    expect(p.summary.canAddAny).toBe(false);
  });

  it('extras de un pedido real: se retienen; opción inactiva => OPTION_INACTIVE + NEEDS_CONFIGURATION (nunca se sustituye)', async () => {
    const h = createHarness();
    h.asCustomer();
    const created = await place(h, [
      {
        productId: 'california-roll',
        quantity: 1,
        selections: [{ groupId: 'mgroup-extras', optionId: 'mopt-queso-crema', quantity: 1 }],
      },
    ]);
    const ok = await previewOrderReorder(h.client, created.order.id);
    expect(ok.lines[0]).toMatchObject({ status: 'AVAILABLE' });
    expect(ok.lines[0]!.candidate?.line.selections).toEqual([
      { groupId: 'mgroup-extras', optionId: 'mopt-queso-crema', quantity: 1 },
    ]);

    h.store.modifiers.find((m) => m.id === 'mopt-queso-crema')!.active = false;
    const inactive = await previewOrderReorder(h.client, created.order.id);
    expect(inactive.lines[0]).toMatchObject({
      status: 'NEEDS_CONFIGURATION',
      issues: [expect.objectContaining({ code: 'OPTION_INACTIVE', optionName: 'Queso crema' })],
    });
    expect(inactive.lines[0]!.candidate?.line.selections).toEqual([]);
    expect(inactive.summary).toMatchObject({
      available: 0,
      needsConfiguration: 1,
      canAddAny: false,
    });
  });
});
