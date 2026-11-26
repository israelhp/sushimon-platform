import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { CheckoutQuoteRequest } from '@/lib/data-access/models';
import { quoteCheckout } from '@/services/checkout';
import { createHarness } from '../testing';

const CITY = 'mun-guatemala-guatemala';
const MIXCO = 'mun-guatemala-mixco';
const PALENCIA = 'mun-guatemala-palencia';
/** ADR-0036: toda cotización es a domicilio; Zona 10 de la Ciudad la cubre la entrega propia de `sucursal-1`. */
const HOME: CheckoutQuoteRequest['fulfillment'] = {
  type: 'DELIVERY',
  municipalityId: CITY,
  zone: 'Zona 10',
};

const line = (
  productId: string,
  quantity = 1,
  selections: { groupId: string; optionId: string }[] = [],
) => ({
  productId,
  quantity,
  selections: selections.map((s) => ({ ...s, quantity: 1 })),
});
const request = (
  lines = [line('dumplings')],
  fulfillment: CheckoutQuoteRequest['fulfillment'] = HOME,
  extra: Partial<CheckoutQuoteRequest> = {},
  branchId = 'sucursal-1',
): CheckoutQuoteRequest => ({ cart: { branchId, lines }, fulfillment, ...extra });

async function fail(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('se esperaba un error');
}

