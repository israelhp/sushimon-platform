import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ordersBusy } from '../src/orders/orders-errors.js';
import {
  A,
  ADDR_OTHER,
  ADDR_OWN,
  coverageResult,
  MUNI_GUATEMALA,
  ownZone,
  P1,
  P2,
} from './support/checkout-harness.js';
import {
  KEY_A,
  KEY_B,
  keyOf,
  ordersHarness,
  type OrdersHarness,
} from './support/orders-harness.js';
import { createTestKeys, USER_ID, type TestKeys } from './support/tokens.js';

type Body = Record<string, unknown>;
const SECRET = 'e2e-secret-'.padEnd(40, 'x');
const OTHER_USER = '9a8b7c6d-1111-4222-8333-444455556666';
const GUEST = { fullName: 'Ana Pérez', phone: '5555 1234', email: 'ana@example.com' };
const strip = (body: Body) => ({ ...body, requestId: undefined });

function fakeDb() {
  return {
    customer: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
    staffUser: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
    $disconnect: () => Promise.resolve(),
  };
}

async function createApp(
  keys: TestKeys,
  h: OrdersHarness,
  opts: { secret?: string | null; gate?: unknown } = {},
) {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
    RATE_LIMIT_MAX: '1000',
    MEDIA_STORAGE_ADAPTER: 'mock',
  });
  if (opts.secret === null) delete process.env['CHECKOUT_QUOTE_SECRET'];
  else process.env['CHECKOUT_QUOTE_SECRET'] = opts.secret ?? SECRET;
  vi.resetModules();
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
  const { BranchOffersService } = await import('../src/branch-products/branch-offers.service.js');
  const { ModifierSelectionService } =
    await import('../src/modifiers/modifier-selection.service.js');
  const { PromotionCandidatesService } =
    await import('../src/promotions/promotion-candidates.service.js');
  const { BRANCH_AVAILABILITY_PORT } =
    await import('../src/branch-schedule/branch-availability.port.js');
  const { DELIVERY_COVERAGE_PORT } =
    await import('../src/delivery-coverage/delivery-coverage.service.js');
  const { CustomerAddressesService } =
    await import('../src/customers/addresses/customer-addresses.service.js');
  const { LocationsService } = await import('../src/locations/locations.service.js');
  const { CLOCK } = await import('../src/branch-schedule/clock.js');
  const { IdentityService } = await import('../src/identity/identity.service.js');
  const { OrdersRepository } = await import('../src/orders/orders.repository.js');
  const { OrderSnapshotReader } = await import('../src/orders/order-snapshot.reader.js');
  const { ORDERS_DB_GATE } = await import('../src/orders/orders-errors.js');
  const { ORDER_EVENTS_PUBLISHER } = await import('../src/orders/order-events.publisher.js');
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(fakeDb())
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .overrideProvider(BranchOffersService)
    .useValue(h.offers)
    .overrideProvider(ModifierSelectionService)
    .useValue(h.modifiers)
    .overrideProvider(PromotionCandidatesService)
    .useValue(h.candidates)
    .overrideProvider(BRANCH_AVAILABILITY_PORT)
    .useValue(h.availability)
    .overrideProvider(DELIVERY_COVERAGE_PORT)
    .useValue(h.coverage)
    .overrideProvider(CustomerAddressesService)
    .useValue(h.addresses)
    .overrideProvider(LocationsService)
    .useValue(h.locations)
    .overrideProvider(CLOCK)
    .useValue(h.clock)
    .overrideProvider(IdentityService)
    .useValue(h.identity)
    .overrideProvider(OrdersRepository)
    .useValue(h.ordersRepo)
    .overrideProvider(OrderSnapshotReader)
    .useValue(h.reader)
    .overrideProvider(ORDER_EVENTS_PUBLISHER)
    .useValue(h.events);
  if (opts.gate) builder = builder.overrideProvider(ORDERS_DB_GATE).useValue(opts.gate);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'], trustProxyHops: 1 });
  await app.init();
  return app;
}

