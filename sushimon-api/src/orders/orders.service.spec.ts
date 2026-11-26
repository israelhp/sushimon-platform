import { Logger } from '@nestjs/common';
import {
  ADDR_OTHER,
  ADDR_OWN,
  coverageResult,
  groupRow,
  MUNI_GUATEMALA,
  mid,
  optionRow,
  ownZone,
  P2,
} from '../../test/support/checkout-harness.js';
import {
  A,
  GUEST_CONTACT,
  KEY_A,
  KEY_B,
  keyOf,
  ordersHarness,
  P1,
  principal,
  type OrdersHarness,
} from '../../test/support/orders-harness.js';
import { NOW } from '../../test/support/promotions-harness.js';
import { DbGate } from '../common/concurrency/db-gate.js';
import { GUEST_TOKEN_PATTERN } from './order-access-token.js';
import { ordersBusy } from './orders-errors.js';

const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const body = (e: unknown) =>
  ((e as { getResponse?: () => unknown }).getResponse?.() ?? {}) as Record<string, unknown>;
const codeOf = (e: unknown) => body(e)['code'];
const statusOf = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('OrdersService (F20)', () => {
  let h: OrdersHarness;
  beforeAll(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  beforeEach(() => {
    h = ordersHarness();
  });

  const ownDelivery = async (over: Record<string, unknown> = {}) => {
    h.cover.result = coverageResult({ own: ownZone('15.00') });
    return h.orderBody({
      fulfillment: {
        type: 'DELIVERY',
        municipalityId: MUNI_GUATEMALA,
        zone: 'Zona 10',
        deliveryProvider: 'OWN',
      },
      deliveryAddress: { addressLine: '6a avenida 12-34', referenceNote: 'Portón negro' },
      ...over,
    });
  };
  const nothingPersisted = () => {
    expect(h.ordersRepo.orders.size).toBe(0);
    expect(h.ordersRepo.keys.size).toBe(0);
    expect(h.ordersRepo.tokens).toHaveLength(0);
    expect(h.ordersRepo.audits).toHaveLength(0);
  };

  describe('creación (filas 1, 2, 5, 6, 7, 33-35)', () => {
    it('a domicilio de invitado (zona propia, tarifa 0.00): pending, snapshot de dirección, token de invitado y contacto normalizado', async () => {
      const result = await h.orders.create(undefined, KEY_A, await h.orderBody());
      expect(result.replayed).toBe(false);
      const { order, access } = result.body;
      expect(order).toMatchObject({
        status: 'pending',
        fulfillmentType: 'DELIVERY',
        deliveryProvider: 'OWN',
        subtotal: '170.00',
        extrasTotal: '0.00',
        discountTotal: '0.00',
        deliveryFee: '0.00',
        total: '170.00',
        currency: 'GTQ',
        address: { addressLine: '6a avenida 12-34' },
        orderNumber: 1001,
        displayNumber: 'MON-001001',
        contact: { fullName: 'Ana Pérez', phoneMasked: '****1234' },
        payment: { method: 'CASH', status: 'PENDING', paidAt: null },
      });
      expect(order.lines).toEqual([
        expect.objectContaining({
          productName: 'Roll California',
          quantity: 2,
          unitPrice: '85.00',
          lineSubtotal: '170.00',
          lineTotal: '170.00',
        }),
      ]);
      expect(access?.guestToken).toMatch(GUEST_TOKEN_PATTERN);
      const stored = [...h.ordersRepo.orders.values()][0];
      expect(stored?.record.customerId).toBeNull();
      expect(stored?.record.customerPhone).toBe('+50255551234');
      // Solo el hash del token vive en la BD; jamás el token en claro.
      expect(JSON.stringify([...h.ordersRepo.tokens])).not.toContain(access?.guestToken as string);
      expect(h.ordersRepo.history).toEqual([
        { orderId: order.id, oldStatus: null, newStatus: 'pending' },
      ]);
      expect(h.ordersRepo.audits).toEqual([
        expect.objectContaining({ action: 'order.created', actorId: null }),
      ]);
      expect(JSON.stringify(h.ordersRepo.audits)).not.toMatch(/Ana|5555|1234/);
      expect(h.published).toEqual([{ orderId: order.id, branchId: A }]);
    });

    it('DELIVERY OWN con zona: tarifa de la zona y snapshot de la dirección', async () => {
      const { body: res } = await h.orders.create(undefined, KEY_A, await ownDelivery());
      expect(res.order).toMatchObject({
        fulfillmentType: 'DELIVERY',
        deliveryProvider: 'OWN',
        deliveryFee: '15.00',
        total: '185.00',
        address: {
          municipalityName: 'Guatemala',
          zone: 'Zona 10',
          addressLine: '6a avenida 12-34',
          referenceNote: 'Portón negro',
        },
      });
    });

    it('autenticado: customer_id de la sesión (ensureCustomer), `access=null`, contacto desde el perfil', async () => {
      h.identity.defaultPhone = '55559999';
      const who = principal('user-1');
      const { body: res } = await h.orders.create(who, KEY_A, await h.orderBody({}, who));
      expect(h.identity.ensureCalls).toBe(1);
      expect(res.access).toBeNull();
      expect([...h.ordersRepo.orders.values()][0]?.record.customerId).toBe(
        h.identity.customers.get('user-1')?.id,
      );
      expect(res.order.contact.phoneMasked).toBe('****9999');
      expect(h.ordersRepo.tokens).toHaveLength(0);
      expect(h.ordersRepo.audits[0]?.newValues).toMatchObject({ actor: 'customer' });
    });

    it('autenticado sin teléfono en el perfil ni en `contact` => 422 CONTACT_INCOMPLETE; con `contact` no sobrescribe el perfil', async () => {
      const who = principal('user-1');
      const e = await err(h.orders.create(who, KEY_A, await h.orderBody({}, who)));
      expect([statusOf(e), codeOf(e)]).toEqual([422, 'CONTACT_INCOMPLETE']);
      nothingPersisted();
      const ok = await h.orders.create(
        who,
        KEY_B,
        await h.orderBody({ contact: { phone: '+502 4444 3333', email: 'A@B.com' } }, who),
      );
      expect(ok.body.order.contact.phoneMasked).toBe('****3333');
      expect(h.identity.customers.get('user-1')?.phone).toBeNull();
    });

    it('dirección guardada propia: se copia; con `deliveryAddress` => 400; ajena => 404 igual; sin sesión => 401', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      h.ownerOf.set(ADDR_OWN, 'user-1');
      h.ownerOf.set(ADDR_OTHER, 'user-2');
      h.identity.defaultPhone = '55559999';
      const who = principal('user-1');
      const f = (id: string) =>
        ({ type: 'DELIVERY', customerAddressId: id, deliveryProvider: 'OWN' }) as const;
      const ok = await h.orders.create(
        who,
        KEY_A,
        await h.orderBody({ fulfillment: f(ADDR_OWN) }, who),
      );
      expect(ok.body.order.address).toMatchObject({ addressLine: 'Calle 1', zone: 'Zona 10' });

      const withText = await h.orderBody({ fulfillment: f(ADDR_OWN) }, who);
      const e400 = await err(
        h.orders.create(who, KEY_B, {
          ...withText,
          deliveryAddress: { addressLine: 'Otra calle 1' },
        }),
      );
      expect(statusOf(e400)).toBe(400);

      // El token es válido (misma entrada/sujeto que la cotización propia); la dirección ajena falla al recotizar.
      const base = await h.orderBody({ fulfillment: f(ADDR_OWN) }, who);
      const foreign = await err(
        h.orders.create(who, keyOf('c'), { ...base, fulfillment: f(ADDR_OTHER) }),
      );
      const missing = await err(
        h.orders.create(who, keyOf('d'), {
          ...base,
          fulfillment: f('00000000-0000-4000-8000-00000000d0ff'),
        }),
      );
      expect(statusOf(foreign)).toBe(404);
      expect(body(foreign)).toEqual(body(missing));

      const anon = await err(
        h.orders.create(undefined, keyOf('e'), {
          ...(await h.orderBody({ fulfillment: f(ADDR_OWN) }, who)),
          contact: GUEST_CONTACT,
        }),
      );
      expect(statusOf(anon)).toBe(401);
    });

    it('invitado sin nombre o teléfono válido => 400; DELIVERY sin texto => 400; PICKUP => 400 (ADR-0036)', async () => {
      const base = await h.orderBody();
      for (const bad of [
        { ...base, contact: { fullName: 'Ana Pérez' } },
        { ...base, contact: { fullName: 'Ana Pérez', phone: '12345' } },
        { ...base, contact: undefined },
        { ...base, fulfillment: { type: 'PICKUP' } },
        { ...base, fulfillment: { type: 'PICKUP' }, deliveryAddress: undefined },
        { ...base, fulfillment: { type: 'PICKUP', municipalityId: MUNI_GUATEMALA } },
      ] as unknown as Parameters<typeof h.orders.create>[2][]) {
        expect(statusOf(await err(h.orders.create(undefined, KEY_A, bad)))).toBe(400);
      }
      const noText = await ownDelivery();
      delete (noText as { deliveryAddress?: unknown }).deliveryAddress;
      expect(statusOf(await err(h.orders.create(undefined, KEY_A, noText)))).toBe(400);
      nothingPersisted();
    });

    it('preferencia de pago F24: cash se guarda como preferencia y el pago nace CASH/PENDING', async () => {
      const cash = await h.orders.create(
        undefined,
        KEY_A,
        await h.orderBody({ paymentMethodPreference: 'cash' }),
      );
      expect(cash.body.order.payment).toEqual({ method: 'CASH', status: 'PENDING', paidAt: null });
      expect(h.ordersRepo.orders.size).toBe(1);
    });

    it('notas saneadas: control/bidi => 400; guardadas sin PII en la auditoría', async () => {
      const bad = await err(
        h.orders.create(undefined, KEY_A, await h.orderBody({ notes: 'hola‮adiós' })),
      );
      expect(statusOf(bad)).toBe(400);
      const ok = await h.orders.create(
        undefined,
        KEY_B,
        await h.orderBody({ notes: '  sin wasabi  ' }),
      );
      expect(ok.body.order.notes).toBe('sin wasabi');
      expect(JSON.stringify(h.ordersRepo.audits)).not.toContain('wasabi');
    });

    it('extras y promociones: snapshot de nombres y precios; Σ promociones = descuento', async () => {
      const g = mid(1);
      h.modifiersRepo.seedGroup(groupRow(g, { minSelect: 1, maxSelect: 2 }), [
        optionRow(mid(11), g, { extraPrice: '5.00', sortOrder: 0 }),
        optionRow(mid(12), g, { extraPrice: '2.50', sortOrder: 1 }),
      ]);
      h.modifiersRepo.seedProduct(P1, [g]);
      const promo = h.repo.seed({ code: 'SUSHI10', kind: 'PERCENT', value: '10.00' });
      h.reader.promotionNames.set(promo.id, 'Diez por ciento');
      h.reader.modifierNames.set(mid(11), 'Aguacate');
      h.reader.modifierNames.set(mid(12), 'Queso crema');
      const input = await h.orderBody({
        cart: {
          branchId: A,
          lines: [
            {
              productId: P1,
              quantity: 2,
              selections: [
                { groupId: g, optionId: mid(11), quantity: 1 },
                { groupId: g, optionId: mid(12), quantity: 1 },
              ],
            },
          ],
        },
        couponCode: 'sushi10',
      });
      const { body: res } = await h.orders.create(undefined, KEY_A, input);
      // (85.00 + 7.50) x 2 = 185.00; descuento 10% sobre 170.00 (los extras no se descuentan) = 17.00.
      expect(res.order).toMatchObject({
        subtotal: '185.00',
        extrasTotal: '15.00',
        discountTotal: '17.00',
        total: '168.00',
        promotions: [{ name: 'Diez por ciento', amount: '17.00' }],
      });
      expect(res.order.lines[0]).toMatchObject({
        extrasPerUnit: '7.50',
        discount: '17.00',
        lineTotal: '168.00',
        modifiers: [
          { name: 'Aguacate', extraPrice: '5.00' },
          { name: 'Queso crema', extraPrice: '2.50' },
        ],
      });
      const stored = [...h.ordersRepo.orders.values()][0]?.input;
      const sum = stored?.promotions.reduce((s, p) => s + Number(p.amount) * 100, 0);
      expect(sum).toBe(Number(stored?.discountTotal) * 100);
    });

    it('una sola lectura de snapshot por pedido, con 30 líneas (sin N+1)', async () => {
      const lines = Array.from({ length: 30 }, (_, i) => ({
        productId: i % 2 === 0 ? P1 : P2,
        quantity: 1,
        selections: [],
      }));
      await h.orders.create(undefined, KEY_A, await h.orderBody({ cart: { branchId: A, lines } }));
      expect(h.reader.calls).toBe(1);
      expect(h.ordersRepo.calls.filter((c) => c === 'createOrder')).toHaveLength(1);
      expect(h.ordersRepo.calls.filter((c) => c === 'findById')).toHaveLength(0);
    });
  });

  describe('cotización (filas 3, 4, 12-17)', () => {
    it('bloqueos del cotizador => 422 CHECKOUT_BLOCKED con `blockers`; nada persistido', async () => {
      const input = await h.orderBody();
      h.state.accepted = false;
      h.state.reason = 'OUTSIDE_BUSINESS_HOURS';
      const e = await err(h.orders.create(undefined, KEY_A, input));
      expect([statusOf(e), codeOf(e)]).toEqual([422, 'CHECKOUT_BLOCKED']);
      expect((body(e)['extra'] as { blockers: { code: string }[] }).blockers[0]?.code).toBe(
        'BRANCH_CLOSED',
      );
      nothingPersisted();
    });

    it('OWN apagado => CHECKOUT_BLOCKED (no se crea); PedidosYa elegido => 422 DELIVERY_PROVIDER_NOT_SELECTABLE', async () => {
      const input = await ownDelivery();
      h.cover.result = coverageResult(); // OWN deshabilitado
      const blocked = await err(h.orders.create(undefined, KEY_A, input));
      expect(codeOf(blocked)).toBe('CHECKOUT_BLOCKED');
      const py = await err(
        h.orders.create(undefined, KEY_B, {
          ...input,
          fulfillment: { ...input.fulfillment, deliveryProvider: 'PEDIDOSYA' },
        }),
      );
      expect([statusOf(py), codeOf(py)]).toEqual([422, 'DELIVERY_PROVIDER_NOT_SELECTABLE']);
      nothingPersisted();
    });

    it('token vencido => 409 QUOTE_EXPIRED con cotización nueva y `changes: []`', async () => {
      const input = await h.orderBody();
      h.clock.current = minutes(11);
      const e = await err(h.orders.create(undefined, KEY_A, input));
      expect([statusOf(e), codeOf(e)]).toEqual([409, 'QUOTE_EXPIRED']);
      const extra = body(e)['extra'] as { changes: unknown[]; quote: { quote: { token: string } } };
      expect(extra.changes).toEqual([]);
      expect(extra.quote.quote.token).toEqual(expect.any(String));
      nothingPersisted();
    });

    it.each([
      ['ausente de forma (cadena basura)', () => 'basura'],
      ['firma mala', (t: string) => `${t.slice(0, -4)}AAAA`],
      ['recortado', (t: string) => t.slice(0, 20)],
    ])('token %s => 422 QUOTE_INVALID', async (_n, mutate) => {
      const input = await h.orderBody();
      const e = await err(
        h.orders.create(undefined, KEY_A, { ...input, quoteToken: mutate(input.quoteToken) }),
      );
      expect([statusOf(e), codeOf(e)]).toEqual([422, 'QUOTE_INVALID']);
      nothingPersisted();
    });

    it('sujeto distinto (token de invitado con sesión y a la inversa) y entrada distinta => 422 QUOTE_INVALID', async () => {
      const guestInput = await h.orderBody();
      const who = principal('user-1');
      h.identity.defaultPhone = '55559999';
      const e1 = await err(h.orders.create(who, KEY_A, { ...guestInput, contact: undefined }));
      expect(codeOf(e1)).toBe('QUOTE_INVALID');
      const authInput = await h.orderBody({}, who);
      const e2 = await err(
        h.orders.create(undefined, KEY_A, { ...authInput, contact: GUEST_CONTACT }),
      );
      expect(codeOf(e2)).toBe('QUOTE_INVALID');
      const e3 = await err(
        h.orders.create(undefined, KEY_B, {
          ...guestInput,
          cart: { branchId: A, lines: [{ productId: P1, quantity: 3, selections: [] }] },
        }),
      );
      expect(codeOf(e3)).toBe('QUOTE_INVALID');
      nothingPersisted();
    });

    it('cambio de precio (sube) y mejora (baja) => 409 QUOTE_CHANGED con `changes` y nueva cotización; no persiste (P52)', async () => {
      for (const price of ['90.00', '80.00']) {
        const input = await h.orderBody();
        const product = h.world.products.get(P1);
        if (!product) throw new Error('producto');
        h.world.seedProduct({ ...product, basePrice: price });
        const e = await err(h.orders.create(undefined, KEY_A, input));
        expect([statusOf(e), codeOf(e)]).toEqual([409, 'QUOTE_CHANGED']);
        const extra = body(e)['extra'] as {
          changes: { field: string; previous: string; current: string }[];
          quote: { total: string };
        };
        expect(extra.changes.map((c) => c.field)).toEqual(['subtotal', 'total', 'lines']);
        expect(extra.changes[1]).toEqual({
          field: 'total',
          previous: '170.00',
          current: `${(Number(price) * 2).toFixed(2)}`,
        });
        expect(extra.quote.total).toBe(`${(Number(price) * 2).toFixed(2)}`);
        h.world.seedProduct({ ...product, basePrice: '85.00' });
      }
      nothingPersisted();
    });

    it('cambio de tarifa de entrega => QUOTE_CHANGED (`deliveryFee`)', async () => {
      const input = await ownDelivery();
      h.cover.result = coverageResult({ own: ownZone('20.00') });
      const e = await err(h.orders.create(undefined, KEY_A, input));
      expect(codeOf(e)).toBe('QUOTE_CHANGED');
      expect(
        (body(e)['extra'] as { changes: { field: string }[] }).changes.map((c) => c.field),
      ).toEqual(['deliveryFee', 'total']);
    });

    it('sin CHECKOUT_QUOTE_SECRET (o < 32) => 503 ORDERS_UNAVAILABLE y nada persistido', async () => {
      for (const secret of [undefined, 'corto']) {
        const nh = ordersHarness({ secret });
        const input = await nh.orderBody();
        const e = await err(nh.orders.create(undefined, KEY_A, input));
        expect([statusOf(e), codeOf(e)]).toEqual([503, 'ORDERS_UNAVAILABLE']);
        expect(nh.ordersRepo.orders.size + nh.ordersRepo.keys.size).toBe(0);
        expect(nh.ordersRepo.calls).toEqual([]);
      }
    });

    it('un producto que desaparece entre la recotización y la lectura => QUOTE_CHANGED (líneas)', async () => {
      const input = await h.orderBody();
      h.reader.missingProducts.add(P1);
      const e = await err(h.orders.create(undefined, KEY_A, input));
      expect(codeOf(e)).toBe('QUOTE_CHANGED');
      nothingPersisted();
    });
  });

  describe('idempotencia (filas 24-29)', () => {
    it('misma clave y cuerpo => el MISMO pedido (replayed), sin recotizar, aun con el token vencido', async () => {
      const input = await h.orderBody();
      const first = await h.orders.create(undefined, KEY_A, input);
      const quotes = h.availability.canAcceptOrderNow.mock.calls.length;
      h.clock.current = minutes(30); // el token de la 1.ª petición ya venció
      const again = await h.orders.create(undefined, KEY_A, input);
      expect(again.replayed).toBe(true);
      expect(again.body.order).toEqual(first.body.order);
      expect(h.availability.canAcceptOrderNow.mock.calls.length).toBe(quotes); // no recotizó
      expect(h.ordersRepo.orders.size).toBe(1);
    });

    it('invitado: la repetición emite un token ADICIONAL y el original SIGUE válido; autenticado: `access=null`', async () => {
      const input = await h.orderBody();
      const first = await h.orders.create(undefined, KEY_A, input);
      const again = await h.orders.create(undefined, KEY_A, input);
      const [a, b] = [
        first.body.access?.guestToken as string,
        again.body.access?.guestToken as string,
      ];
      expect(b).toMatch(GUEST_TOKEN_PATTERN);
      expect(b).not.toBe(a);
      expect(h.ordersRepo.tokenIsActive(a, NOW)).toBe(true);
      expect(h.ordersRepo.tokenIsActive(b, NOW)).toBe(true);
      for (const token of [a, b]) {
        await expect(h.orders.get(undefined, first.body.order.id, token)).resolves.toMatchObject({
          id: first.body.order.id,
        });
      }

      const who = principal('user-9');
      h.identity.defaultPhone = '55559999';
      const authInput = await h.orderBody({}, who);
      await h.orders.create(who, KEY_B, authInput);
      const replay = await h.orders.create(who, KEY_B, authInput);
      expect(replay).toMatchObject({ replayed: true, body: { access: null } });
    });

    it('repeticiones sucesivas: solo se conservan los 5 tokens más recientes (el crecimiento está acotado)', async () => {
      const input = await h.orderBody();
      const first = await h.orders.create(undefined, KEY_A, input);
      const tokens = [first.body.access?.guestToken as string];
      for (let i = 0; i < 7; i += 1) {
        tokens.push(
          (await h.orders.create(undefined, KEY_A, input)).body.access?.guestToken as string,
        );
      }
      const active = tokens.filter((t) => h.ordersRepo.tokenIsActive(t, NOW));
      expect(active).toHaveLength(5);
      expect(active).toEqual(tokens.slice(-5));
      expect(h.ordersRepo.tokenIsActive(tokens[0] as string, NOW)).toBe(false);
    });

    it('la repetición con un token renovado (otra cotización) sigue siendo el mismo intento', async () => {
      const input = await h.orderBody();
      const first = await h.orders.create(undefined, KEY_A, input);
      const renewed = await h.orderBody();
      const again = await h.orders.create(undefined, KEY_A, { ...renewed, contact: input.contact });
      expect(again.replayed).toBe(true);
      expect(again.body.order.id).toBe(first.body.order.id);
    });

    it('misma clave con otro cuerpo => 409 IDEMPOTENCY_KEY_REUSED y no devuelve ni crea nada', async () => {
      const first = await h.orders.create(undefined, KEY_A, await h.orderBody());
      const other = await h.orderBody({
        cart: { branchId: A, lines: [{ productId: P2, quantity: 1, selections: [] }] },
      });
      const e = await err(h.orders.create(undefined, KEY_A, other));
      expect([statusOf(e), codeOf(e)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect(JSON.stringify(body(e))).not.toContain(first.body.order.id);
      const notes = await err(
        h.orders.create(undefined, KEY_A, { ...(await h.orderBody()), notes: 'otra' }),
      );
      expect(codeOf(notes)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(h.ordersRepo.orders.size).toBe(1);
    });

    it('las claves no se cruzan entre actores: cliente A, cliente B e invitado con la MISMA clave crean 3 pedidos', async () => {
      h.identity.defaultPhone = '55559999';
      const a = principal('user-a');
      const b = principal('user-b');
      const ids = new Set<string>();
      for (const who of [a, b, undefined]) {
        const r = await h.orders.create(who, KEY_A, await h.orderBody({}, who));
        expect(r.replayed).toBe(false);
        ids.add(r.body.order.id);
      }
      expect(ids.size).toBe(3);
    });

    it('formato de la clave: ausente o inválida => 400 IDEMPOTENCY_KEY_INVALID', async () => {
      for (const key of [
        undefined,
        '',
        'corta',
        `${keyOf('a')}!`,
        'x'.repeat(129),
        5,
        'a'.repeat(32), // 1 carácter distinto
        '123456789'.repeat(3), // 9 distintos (< 10)
      ]) {
        const e = await err(h.orders.create(undefined, key, await h.orderBody()));
        expect([statusOf(e), codeOf(e)]).toEqual([400, 'IDEMPOTENCY_KEY_INVALID']);
      }
      nothingPersisted();
    });

    it('10 solicitudes concurrentes con la misma clave => UN pedido y el mismo id en todas', async () => {
      h.ordersRepo.hook = () => new Promise((r) => setTimeout(r, 5));
      const input = await h.orderBody();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => h.orders.create(undefined, KEY_A, input)),
      );
      expect(h.ordersRepo.orders.size).toBe(1);
      expect(new Set(results.map((r) => r.body.order.id)).size).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(h.ordersRepo.audits).toHaveLength(1);
    });

    it('clave vencida (24 h) se purga y permite crear de nuevo', async () => {
      const input = await h.orderBody();
      const first = await h.orders.create(undefined, KEY_A, input);
      h.clock.current = new Date(NOW.getTime() + 25 * 3_600_000);
      const fresh = await h.orderBody();
      const second = await h.orders.create(undefined, KEY_A, fresh);
      expect(second.replayed).toBe(false);
      expect(second.body.order.id).not.toBe(first.body.order.id);
      expect(h.ordersRepo.calls).toContain('purgeExpired:key');
    });

    it('la purga de la clave solo ocurre si la fila se vio VENCIDA (sin fila o vigente: ninguna purga puntual)', async () => {
      await h.orders.create(undefined, KEY_A, await h.orderBody());
      expect(h.ordersRepo.calls).not.toContain('purgeExpired:key');
      expect(h.ordersRepo.calls).toContain('purgeExpired');
    });

    it('un fallo parcial revierte TODO (pedido, clave, token, auditoría) y el reintento con la misma clave funciona', async () => {
      const input = await h.orderBody();
      for (const step of ['items', 'audit'] as const) {
        h.ordersRepo.failAt = step;
        const e = await err(h.orders.create(undefined, KEY_A, input));
        expect(e).toBeInstanceOf(Error);
        nothingPersisted();
      }
      h.ordersRepo.failAt = null;
      const ok = await h.orders.create(undefined, KEY_A, input);
      expect(ok.replayed).toBe(false);
      expect(ok.body.order.orderNumber).toBe(1003); // los números consumidos por transacciones revertidas no se reutilizan
    });

    it('lock_timeout => 409 IDEMPOTENCY_IN_PROGRESS con Retry-After; sin conexión => 503 ORDERS_BUSY', async () => {
      const input = await h.orderBody();
      h.ordersRepo.failWith = { code: '55P03' };
      const e = await err(h.orders.create(undefined, KEY_A, input));
      expect([statusOf(e), codeOf(e)]).toEqual([409, 'IDEMPOTENCY_IN_PROGRESS']);
      expect(body(e)['retryAfter']).toBe(1);
      h.ordersRepo.failWith = { code: 'P2028' };
      const busy = await err(h.orders.create(undefined, KEY_A, input));
      expect([statusOf(busy), codeOf(busy)]).toEqual([503, 'ORDERS_BUSY']);
      nothingPersisted();
    });
  });

  describe('tope de pendientes, eventos y gate (filas 32, 34, 36)', () => {
    it('autenticado: el 4.º pedido pending => 429 PENDING_ORDERS_LIMIT (3 permitidos); otro cliente no se ve afectado', async () => {
      h.identity.defaultPhone = '55559999';
      const who = principal('user-1');
      for (let i = 0; i < 3; i += 1) {
        await h.orders.create(who, keyOf(i), await h.orderBody({}, who));
      }
      const e = await err(h.orders.create(who, KEY_B, await h.orderBody({}, who)));
      expect([statusOf(e), codeOf(e)]).toEqual([429, 'PENDING_ORDERS_LIMIT']);
      const other = principal('user-2');
      await expect(
        h.orders.create(other, keyOf('z'), await h.orderBody({}, other)),
      ).resolves.toMatchObject({ replayed: false });
    });

    it('invitado: NO se bloquea por teléfono (ni propio ni ajeno) => sin denegación dirigida', async () => {
      for (let i = 0; i < 5; i += 1) {
        // Mismo teléfono que usará "la víctima".
        await h.orders.create(undefined, keyOf(i), await h.orderBody());
      }
      const victim = await h.orders.create(undefined, KEY_B, await h.orderBody());
      expect(victim.replayed).toBe(false);
      expect(h.ordersRepo.orders.size).toBe(6);
      expect(h.ordersRepo.calls).not.toContain('countPending');
    });

    it('una sola adquisición del gate de pedidos por sección: crear <= 2 y repetir <= 2 (<= 3 siempre)', async () => {
      const run = vi.spyOn(h.gate, 'run');
      await h.orders.create(undefined, KEY_A, await h.orderBody());
      expect(run.mock.calls.length).toBeLessThanOrEqual(2);
      run.mockClear();
      await h.orders.create(undefined, KEY_A, await h.orderBody());
      expect(run.mock.calls.length).toBeLessThanOrEqual(2);
      run.mockClear();
      const who = principal('user-1');
      h.identity.defaultPhone = '55559999';
      await h.orders.create(who, keyOf('a'), await h.orderBody({}, who));
      expect(run.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('un 503 ORDERS_BUSY en la sección final NO repite la recotización (se paga una vez) y es reintentable con la misma clave', async () => {
      const input = await h.orderBody();
      // Gate saturado SOLO para la 2.ª sección: la 1.ª pasa y la 2.ª encuentra cola llena.
      const realRun = h.gate.run.bind(h.gate);
      let calls = 0;
      vi.spyOn(h.gate, 'run').mockImplementation(<T>(task: () => Promise<T>) => {
        calls += 1;
        return calls === 2 ? Promise.reject(ordersBusy()) : realRun(task);
      });
      const quotes = h.availability.canAcceptOrderNow.mock.calls.length;
      const e = await err(h.orders.create(undefined, KEY_A, input));
      expect([statusOf(e), codeOf(e)]).toEqual([503, 'ORDERS_BUSY']);
      expect(h.availability.canAcceptOrderNow.mock.calls.length - quotes).toBe(1);
      nothingPersisted();
      await expect(h.orders.create(undefined, KEY_A, input)).resolves.toMatchObject({
        replayed: false,
      });
    });

    it('saturar a la vez CHECKOUT_DB_GATE y ORDERS_DB_GATE no produce interbloqueo (los gates nunca se anidan: la recotización corre fuera de las secciones de pedidos)', async () => {
      const { ordersBusy: busy } = await import('./orders-errors.js');
      const { checkoutBusy } = await import('../checkout/checkout-errors.js');
      const ordersGate = new DbGate(1, 3, 1_500, busy);
      const checkoutGate = new DbGate(1, 3, 1_500, checkoutBusy);
      const gh = ordersHarness({ gate: ordersGate, checkoutGate });
      gh.ordersRepo.hook = () => new Promise((r) => setTimeout(r, 5));
      const bodies = [];
      for (let i = 0; i < 8; i += 1) {
        bodies.push(
          await gh.orderBody({ contact: { fullName: 'Ana Pérez', phone: `5555 ${1000 + i}` } }),
        );
      }
      const outcomes = await Promise.allSettled(
        bodies.map((b, i) => gh.orders.create(undefined, keyOf(i), b)),
      );
      // Todas terminan (éxito o 503 reintentable): ninguna queda colgada.
      for (const o of outcomes) {
        if (o.status === 'rejected') expect(statusOf(o.reason)).toBe(503);
      }
      expect(outcomes.some((o) => o.status === 'fulfilled')).toBe(true);
      expect(ordersGate.inFlight).toBe(0);
      expect(checkoutGate.inFlight).toBe(0);
      expect(ordersGate.waiting + checkoutGate.waiting).toBe(0);
    }, 5_000);

    it('el publicador de eventos se invoca tras el commit y su fallo NUNCA afecta la respuesta', async () => {
      h.events.fail = true;
      const r = await h.orders.create(undefined, KEY_A, await h.orderBody());
      expect(r.replayed).toBe(false);
      expect(h.published).toHaveLength(1);
      // Fallo síncrono del puerto.
      h.events.orderCreated = () => {
        throw new Error('boom');
      };
      await expect(h.orders.create(undefined, KEY_B, await h.orderBody())).resolves.toMatchObject({
        replayed: false,
      });
    });

    it('un fallo de creación no publica el evento', async () => {
      h.ordersRepo.failAt = 'items';
      await err(h.orders.create(undefined, KEY_A, await h.orderBody()));
      expect(h.published).toHaveLength(0);
    });

    it('semáforo saturado => 503 ORDERS_BUSY y libera el cupo', async () => {
      const gate = new DbGate(1, 0, 10, ordersBusy);
      const gh = ordersHarness({ gate });
      const input = await gh.orderBody();
      let release: () => void = () => undefined;
      const held = gate.run(() => new Promise<void>((r) => (release = r)));
      const e = await err(gh.orders.create(undefined, KEY_A, input));
      expect([statusOf(e), codeOf(e)]).toEqual([503, 'ORDERS_BUSY']);
      release();
      await held;
      await new Promise((r) => setTimeout(r, 0));
      await expect(gh.orders.create(undefined, KEY_A, input)).resolves.toMatchObject({
        replayed: false,
      });
      expect(gate.inFlight).toBe(0);
    });

    it('no hay pagos, entregas ni notificaciones: solo operaciones de pedido, sin llamadas externas', async () => {
      await h.orders.create(undefined, KEY_A, await h.orderBody());
      expect([...new Set(h.ordersRepo.calls)].sort()).toEqual([
        'createOrder',
        'findIdempotent',
        'purgeExpired',
      ]);
      expect(h.published).toHaveLength(1); // puerto no-op/doble: nada se envía de verdad
      expect(h.ordersRepo.history).toHaveLength(1);
    });
  });

  describe('GET /v1/orders/{id} (fila 30)', () => {
    it('dueño por sesión, invitado con token; ajeno, de invitado con JWT, token de otro pedido/vencido/revocado/ausente => MISMO 404', async () => {
      h.identity.defaultPhone = '55559999';
      const owner = principal('user-1');
      const stranger = principal('user-2');
      await h.identity.ensureCustomer(stranger);
      const mine = await h.orders.create(owner, KEY_A, await h.orderBody({}, owner));
      const guest = await h.orders.create(undefined, KEY_B, await h.orderBody());
      const mineId = mine.body.order.id;
      const guestId = guest.body.order.id;
      const token = guest.body.access?.guestToken as string;

      await expect(h.orders.get(owner, mineId, undefined)).resolves.toMatchObject({ id: mineId });
      await expect(h.orders.get(undefined, guestId, token)).resolves.toMatchObject({ id: guestId });

      const denied = [
        await err(h.orders.get(stranger, mineId, undefined)), // ajeno por JWT
        await err(h.orders.get(owner, guestId, undefined)), // pedido de invitado con JWT
        await err(h.orders.get(undefined, mineId, token)), // token de OTRO pedido
        await err(h.orders.get(undefined, guestId, undefined)), // sin credenciales
        await err(h.orders.get(undefined, '00000000-0000-4000-8000-000000000999', token)), // inexistente
        await err(h.orders.get(undefined, guestId, `smo_${'A'.repeat(43)}`)), // token no emitido
      ];
      for (const e of denied) expect(statusOf(e)).toBe(404);
      expect(new Set(denied.map((e) => JSON.stringify(body(e)))).size).toBe(1);
      expect(JSON.stringify(body(denied[0]))).not.toContain('code');

      h.clock.current = new Date(NOW.getTime() + 15 * 24 * 3_600_000); // token vencido (14 días)
      expect(statusOf(await err(h.orders.get(undefined, guestId, token)))).toBe(404);
    });

    it('token con formato inválido => 400 (sin consultar la BD)', async () => {
      const before = h.ordersRepo.calls.length;
      const e = await err(
        h.orders.get(undefined, '00000000-0000-4000-8000-000000000001', 'smo_corto'),
      );
      expect(statusOf(e)).toBe(400);
      expect(h.ordersRepo.calls.length).toBe(before);
    });

    it('la respuesta no incluye correo ni coordenadas', async () => {
      const r = await h.orders.create(
        undefined,
        KEY_A,
        await h.orderBody({ contact: { ...GUEST_CONTACT, email: 'ana@example.com' } }),
      );
      expect(JSON.stringify(r.body)).not.toMatch(/ana@example|latitude|longitude|customerEmail/);
    });
  });
});