describe('F19 mock · POST /v1/checkout/quote (SIMULADO, paridad de forma con el contrato)', () => {
  it('a domicilio: totales exactos en centavos, con la tarifa de la zona, token simulado (F20, sin firma) y con vigencia ficticia de 10 min', async () => {
    const { client } = createHarness();
    const q = await quoteCheckout(client, request([line('dumplings', 2)]));
    expect(q.currency).toBe('GTQ');
    expect(q.lines[0]).toMatchObject({
      index: 0,
      status: 'OK',
      unitPrice: '53.00',
      lineTotal: '106.00',
    });
    expect(q.subtotal).toBe('106.00');
    expect(q.deliveryFee).toBe('15.00');
    expect(q.total).toBe('121.00');
    expect(q.fulfillment.type).toBe('DELIVERY');
    expect(q.canProceed).toBe(true);
    expect(q.blockers).toEqual([]);
    expect(q.quote.token).toMatch(/^mockq\./); // doble SIN firma; la API real emite un HMAC
    expect(Date.parse(q.quote.expiresAt) - Date.parse(q.quote.generatedAt)).toBe(600_000);
    expect(q.coupon).toBeNull();
  });

  it('ADR-0036: PICKUP ya no se cotiza (400) y solo DELIVERY es válido', async () => {
    const { client } = createHarness();
    const e = await fail(
      client.request('/v1/checkout/quote', {
        method: 'POST',
        body: {
          cart: { branchId: 'sucursal-1', lines: [line('dumplings')] },
          fulfillment: { type: 'PICKUP' },
        },
      }),
    );
    expect(e.status).toBe(400);
  });

  it('extras: se suman por unidad y NO se descuentan; el total es la suma exacta de las líneas', async () => {
    const { client } = createHarness();
    const q = await quoteCheckout(
      client,
      request([
        line('california-roll', 2, [{ groupId: 'mgroup-extras', optionId: 'mopt-queso-crema' }]),
      ]),
    );
    expect(q.lines[0]).toMatchObject({
      unitPrice: '57.00',
      extrasPerUnit: '5.00',
      lineSubtotal: '124.00',
    });
    expect(q.extrasTotal).toBe('10.00');
    expect(q.total).toBe('139.00');
  });

  it('estados de línea con la precedencia del contrato y total null si alguna no es comprable', async () => {
    const { client } = createHarness('product-unavailable');
    const q = await quoteCheckout(
      client,
      request([
        line('dumplings'),
        line('platanito-roll'),
        line('no-existe'),
        line('california-roll', 1, [{ groupId: 'mgroup-extras', optionId: 'mopt-tempura-crunch' }]),
        line('sushi-pizza'),
      ]),
    );
    expect(q.lines.map((l) => l.status)).toEqual([
      'OK',
      'UNAVAILABLE',
      'NOT_FOUND',
      'OPTION_UNAVAILABLE',
      'MODIFIER_INVALID',
    ]);
    expect(q.lines[1]).toMatchObject({ unitPrice: null, lineTotal: null });
    expect(q.total).toBeNull();
    expect(q.canProceed).toBe(false);
    expect(q.blockers.map((b) => [b.code, b.scope, b.lineIndex])).toEqual([
      ['UNAVAILABLE', 'LINE', 1],
      ['NOT_FOUND', 'LINE', 2],
      ['OPTION_UNAVAILABLE', 'LINE', 3],
      ['MODIFIER_INVALID', 'LINE', 4],
    ]);
  });

  it('precio de sucursal (override) y avisos PRICE_CHANGED/TOTAL_CHANGED solo con la pista del cliente', async () => {
    const { client } = createHarness();
    const q = await quoteCheckout(
      client,
      request(
        [line('dynamita-roll')],
        HOME,
        {
          clientView: { lines: [{ index: 0, unitPrice: '80.00' }], total: '1.00' },
        },
        'sucursal-2',
      ),
    );
    expect(q.lines[0]).toMatchObject({
      unitPrice: '86.00',
      status: 'PRICE_CHANGED',
      previousUnitPrice: '80.00',
    });
    expect(q.notices).toEqual([{ code: 'PRICE_CHANGED', lineIndex: 0 }, { code: 'TOTAL_CHANGED' }]);
    expect(q.canProceed).toBe(true);
    expect(q.total).toBe('101.00');
  });

  it('cupón: respuesta única APPLIED/NOT_APPLIED sin motivo (inexistente, vencido o de otra sucursal igual)', async () => {
    const { client } = createHarness();
    const ok = await quoteCheckout(
      client,
      request([line('dumplings', 2)], HOME, { couponCode: ' bienvenido10 ' }),
    );
    expect(ok.coupon).toEqual({ status: 'APPLIED' });
    expect(ok.discountTotal).toBe('10.60');
    expect(ok.total).toBe('110.40');
    for (const code of ['NOEXISTE', 'COMBOMON', 'semana-cliente']) {
      const no = await quoteCheckout(
        client,
        request([line('dumplings')], HOME, { couponCode: code }),
      );
      expect(no.coupon).toEqual({ status: 'NOT_APPLIED' });
      expect(Object.keys(no.coupon ?? {})).toEqual(['status']);
      expect(no.discountTotal).toBe('0.00');
    }
  });

  it('una promoción por línea (la de mayor ahorro) y las «solo en local» no aplican', async () => {
    const { client } = createHarness();
    // california-roll: Navidad en rolls (15 %) aún no vigente; Happy Hour es solo en local; el cupón (10 %) gana.
    const q = await quoteCheckout(
      client,
      request([line('california-roll')], HOME, { couponCode: 'BIENVENIDO10' }),
    );
    expect(q.lines[0]?.promotionId).toBe('bienvenida');
    expect(q.lines[0]?.discount).toBe('5.70');
  });

  it('entrega propia con zona: tarifa del servidor; PedidosYa UNKNOWN, sin tarifa y nunca seleccionable', async () => {
    const { client } = createHarness();
    const q = await quoteCheckout(
      client,
      request([line('dumplings')], { type: 'DELIVERY', municipalityId: CITY, zone: 'Zona 10' }),
    );
    expect(q.canProceed).toBe(true);
    expect(q.deliveryFee).toBe('15.00');
    expect(q.total).toBe('68.00');
    const [own, py] = q.fulfillment.delivery?.options ?? [];
    expect(own).toMatchObject({
      provider: 'OWN',
      coverageStatus: 'AVAILABLE',
      selectable: true,
      customerFee: '15.00',
    });
    expect(py).toMatchObject({
      provider: 'PEDIDOSYA',
      coverageStatus: 'UNKNOWN',
      selectable: false,
      customerFee: null,
    });
    expect(q.fulfillment.delivery?.selectedProvider).toBe('OWN');
    expect(JSON.stringify(q)).not.toMatch(/cost/i);
  });

  it('PedidosYa pedido a mano no se sustituye por OWN: DELIVERY_PROVIDER_NOT_SELECTABLE y total null', async () => {
    const { client } = createHarness();
    const q = await quoteCheckout(
      client,
      request([line('dumplings')], {
        type: 'DELIVERY',
        municipalityId: CITY,
        zone: 'Zona 10',
        deliveryProvider: 'PEDIDOSYA',
      }),
    );
    expect(q.blockers).toEqual([
      { code: 'DELIVERY_PROVIDER_NOT_SELECTABLE', scope: 'FULFILLMENT' },
    ]);
    expect(q.fulfillment.delivery?.selectedProvider).toBeNull();
    expect(q.deliveryFee).toBeNull();
    expect(q.total).toBeNull();
  });

  it('PedidosYa simulado AVAILABLE: se marca simulated y sigue sin habilitar nada', async () => {
    const h = createHarness();
    h.store.pedidosyaCoverage = 'available';
    h.store.deliverySettings['sucursal-1'] = {
      ownDeliveryZonesEnabled: false,
      pedidosyaEnabled: true,
      updatedAt: '2026-02-01T15:00:00.000Z',
    };
    const q = await quoteCheckout(
      h.client,
      request([line('dumplings')], { type: 'DELIVERY', municipalityId: CITY, zone: 'Zona 10' }),
    );
    const py = q.fulfillment.delivery?.options.find((o) => o.provider === 'PEDIDOSYA');
    expect(py).toMatchObject({
      simulated: true,
      selectable: false,
      customerFee: null,
      unavailableReason: 'SIMULATED',
    });
    expect(q.canProceed).toBe(false);
    expect(q.blockers[0]?.code).toBe('DELIVERY_UNVERIFIED');
  });

  it('flag OWN apagado => DELIVERY_UNVERIFIED; todo UNAVAILABLE => DELIVERY_UNAVAILABLE; recoger sigue disponible', async () => {
    const h = createHarness();
    h.store.deliverySettings['sucursal-1'] = {
      ownDeliveryZonesEnabled: false,
      pedidosyaEnabled: true,
      updatedAt: '2026-02-01T15:00:00.000Z',
    };
    const off = await quoteCheckout(
      h.client,
      request([line('dumplings')], { type: 'DELIVERY', municipalityId: CITY, zone: 'Zona 10' }),
    );
    expect(off.blockers.map((b) => b.code)).toEqual(['DELIVERY_UNVERIFIED']);
    expect(off.fulfillment.delivery?.options[0]).toMatchObject({
      enabled: false,
      unavailableReason: 'PROVIDER_DISABLED',
    });
    h.store.deliverySettings['sucursal-1'] = {
      ownDeliveryZonesEnabled: true,
      pedidosyaEnabled: false,
      updatedAt: '2026-02-01T15:00:00.000Z',
    };
    const none = await quoteCheckout(
      h.client,
      request([line('dumplings')], { type: 'DELIVERY', municipalityId: PALENCIA }),
    );
    expect(none.blockers.map((b) => b.code)).toEqual(['DELIVERY_UNAVAILABLE']);
    const pickup = await quoteCheckout(h.client, request([line('dumplings')]));
    expect(pickup.canProceed).toBe(true);
  });

  it('dirección incompleta en la ciudad (sin zona) => ADDRESS_INCOMPLETE, total null; zona general de otro municipio no la exige', async () => {
    const { client } = createHarness();
    const city = await quoteCheckout(
      client,
      request([line('dumplings')], { type: 'DELIVERY', municipalityId: CITY, zone: null }),
    );
    expect(city.blockers).toEqual([{ code: 'ADDRESS_INCOMPLETE', scope: 'FULFILLMENT' }]);
    expect(city.total).toBeNull();
    const mixco = await quoteCheckout(
      client,
      request([line('dumplings')], { type: 'DELIVERY', municipalityId: MIXCO }),
    );
    expect(mixco.canProceed).toBe(true);
    expect(mixco.deliveryFee).toBe('25.00');
  });

  it('sucursal cerrada: BRANCH_CLOSED bloquea pero el total se sigue mostrando', async () => {
    const { client } = createHarness('branch-closed');
    const q = await quoteCheckout(client, request());
    expect(q.branch.isAcceptingOrders).toBe(false);
    expect(q.blockers).toEqual([{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }]);
    expect(q.total).toBe('68.00');
    expect(q.canProceed).toBe(false);
  });

  it('errores: sucursal inexistente/inactiva 422, municipio 422, dirección sin sesión 401, ajena=inexistente 404, 503 determinista', async () => {
    const h = createHarness();
    const noBranch = await fail(
      quoteCheckout(h.client, request([line('dumplings')], HOME, {}, 'sucursal-99')),
    );
    expect([noBranch.status, noBranch.businessCode]).toEqual([422, 'BRANCH_NOT_AVAILABLE']);
    const inactive = await fail(
      quoteCheckout(h.client, request([line('dumplings')], HOME, {}, 'sucursal-4')),
    );
    expect(inactive.businessCode).toBe('BRANCH_NOT_AVAILABLE');
    const muni = await fail(
      quoteCheckout(
        h.client,
        request([line('dumplings')], { type: 'DELIVERY', municipalityId: 'mun-x' }),
      ),
    );
    expect([muni.status, muni.businessCode]).toEqual([422, 'MUNICIPALITY_NOT_FOUND']);
    const anon = await fail(
      quoteCheckout(
        h.client,
        request([line('dumplings')], { type: 'DELIVERY', customerAddressId: 'addr-1' }),
      ),
    );
    expect(anon.status).toBe(401);
    h.asCustomer();
    const foreign = await fail(
      quoteCheckout(
        h.client,
        request([line('dumplings')], { type: 'DELIVERY', customerAddressId: 'addr-ajena' }),
      ),
    );
    expect([foreign.status, foreign.businessCode]).toEqual([404, 'ADDRESS_NOT_FOUND']);
    h.store.checkoutBusy = 1;
    const busy = await fail(quoteCheckout(h.client, request()));
    expect([busy.status, busy.businessCode]).toEqual([503, 'CHECKOUT_BUSY']);
    expect((await quoteCheckout(h.client, request())).canProceed).toBe(true);
  });

  it('400: importes del cliente (price/fee/total/discount), combinaciones incoherentes y topes', async () => {
    const { client } = createHarness();
    const bad = async (body: unknown) =>
      fail(client.request('/v1/checkout/quote', { method: 'POST', body }));
    const base = request();
    for (const key of ['price', 'fee', 'total', 'discount', 'deliveryFee']) {
      expect((await bad({ ...base, [key]: '1.00' })).status).toBe(400);
    }
    expect(
      (
        await bad({
          ...base,
          cart: { ...base.cart, lines: [{ ...line('dumplings'), price: '1.00' }] },
        })
      ).status,
    ).toBe(400);
    expect((await bad({ ...base, fulfillment: { type: 'PICKUP', zone: 'Zona 1' } })).status).toBe(
      400,
    );
    expect((await bad({ ...base, fulfillment: { type: 'DELIVERY' } })).status).toBe(400);
    expect(
      (
        await bad({
          ...base,
          fulfillment: { type: 'DELIVERY', municipalityId: CITY, customerAddressId: 'a' },
        })
      ).status,
    ).toBe(400);
    expect((await bad({ ...base, cart: { ...base.cart, lines: [] } })).status).toBe(400);
    const limits = await bad(
      request([line('dumplings', 99), line('california-roll', 99), line('cayibel-roll', 99)]),
    );
    expect([limits.status, limits.businessCode]).toEqual([400, 'QUOTE_LIMITS_EXCEEDED']);
  });
});