const cartOf = (over: Body = {}) => ({
  branchId: A,
  lines: [{ productId: P1, quantity: 2, selections: [] }],
  ...over,
});
const quoteBody = (over: Body = {}) => ({
  cart: cartOf(),
  fulfillment: { type: 'PICKUP' },
  ...over,
});
const ownBody = (over: Body = {}) =>
  quoteBody({
    fulfillment: {
      type: 'DELIVERY',
      municipalityId: MUNI_GUATEMALA,
      zone: 'Zona 10',
      deliveryProvider: 'OWN',
    },
    ...over,
  });

describe('POST /v1/orders y GET /v1/orders/{id} (e2e, F20)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let h: OrdersHarness;
  let ip = 0;
  const logged: string[] = [];
  const http = () => request(app.getHttpServer());
  /** Cada solicitud llega desde una IP distinta (proxy de confianza): los contadores por IP no interfieren. */
  const nextIp = () => {
    ip += 1;
    return `10.2.${Math.floor(ip / 250)}.${ip % 250}`;
  };
  const quote = async (body: Body = quoteBody(), jwt?: string) => {
    const req = http().post('/v1/checkout/quote').set('X-Forwarded-For', nextIp());
    const res = await (jwt ? req.set('Authorization', `Bearer ${jwt}`) : req)
      .send(body)
      .expect(200);
    return (res.body as { quote: { token: string } }).quote.token;
  };
  const post = (body: unknown, opts: { key?: string | null; jwt?: string; ip?: string } = {}) => {
    let req = http()
      .post('/v1/orders')
      .set('X-Forwarded-For', opts.ip ?? nextIp());
    if (opts.key !== null) req = req.set('Idempotency-Key', opts.key ?? KEY_A);
    if (opts.jwt) req = req.set('Authorization', `Bearer ${opts.jwt}`);
    return req.send(body as object);
  };
  /** Cotiza y arma el cuerpo del pedido con el token aceptado. */
  const orderOf = async (over: Body = {}, jwt?: string, quoteOver: Body = {}) => {
    const q = (over['fulfillment'] ? { fulfillment: over['fulfillment'] } : {}) as Body;
    const token = await quote({ ...quoteBody(), ...q, ...quoteOver }, jwt);
    return {
      cart: cartOf(),
      fulfillment: { type: 'PICKUP' },
      quoteToken: token,
      ...(jwt ? {} : { contact: GUEST }),
      ...over,
    } as Body;
  };
  const get = (id: string, opts: { token?: string; jwt?: string; ip?: string } = {}) => {
    let req = http()
      .get(`/v1/orders/${id}`)
      .set('X-Forwarded-For', opts.ip ?? nextIp());
    if (opts.token) req = req.set('X-Order-Token', opts.token);
    if (opts.jwt) req = req.set('Authorization', `Bearer ${opts.jwt}`);
    return req;
  };

  beforeAll(async () => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        logged.push(String(message));
      });
    }
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    logged.length = 0;
    h = ordersHarness({ secret: SECRET });
    h.ownerOf.set(ADDR_OWN, USER_ID);
    h.ownerOf.set(ADDR_OTHER, OTHER_USER);
    h.identity.defaultPhone = '55559999';
    app = await createApp(keys, h);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('creación y acceso', () => {
    it('PICKUP de invitado: 201, Location, `private, no-store`, sin ETag, forma del contrato y token de invitado', async () => {
      const res = await post(await orderOf()).expect(201);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['etag']).toBeUndefined();
      expect(res.headers['idempotent-replayed']).toBeUndefined();
      const created = res.body as {
        order: Body & { id: string };
        access: { guestToken: string; expiresAt: string } | null;
      };
      expect(res.headers['location']).toBe(`/v1/orders/${created.order.id}`);
      expect(Object.keys(created).sort()).toEqual(['access', 'order']);
      expect(created.access?.guestToken).toMatch(/^smo_[A-Za-z0-9_-]{43}$/);
      expect(created.order).toMatchObject({
        status: 'pending',
        fulfillmentType: 'PICKUP',
        deliveryProvider: null,
        total: '170.00',
        deliveryFee: '0.00',
        address: null,
        displayNumber: 'MON-001001',
        contact: { fullName: 'Ana Pérez', phoneMasked: '****1234' },
        payment: { method: 'CASH', status: 'PENDING', paidAt: null },
      });
      expect(Object.keys(created.order).sort()).toEqual(
        [
          'address',
          'branchId',
          'contact',
          'currency',
          'deliveryFee',
          'deliveryProvider',
          'discountTotal',
          'displayNumber',
          'extrasTotal',
          'fulfillmentType',
          'id',
          'lines',
          'notes',
          'orderNumber',
          'payment',
          'placedAt',
          'promotions',
          'status',
          'subtotal',
          'total',
          'updatedAt',
        ].sort(),
      );
    });

    it('DELIVERY OWN con zona: tarifa de la zona y dirección de snapshot', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const res = await post(
        await orderOf({
          fulfillment: ownBody().fulfillment,
          deliveryAddress: { addressLine: '6a avenida 12-34', referenceNote: 'Portón negro' },
        }),
      ).expect(201);
      expect((res.body as { order: Body }).order).toMatchObject({
        deliveryProvider: 'OWN',
        deliveryFee: '15.00',
        total: '185.00',
        address: {
          municipalityName: 'Guatemala',
          zone: 'Zona 10',
          addressLine: '6a avenida 12-34',
        },
      });
    });

    it('autenticado: `access` es null, el pedido es del cliente y GET con su JWT lo devuelve', async () => {
      const jwt = await keys.sign();
      const res = await post(await orderOf({}, jwt), { jwt }).expect(201);
      const created = res.body as { order: { id: string }; access: unknown };
      expect(created.access).toBeNull();
      expect(h.identity.customers.get(USER_ID)).toBeDefined();
      const read = await get(created.order.id, { jwt }).expect(200);
      expect(read.headers['cache-control']).toBe('private, no-store');
      expect(read.headers['vary']).toMatch(/Authorization/);
      expect(read.headers['vary']).toMatch(/X-Order-Token/);
      expect(read.body).toEqual(created.order);
    });

    it('dirección guardada propia OK; ajena o inexistente => el MISMO 404; sin sesión => 401; con texto => 400', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const jwt = await keys.sign();
      const f = (id: string) => ({
        type: 'DELIVERY',
        customerAddressId: id,
        deliveryProvider: 'OWN',
      });
      const own = await orderOf({ fulfillment: f(ADDR_OWN) }, jwt);
      const ok = await post(own, { jwt }).expect(201);
      expect((ok.body as { order: Body }).order).toMatchObject({
        address: { addressLine: 'Calle 1' },
      });
      const foreign = await post(
        { ...own, fulfillment: f(ADDR_OTHER) },
        { jwt, key: KEY_B },
      ).expect(404);
      const missing = await post(
        { ...own, fulfillment: f('00000000-0000-4000-8000-00000000d0ff') },
        { jwt, key: keyOf('m') },
      ).expect(404);
      expect(strip(foreign.body as Body)).toEqual(strip(missing.body as Body));
      expect(foreign.headers['cache-control']).toBe('private, no-store');
      await post({ ...own, contact: GUEST }, { key: keyOf('n') }).expect(401);
      await post(
        { ...own, deliveryAddress: { addressLine: 'Calle falsa 123' } },
        { jwt, key: keyOf('o') },
      ).expect(400);
    });

    it('PedidosYa elegido => 422 DELIVERY_PROVIDER_NOT_SELECTABLE; nada persistido ni llamadas externas', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const input = {
        ...(await orderOf()),
        fulfillment: { ...ownBody().fulfillment, deliveryProvider: 'PEDIDOSYA' },
        deliveryAddress: { addressLine: '6a avenida 12-34' },
      };
      const res = await post(input).expect(422);
      expect((res.body as Body)['code']).toBe('DELIVERY_PROVIDER_NOT_SELECTABLE');
      expect(h.ordersRepo.orders.size).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('campos económicos, de estado o de identidad en la entrada => 400 (nada persistido)', async () => {
      const base = await orderOf();
      for (const extra of [
        { price: '1.00' },
        { total: '0.01' },
        { deliveryFee: '0.00' },
        { discount: '99.00' },
        { status: 'paid' },
        { paid: true },
        { coverage: 'OWN' },
        { customerId: USER_ID },
        { clientView: { total: '1.00' } },
      ]) {
        await post({ ...base, ...extra }, { key: keyOf('p') }).expect(400);
      }
      await post(
        {
          ...base,
          cart: cartOf({
            lines: [{ productId: P1, quantity: 1, selections: [], unitPrice: '1.00' }],
          }),
        },
        { key: keyOf('q') },
      ).expect(400);
      expect(h.ordersRepo.orders.size).toBe(0);
    });

    it('límites del cuerpo: > 64 KB y > 30 líneas => 400 QUOTE_LIMITS_EXCEEDED', async () => {
      const base = await orderOf();
      const big = await post({ ...base, notes: 'x'.repeat(70_000) }).expect(400);
      expect((big.body as Body)['code']).toBe('QUOTE_LIMITS_EXCEEDED');
      const lines = Array.from({ length: 31 }, () => ({
        productId: P1,
        quantity: 1,
        selections: [],
      }));
      const many = await post({ ...base, cart: cartOf({ lines }) }).expect(400);
      expect((many.body as Body)['code']).toBe('QUOTE_LIMITS_EXCEEDED');
      expect(many.headers['cache-control']).toBe('private, no-store');
    });

    it('Idempotency-Key ausente o malformada => 400 IDEMPOTENCY_KEY_INVALID', async () => {
      const base = await orderOf();
      for (const key of [null, 'corta', `${keyOf('a')}$`, 'a'.repeat(32), '123456789'.repeat(3)]) {
        const res = await post(base, { key }).expect(400);
        expect((res.body as Body)['code']).toBe('IDEMPOTENCY_KEY_INVALID');
      }
    });
  });

  describe('cotización (revalidación)', () => {
    it('QUOTE_CHANGED: precio distinto => 409 con `changes` y la cotización nueva (con su token); no persiste', async () => {
      const input = await orderOf();
      h.world.seedProduct({
        ...(h.world.products.get(P1) as NonNullable<ReturnType<typeof h.world.products.get>>),
        basePrice: '90.00',
      });
      const res = await post(input).expect(409);
      const body = res.body as {
        code: string;
        changes: { field: string }[];
        quote: { total: string; quote: { token: string } };
      };
      expect(body.code).toBe('QUOTE_CHANGED');
      expect(body.changes.map((c) => c.field)).toContain('total');
      expect(body.quote.total).toBe('180.00');
      expect(body.quote.quote.token).toMatch(/^v1\./);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(h.ordersRepo.orders.size).toBe(0);
      // Con el token nuevo (y clave nueva) se puede confirmar.
      await post({ ...input, quoteToken: body.quote.quote.token }, { key: KEY_B }).expect(201);
    });

    it('QUOTE_EXPIRED: 409 con `changes: []` y cotización nueva', async () => {
      const input = await orderOf();
      h.clock.current = new Date(h.clock.current.getTime() + 11 * 60_000);
      const res = await post(input).expect(409);
      expect(res.body).toMatchObject({ code: 'QUOTE_EXPIRED', changes: [] });
      expect((res.body as { quote: unknown }).quote).toBeDefined();
    });

    it('QUOTE_INVALID: token manipulado, de otro sujeto o de otra entrada => 422', async () => {
      const input = await orderOf();
      const token = input['quoteToken'] as string;
      for (const bad of ['basura', `${token.slice(0, -3)}AAA`]) {
        const res = await post({ ...input, quoteToken: bad }).expect(422);
        expect((res.body as Body)['code']).toBe('QUOTE_INVALID');
      }
      const jwt = await keys.sign();
      const withSession = await post({ ...input, contact: undefined }, { jwt, key: KEY_B }).expect(
        422,
      );
      expect((withSession.body as Body)['code']).toBe('QUOTE_INVALID');
      const other = await post(
        { ...input, cart: cartOf({ lines: [{ productId: P2, quantity: 1, selections: [] }] }) },
        { key: keyOf('r') },
      ).expect(422);
      expect((other.body as Body)['code']).toBe('QUOTE_INVALID');
    });

    it('token ausente => 400; CHECKOUT_BLOCKED con `blockers` (sucursal cerrada) => 422', async () => {
      const input = await orderOf();
      const withoutToken = { ...input };
      delete withoutToken['quoteToken'];
      await post(withoutToken).expect(400);
      h.state.accepted = false;
      h.state.reason = 'OUTSIDE_BUSINESS_HOURS';
      const res = await post(input).expect(422);
      expect(res.body).toMatchObject({
        code: 'CHECKOUT_BLOCKED',
        blockers: [{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }],
      });
    });

    it('F24: `card` y `bank_transfer` => 400 de validación (solo efectivo); `cash` => pago CASH/PENDING', async () => {
      for (const method of ['card', 'bank_transfer']) {
        const res = await post(await orderOf({ paymentMethodPreference: method })).expect(400);
        expect((res.body as Body)['code']).not.toBe('PAYMENT_METHOD_UNAVAILABLE');
      }
      const cash = await post(await orderOf({ paymentMethodPreference: 'cash' }), {
        key: KEY_B,
      }).expect(201);
      expect((cash.body as { order: { payment: Body } }).order.payment).toEqual({
        method: 'CASH',
        status: 'PENDING',
        paidAt: null,
      });
    });

    it('sin CHECKOUT_QUOTE_SECRET => 503 ORDERS_UNAVAILABLE (no-store) y nada persistido', async () => {
      await app.close();
      h = ordersHarness({ secret: undefined });
      app = await createApp(keys, h, { secret: null });
      const res = await post({
        cart: cartOf(),
        fulfillment: { type: 'PICKUP' },
        quoteToken: 'v1.a.b',
        contact: GUEST,
      }).expect(503);
      expect(res.body).toMatchObject({ code: 'ORDERS_UNAVAILABLE', statusCode: 503 });
      expect(res.headers['retry-after']).toBe('3');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(h.ordersRepo.orders.size).toBe(0);
    });
  });

  describe('idempotencia', () => {
    it('misma clave y cuerpo => 200 + Idempotent-Replayed, MISMO pedido y token ADICIONAL (el original sigue válido)', async () => {
      const input = await orderOf();
      const first = await post(input).expect(201);
      const again = await post(input).expect(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.headers['cache-control']).toBe('private, no-store');
      const a = first.body as { order: { id: string }; access: { guestToken: string } };
      const b = again.body as { order: { id: string }; access: { guestToken: string } };
      expect(b.order).toEqual(a.order);
      expect(b.access.guestToken).not.toBe(a.access.guestToken);
      await get(a.order.id, { token: a.access.guestToken }).expect(200);
      await get(a.order.id, { token: b.access.guestToken }).expect(200);
      expect(h.ordersRepo.orders.size).toBe(1);
    });

    it('repetición con el token vencido: devuelve el pedido original (sin QUOTE_EXPIRED)', async () => {
      const input = await orderOf();
      await post(input).expect(201);
      h.clock.current = new Date(h.clock.current.getTime() + 30 * 60_000);
      await post(input).expect(200);
    });

    it('misma clave con OTRO cuerpo => 409 IDEMPOTENCY_KEY_REUSED sin filtrar el pedido original', async () => {
      const input = await orderOf();
      const first = await post(input).expect(201);
      const other = await orderOf({
        cart: cartOf({ lines: [{ productId: P2, quantity: 1, selections: [] }] }),
      });
      const res = await post(other).expect(409);
      expect((res.body as Body)['code']).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(JSON.stringify(res.body)).not.toContain(
        (first.body as { order: { id: string } }).order.id,
      );
    });

    it('concurrencia simulada: 6 solicitudes simultáneas con la misma clave => un pedido, mismo id', async () => {
      h.ordersRepo.hook = () => new Promise((r) => setTimeout(r, 20));
      const input = await orderOf();
      const results = await Promise.all(Array.from({ length: 6 }, () => post(input)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
      expect(new Set(results.map((r) => (r.body as { order: { id: string } }).order.id)).size).toBe(
        1,
      );
      expect(h.ordersRepo.orders.size).toBe(1);
    });

    it('lock_timeout => 409 IDEMPOTENCY_IN_PROGRESS con Retry-After: 1', async () => {
      h.ordersRepo.failWith = { code: '55P03' };
      const res = await post(await orderOf()).expect(409);
      expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
      expect(res.headers['retry-after']).toBe('1');
    });

    it('semáforo saturado => 503 ORDERS_BUSY (no-store, código público) y libera el cupo', async () => {
      await app.close();
      const { DbGate } = await import('../src/common/concurrency/db-gate.js');
      const gate = new DbGate(1, 0, 10, ordersBusy);
      app = await createApp(keys, h, { gate });
      const input = await orderOf();
      let release: () => void = () => undefined;
      const held = gate.run(() => new Promise<void>((r) => (release = r)));
      const res = await post(input).expect(503);
      expect(res.body).toMatchObject({ code: 'ORDERS_BUSY' });
      expect(res.headers['retry-after']).toBe('2');
      expect(res.headers['cache-control']).toBe('private, no-store');
      release();
      await held;
      await new Promise((r) => setTimeout(r, 0));
      await post(input).expect(201);
    });
  });

  describe('GET /v1/orders/{id}: acceso y 404 uniforme', () => {
    it('invitado con token OK; ajeno por JWT, pedido de invitado con JWT, token de otro pedido, token inventado y sin credenciales => el MISMO 404 sin `code`', async () => {
      const guest = await post(await orderOf()).expect(201);
      const g = guest.body as { order: { id: string }; access: { guestToken: string } };
      const jwtOwner = await keys.sign();
      const mine = await post(await orderOf({}, jwtOwner), { jwt: jwtOwner, key: KEY_B }).expect(
        201,
      );
      const mineId = (mine.body as { order: { id: string } }).order.id;
      const stranger = await keys.sign({ sub: OTHER_USER });
      await h.identity.ensureCustomer({ authUserId: OTHER_USER } as never);

      const ok = await get(g.order.id, { token: g.access.guestToken }).expect(200);
      expect(ok.headers['cache-control']).toBe('private, no-store');
      expect(JSON.stringify(ok.body)).not.toMatch(/ana@example|latitude|longitude|5555 ?1234/);
      expect((ok.body as { contact: Body }).contact).toEqual({
        fullName: 'Ana Pérez',
        phoneMasked: '****1234',
      });

      const denied = [
        await get(mineId, { jwt: stranger }).expect(404),
        await get(g.order.id, { jwt: jwtOwner }).expect(404),
        await get(mineId, { token: g.access.guestToken }).expect(404),
        await get(g.order.id, { token: `smo_${'B'.repeat(43)}` }).expect(404),
        await get(g.order.id).expect(404),
        await get('00000000-0000-4000-8000-000000000999', { token: g.access.guestToken }).expect(
          404,
        ),
      ];
      expect(new Set(denied.map((r) => JSON.stringify(strip(r.body as Body)))).size).toBe(1);
      expect((denied[0]?.body as Body)['code']).toBeUndefined();
      for (const r of denied) expect(r.headers['cache-control']).toBe('private, no-store');
    });

    it('token vencido (14 días) => 404; `id` o token con formato inválido => 400; JWT inválido => 401', async () => {
      const guest = await post(await orderOf()).expect(201);
      const g = guest.body as { order: { id: string }; access: { guestToken: string } };
      await get('no-es-uuid', { token: g.access.guestToken }).expect(400);
      await get(g.order.id, { token: 'smo_corto' }).expect(400);
      await get(g.order.id, { jwt: 'basura' }).expect(401);
      h.clock.current = new Date(h.clock.current.getTime() + 15 * 86_400_000);
      await get(g.order.id, { token: g.access.guestToken }).expect(404);
    });
  });

  describe('límites de tasa y tope de pendientes (fila 32)', () => {
    it('crear: 10/min por IP; la 11.ª => 429 RATE_LIMITED con Retry-After y `private, no-store`', async () => {
      const ipFixed = '10.99.0.1';
      for (let i = 0; i < 10; i += 1) {
        await post({ nada: true }, { ip: ipFixed, key: keyOf(i) }).expect(400);
      }
      const res = await post({ nada: true }, { ip: ipFixed, key: keyOf('z') }).expect(429);
      expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(res.headers['retry-after']).toBeDefined();
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('crear: 10/min por ACTOR aunque cambie la IP; otro actor no se ve afectado', async () => {
      const jwt = await keys.sign();
      for (let i = 0; i < 10; i += 1) {
        await post({ nada: true }, { jwt, key: keyOf(i) }).expect(400);
      }
      await post({ nada: true }, { jwt, key: keyOf('z') }).expect(429);
      const other = await keys.sign({ sub: OTHER_USER });
      await post({ nada: true }, { jwt: other, key: keyOf('y') }).expect(400);
    });

    it('leer: 30/min por actor; un invitado sin sesión cae a su IP (el contador por actor es el más estricto) => la 31.ª es 429 con Retry-After', async () => {
      const id = '00000000-0000-4000-8000-000000000999';
      for (let i = 0; i < 30; i += 1) await get(id, { ip: '10.98.0.1' }).expect(404);
      const res = await get(id, { ip: '10.98.0.1' }).expect(429);
      expect(res.headers['retry-after']).toBeDefined();
      expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
      const jwt = await keys.sign();
      for (let i = 0; i < 30; i += 1) await get(id, { jwt }).expect(404);
      await get(id, { jwt }).expect(429);
      // Otra IP y otro actor siguen sin límite.
      await get(id, { ip: '10.98.0.2' }).expect(404);
    });

    it('tope de pedidos pending del CLIENTE autenticado (3) => 429 PENDING_ORDERS_LIMIT', async () => {
      const jwt = await keys.sign();
      for (let i = 0; i < 3; i += 1) {
        await post(await orderOf({}, jwt), { jwt, key: keyOf(i) }).expect(201);
      }
      const res = await post(await orderOf({}, jwt), { jwt, key: KEY_B }).expect(429);
      expect(res.body).toMatchObject({ code: 'PENDING_ORDERS_LIMIT' });
      expect(res.headers['retry-after']).toBeUndefined();
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('invitado: NO se bloquea por teléfono (sin denegación dirigida a un teléfono ajeno)', async () => {
      for (let i = 0; i < 4; i += 1) {
        await post(await orderOf(), { key: keyOf(i) }).expect(201);
      }
      expect(h.ordersRepo.orders.size).toBe(4);
    });
  });

  describe('privacidad y operación', () => {
    it('REGRESIÓN: el resto de rutas protegidas sigue exigiendo JWT (el guard global no se abrió)', async () => {
      await http().get('/v1/me').expect(401);
      await http().post('/v1/admin/promotions').send({}).expect(401);
    });

    it('los logs no contienen contacto, notas, token de invitado, quoteToken ni la clave de idempotencia', async () => {
      const input = await orderOf({ notes: 'sin wasabi por favor' });
      const res = await post(input, { key: 'KEY-SECRETA-0123456789abc' }).expect(201);
      await post(input, { key: 'KEY-SECRETA-0123456789abc' }).expect(200);
      await post({ ...input, quoteToken: 'basura' }, { key: 'OTRA-SECRETA-0123456789abcd' }).expect(
        422,
      );
      const guestToken = (res.body as { access: { guestToken: string } }).access.guestToken;
      const all = logged.join('\n');
      for (const secret of [
        'Ana',
        '5555',
        '55551234',
        'ana@example.com',
        'wasabi',
        guestToken,
        input['quoteToken'] as string,
        'KEY-SECRETA',
        'OTRA-SECRETA',
        '6a avenida',
      ]) {
        expect(all).not.toContain(secret);
      }
      expect(all).toMatch(/order\.created orderId=/);
    });

    it('sin pagos, entregas ni notificaciones reales: solo el repositorio de pedidos recibe escrituras', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await post(await orderOf()).expect(201);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(h.published).toHaveLength(1);
      fetchSpy.mockRestore();
    });
  });
});
