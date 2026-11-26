import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { ordersBusy } from '../src/orders/orders-errors.js';
import {
  A,
  ADDR_OTHER,
  ADDR_OWN,
  coverageResult,
  MUNI_GUATEMALA,
  ownZone,
  P1,
} from './support/checkout-harness.js';
import { KEY_A, keyOf, ordersHarness, type OrdersHarness } from './support/orders-harness.js';
import { createTestKeys, USER_ID, type TestKeys } from './support/tokens.js';

type Body = Record<string, unknown>;
const SECRET = 'e2e-secret-'.padEnd(40, 'x');
const OTHER_USER = '9a8b7c6d-1111-4222-8333-444455556666';
const GUEST = { fullName: 'Ana Pérez', phone: '5555 1234', email: 'ana@example.com' };
const NOTES = 'sin wasabi por favor';
const strip = (body: Body) => ({ ...body, requestId: undefined });
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000999';

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

const cartOf = () => ({ branchId: A, lines: [{ productId: P1, quantity: 2, selections: [] }] });

interface Created {
  order: { id: string };
  access: { guestToken: string } | null;
}

describe('GET /v1/orders/{id}/tracking (e2e, F21)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let h: OrdersHarness;
  let ip = 0;
  const logged: string[] = [];
  const http = () => request(app.getHttpServer());
  const nextIp = () => {
    ip += 1;
    return `10.3.${Math.floor(ip / 250)}.${ip % 250}`;
  };
  const quote = async (fulfillment: Body, jwt?: string) => {
    const req = http().post('/v1/checkout/quote').set('X-Forwarded-For', nextIp());
    const res = await (jwt ? req.set('Authorization', `Bearer ${jwt}`) : req)
      .send({ cart: cartOf(), fulfillment })
      .expect(200);
    return (res.body as { quote: { token: string } }).quote.token;
  };
  /** Crea un pedido real (con el POST de F20 sobre el doble en memoria). */
  const place = async (
    opts: { jwt?: string; fulfillment?: Body; extra?: Body; key?: string } = {},
  ): Promise<Created> => {
    // ADR-0036: por defecto, a domicilio con zona propia (tarifa 0.00 del doble de cobertura).
    const fulfillment = opts.fulfillment ?? {
      type: 'DELIVERY',
      municipalityId: MUNI_GUATEMALA,
      zone: 'Zona 10',
    };
    const token = await quote(fulfillment, opts.jwt);
    let req = http()
      .post('/v1/orders')
      .set('X-Forwarded-For', nextIp())
      .set('Idempotency-Key', opts.key ?? KEY_A);
    if (opts.jwt) req = req.set('Authorization', `Bearer ${opts.jwt}`);
    const res = await req
      .send({
        cart: cartOf(),
        fulfillment,
        ...(fulfillment['customerAddressId']
          ? {}
          : { deliveryAddress: { addressLine: '6a avenida 12-34' } }),
        quoteToken: token,
        ...(opts.jwt ? {} : { contact: GUEST }),
        notes: NOTES,
        ...opts.extra,
      })
      .expect(201);
    return res.body as Created;
  };
  const track = (id: string, opts: { token?: string; jwt?: string; ip?: string } = {}) => {
    let req = http()
      .get(`/v1/orders/${id}/tracking`)
      .set('X-Forwarded-For', opts.ip ?? nextIp());
    if (opts.token) req = req.set('X-Order-Token', opts.token);
    if (opts.jwt) req = req.set('Authorization', `Bearer ${opts.jwt}`);
    return req;
  };
  const getOrder = (id: string, opts: { token?: string; ip?: string } = {}) => {
    let req = http()
      .get(`/v1/orders/${id}`)
      .set('X-Forwarded-For', opts.ip ?? nextIp());
    if (opts.token) req = req.set('X-Order-Token', opts.token);
    return req;
  };
  const at = (m: number) => new Date(h.clock.current.getTime() + m * 60_000);

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

  it('invitado con token: 200, `private, no-store`, Vary correcto, sin ETag y forma exacta del contrato', async () => {
    const created = await place();
    const res = await track(created.order.id, { token: created.access?.guestToken }).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['vary']).toMatch(/Authorization/);
    expect(res.headers['vary']).toMatch(/X-Order-Token/);
    const t = res.body as Body;
    expect(Object.keys(t).sort()).toEqual(
      [
        'branchId',
        'delivery',
        'displayNumber',
        'events',
        'eventsTruncated',
        'fulfillmentType',
        'generatedAt',
        'orderId',
        'payment',
        'placedAt',
        'pollAfterSeconds',
        'publicStatus',
        'status',
        'steps',
        'terminal',
        'updatedAt',
      ].sort(),
    );
    expect(t).toMatchObject({
      orderId: created.order.id,
      displayNumber: 'MON-001001',
      status: 'pending',
      publicStatus: 'received',
      terminal: false,
      fulfillmentType: 'DELIVERY',
      delivery: { provider: 'OWN', status: null },
      pollAfterSeconds: 15,
      eventsTruncated: false,
    });
    expect((t['events'] as Body[]).map((e) => Object.keys(e).sort())).toEqual([
      ['occurredAt', 'publicStatus', 'seq', 'status'],
    ]);
    expect((t['steps'] as { phase: string }[]).map((s) => s.phase)).toEqual([
      'received',
      'accepted',
      'preparing',
      'ready',
      'on_the_way',
      'completed',
    ]);
  });

  it('sin PII ni campos internos: ni contacto, correo, notas, importes, líneas, token ni ids de personal', async () => {
    const created = await place();
    const token = created.access?.guestToken as string;
    h.ordersRepo.setTracking(created.order.id, 'accepted', [
      { newStatus: 'pending', changedAt: at(0) },
      { newStatus: 'accepted', changedAt: at(2) },
    ]);
    const res = await track(created.order.id, { token }).expect(200);
    const raw = JSON.stringify(res.body);
    for (const forbidden of [
      'Ana',
      '5555',
      '55551234',
      'ana@example',
      'wasabi',
      token,
      '170.00',
      'total',
      'subtotal',
      'lines',
      'contact',
      'address',
      'notes',
      'changedBy',
      'changed_by',
      'reason',
      'oldStatus',
      'old_status',
      'customerId',
      'latitude',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('dueño con JWT: 200; ajeno => 404; el cliente con JWT NO ve un pedido de invitado', async () => {
    const jwt = await keys.sign();
    const mine = await place({ jwt });
    const guest = await place({ key: keyOf('g') });
    expect(mine.access).toBeNull();
    const ok = await track(mine.order.id, { jwt }).expect(200);
    expect((ok.body as Body)['orderId']).toBe(mine.order.id);
    const stranger = await keys.sign({ sub: OTHER_USER });
    await h.identity.ensureCustomer({ authUserId: OTHER_USER } as never);
    await track(mine.order.id, { jwt: stranger }).expect(404);
    await track(guest.order.id, { jwt }).expect(404);
  });

  it('sin token, token inválido/inventado/de otro pedido/vencido/revocado e inexistente => el MISMO 404 (cuerpo y cabeceras) que `getOrder`', async () => {
    const a = await place();
    const b = await place({ key: keyOf('b') });
    const tokenA = a.access?.guestToken as string;
    const reference = await getOrder(a.order.id, { token: `smo_${'B'.repeat(43)}` }).expect(404);
    const denied = [
      await track(a.order.id).expect(404),
      await track(a.order.id, { token: `smo_${'B'.repeat(43)}` }).expect(404),
      await track(a.order.id, { token: b.access?.guestToken }).expect(404),
      await track(UNKNOWN_ID, { token: tokenA }).expect(404),
    ];
    h.ordersRepo.tokens.find((t) => t.orderId === b.order.id)!.revokedAt = new Date();
    denied.push(await track(b.order.id, { token: b.access?.guestToken }).expect(404));
    h.clock.current = new Date(h.clock.current.getTime() + 15 * 86_400_000);
    denied.push(await track(a.order.id, { token: tokenA }).expect(404));
    for (const r of denied) {
      expect(strip(r.body as Body)).toEqual(strip(reference.body as Body));
      expect((r.body as Body)['code']).toBeUndefined();
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['etag']).toBeUndefined();
      expect(r.headers['vary']).toMatch(/X-Order-Token/);
    }
  });

  it('formato de `id` o token inválido => 400 (private) sin consultar el repositorio; JWT inválido => 401', async () => {
    const created = await place();
    h.ordersRepo.calls.length = 0;
    const bad1 = await track('no-es-uuid', { token: created.access?.guestToken }).expect(400);
    const bad2 = await track(created.order.id, { token: 'smo_corto' }).expect(400);
    await track(created.order.id, { jwt: 'basura' }).expect(401);
    expect(h.ordersRepo.calls.filter((c) => c.startsWith('findTracking'))).toEqual([]);
    for (const r of [bad1, bad2]) expect(r.headers['cache-control']).toBe('private, no-store');
  });

  it('DELIVERY OWN / DELIVERY PEDIDOSYA (registro) y PICKUP HISTÓRICO: delivery y recorrido según modalidad', async () => {
    // PICKUP histórico (ADR-0036): ya no se puede crear; el registro se fabrica y el seguimiento sigue respondiendo.
    const pickup = await place();
    const legacy = h.ordersRepo.orders.get(pickup.order.id);
    if (!legacy) throw new Error('sin pedido');
    legacy.record.fulfillmentType = 'PICKUP';
    legacy.record.deliveryProvider = null;
    const p = await track(pickup.order.id, { token: pickup.access?.guestToken }).expect(200);
    expect((p.body as Body)['delivery']).toBeNull();
    expect((p.body as Body)['fulfillmentType']).toBe('PICKUP');
    expect(((p.body as Body)['steps'] as { phase: string }[]).map((s) => s.phase)).not.toContain(
      'on_the_way',
    );

    h.cover.result = coverageResult({ own: ownZone('15.00') });
    const own = await place({
      key: keyOf('own'),
      fulfillment: {
        type: 'DELIVERY',
        municipalityId: MUNI_GUATEMALA,
        zone: 'Zona 10',
        deliveryProvider: 'OWN',
      },
      extra: { deliveryAddress: { addressLine: '6a avenida 12-34', referenceNote: 'Portón' } },
    });
    const o = await track(own.order.id, { token: own.access?.guestToken }).expect(200);
    expect((o.body as Body)['delivery']).toEqual({ provider: 'OWN', status: null });
    expect(((o.body as Body)['steps'] as { phase: string }[]).map((s) => s.phase)).toContain(
      'on_the_way',
    );
    expect(JSON.stringify(o.body)).not.toMatch(/6a avenida|Portón|Zona 10|15\.00/);

    const stored = h.ordersRepo.orders.get(own.order.id);
    if (!stored) throw new Error('sin pedido');
    stored.record.deliveryProvider = 'PEDIDOSYA';
    const py = await track(own.order.id, { token: own.access?.guestToken }).expect(200);
    expect((py.body as Body)['delivery']).toEqual({ provider: 'PEDIDOSYA', status: null });
  });

  it('historial inconsistente (salto, duplicado, estado distinto del último evento) se entrega tal cual', async () => {
    const created = await place();
    h.ordersRepo.setTracking(created.order.id, 'ready', [
      { newStatus: 'pending', changedAt: at(0) },
      { newStatus: 'preparing', changedAt: at(4) },
      { newStatus: 'preparing', changedAt: at(5) },
      { newStatus: 'accepted', changedAt: at(6) },
    ]);
    const res = await track(created.order.id, { token: created.access?.guestToken }).expect(200);
    const t = res.body as {
      status: string;
      publicStatus: string;
      events: { seq: number; status: string }[];
      steps: { phase: string; reachedAt: string | null }[];
    };
    expect(t.status).toBe('ready');
    expect(t.publicStatus).toBe('ready');
    expect(t.events.map((e) => [e.seq, e.status])).toEqual([
      [1, 'pending'],
      [2, 'preparing'],
      [3, 'preparing'],
      [4, 'accepted'],
    ]);
    expect(t.steps.find((s) => s.phase === 'ready')?.reachedAt).toBeNull();
  });

  it('terminal: pollAfterSeconds null; rejected corta el recorrido', async () => {
    const created = await place();
    h.ordersRepo.setTracking(created.order.id, 'rejected', [
      { newStatus: 'pending', changedAt: at(0) },
      { newStatus: 'rejected', changedAt: at(1) },
    ]);
    const res = await track(created.order.id, { token: created.access?.guestToken }).expect(200);
    expect(res.body).toMatchObject({
      terminal: true,
      publicStatus: 'rejected',
      pollAfterSeconds: null,
    });
    expect(((res.body as Body)['steps'] as { phase: string }[]).map((s) => s.phase)).toEqual([
      'received',
      'rejected',
    ]);
  });

  it('más de 50 eventos: se conserva el ÚLTIMO (los más antiguos se omiten) con eventsTruncated y seq 1..50', async () => {
    const created = await place();
    const events = Array.from({ length: 60 }, (_, i) => ({
      newStatus: i === 59 ? 'cancelled' : i % 2 ? 'accepted' : 'pending',
      changedAt: at(i),
    }));
    h.ordersRepo.setTracking(created.order.id, 'cancelled', events);
    const res = await track(created.order.id, { token: created.access?.guestToken }).expect(200);
    const t = res.body as {
      events: { seq: number; status: string; occurredAt: string }[];
      eventsTruncated: boolean;
      terminal: boolean;
    };
    expect(t.eventsTruncated).toBe(true);
    expect(t.events).toHaveLength(50);
    expect(t.events.at(-1)).toMatchObject({
      seq: 50,
      status: 'cancelled',
      occurredAt: at(59).toISOString(),
    });
    expect(t.events[0]?.occurredAt).toBe(at(10).toISOString());
    expect(t.terminal).toBe(true);
  });

  it('cabeceras de los 404 (inexistente, ajeno, vencido, revocado, sin token) IDÉNTICAS byte a byte y con Vary en errores', async () => {
    const a = await place();
    const b = await place({ key: keyOf('hb') });
    const jwt = await keys.sign();
    const volatile = new Set(['date', 'x-request-id', 'content-length']);
    const headersOf = (r: { headers: Record<string, unknown> }) =>
      JSON.stringify(
        Object.entries(r.headers)
          .filter(
            ([k]) => !volatile.has(k) && !k.startsWith('ratelimit') && !k.startsWith('x-ratelimit'),
          )
          .sort(([x], [y]) => x.localeCompare(y)),
      );
    h.ordersRepo.tokens.find((t) => t.orderId === b.order.id)!.revokedAt = new Date();
    const results = [
      await track(UNKNOWN_ID, { token: a.access?.guestToken }).expect(404),
      await track(a.order.id).expect(404),
      await track(a.order.id, { jwt }).expect(404), // invitado consultado con JWT
      await track(b.order.id, { token: b.access?.guestToken }).expect(404), // revocado
    ];
    h.clock.current = new Date(h.clock.current.getTime() + 15 * 86_400_000);
    results.push(await track(a.order.id, { token: a.access?.guestToken }).expect(404)); // vencido
    const reference = headersOf(results[0] as { headers: Record<string, unknown> });
    for (const r of results) {
      expect(headersOf(r)).toBe(reference);
      expect(r.headers['vary']).toMatch(/Authorization/);
      expect(r.headers['vary']).toMatch(/X-Order-Token/);
    }
    // Los errores de formato (400) y el 401 también llevan Vary y `private, no-store`.
    for (const r of [
      await track('no-es-uuid').expect(400),
      await track(a.order.id, { jwt: 'basura' }).expect(401),
    ]) {
      expect(r.headers['vary']).toMatch(/X-Order-Token/);
      expect(r.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('el token NO se acepta en query string ni en el cuerpo (solo en la cabecera X-Order-Token)', async () => {
    const created = await place();
    const token = created.access?.guestToken as string;
    await http()
      .get(
        `/v1/orders/${created.order.id}/tracking?token=${token}&X-Order-Token=${token}&orderToken=${token}`,
      )
      .set('X-Forwarded-For', nextIp())
      .expect(404);
    await http()
      .get(`/v1/orders/${created.order.id}/tracking`)
      .set('X-Forwarded-For', nextIp())
      .send({ token, orderToken: token })
      .expect(404);
    await track(created.order.id, { token }).expect(200);
  });

  it('CORS: el preflight con X-Order-Token desde un origen NO listado no se autoriza; desde el listado sí', async () => {
    const id = UNKNOWN_ID;
    const bad = await http()
      .options(`/v1/orders/${id}/tracking`)
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-order-token');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    // (`access-control-allow-headers` puede reflejarse; sin `allow-origin` el navegador bloquea la lectura.)
    const ok = await http()
      .options(`/v1/orders/${id}/tracking`)
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-order-token');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(String(ok.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'x-order-token',
    );
  });

  it('admisión: cupo ocupado y 2 esperas => 503 ORDERS_BUSY INMEDIATO con Retry-After para el seguimiento, mientras la cola aún admite escrituras', async () => {
    await app.close();
    const gate = new DbGate(1, 8, 1_500, ordersBusy);
    app = await createApp(keys, h, { gate });
    const created = await place();
    let release: () => void = () => undefined;
    const held = gate.run(() => new Promise<void>((r) => (release = r)));
    const queued = [gate.run(() => Promise.resolve(1)), gate.run(() => Promise.resolve(2))];
    const started = Date.now();
    const res = await track(created.order.id, { token: created.access?.guestToken }).expect(503);
    expect(Date.now() - started).toBeLessThan(500);
    expect(res.body).toMatchObject({ code: 'ORDERS_BUSY' });
    expect(res.headers['retry-after']).toBe('2');
    expect(res.headers['cache-control']).toBe('private, no-store');
    const write = gate.run(() => Promise.resolve('escritura')); // plaza 3: reservada a escrituras
    expect(gate.waiting).toBe(3);
    release();
    await Promise.all([held, ...queued, write]);
  });

  describe('límites de tasa', () => {
    it('invitado: 60/min (el contador por actor cae a la IP); la 61.ª => 429 con Retry-After y `private, no-store`', async () => {
      for (let i = 0; i < 60; i += 1) await track(UNKNOWN_ID, { ip: '10.97.0.1' }).expect(404);
      const res = await track(UNKNOWN_ID, { ip: '10.97.0.1' }).expect(429);
      expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(res.headers['retry-after']).toBeDefined();
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['etag']).toBeUndefined();
      await track(UNKNOWN_ID, { ip: '10.97.0.2' }).expect(404);
    });

    it('los intentos con token inválido (bien formado) cuentan', async () => {
      for (let i = 0; i < 60; i += 1) {
        await track(UNKNOWN_ID, { ip: '10.97.1.1', token: `smo_${'D'.repeat(43)}` }).expect(404);
      }
      await track(UNKNOWN_ID, { ip: '10.97.1.1', token: `smo_${'D'.repeat(43)}` }).expect(429);
    });

    it('autenticado: 60/min por ACTOR aunque cambie la IP; otro actor sigue libre', async () => {
      const jwt = await keys.sign();
      for (let i = 0; i < 60; i += 1) await track(UNKNOWN_ID, { jwt }).expect(404);
      await track(UNKNOWN_ID, { jwt }).expect(429);
      const other = await keys.sign({ sub: OTHER_USER });
      await track(UNKNOWN_ID, { jwt: other }).expect(404);
    });

    it('120/min por IP con varios actores detrás de la misma IP; la 121.ª => 429', async () => {
      const jwts = await Promise.all(
        ['a1', 'a2', 'a3', 'a4'].map((s) =>
          keys.sign({ sub: `${s}000000-1111-4222-8333-444455556666` }),
        ),
      );
      for (const jwt of jwts.slice(0, 3)) {
        for (let i = 0; i < 40; i += 1)
          await track(UNKNOWN_ID, { jwt, ip: '10.96.0.1' }).expect(404);
      }
      await track(UNKNOWN_ID, { jwt: jwts[3], ip: '10.96.0.1' }).expect(429);
    });

    it('contador independiente de `getOrder`: agotar el seguimiento no consume la cuota del detalle (y viceversa)', async () => {
      for (let i = 0; i < 60; i += 1) await track(UNKNOWN_ID, { ip: '10.95.0.1' }).expect(404);
      await track(UNKNOWN_ID, { ip: '10.95.0.1' }).expect(429);
      await getOrder(UNKNOWN_ID, { ip: '10.95.0.1' }).expect(404);
      for (let i = 0; i < 29; i += 1) await getOrder(UNKNOWN_ID, { ip: '10.95.0.2' }).expect(404);
      await track(UNKNOWN_ID, { ip: '10.95.0.2' }).expect(404);
    });
  });

  it('semáforo saturado => 503 ORDERS_BUSY con Retry-After y `private, no-store`; libera el cupo', async () => {
    await app.close();
    const gate = new DbGate(1, 0, 10, ordersBusy);
    app = await createApp(keys, h, { gate });
    const created = await place();
    let release: () => void = () => undefined;
    const held = gate.run(() => new Promise<void>((r) => (release = r)));
    const res = await track(created.order.id, { token: created.access?.guestToken }).expect(503);
    expect(res.body).toMatchObject({ code: 'ORDERS_BUSY' });
    expect(res.headers['retry-after']).toBe('2');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['etag']).toBeUndefined();
    release();
    await held;
    await new Promise((r) => setTimeout(r, 0));
    await track(created.order.id, { token: created.access?.guestToken }).expect(200);
  });

  it('solo lectura: sin escrituras, sin llamadas externas; los logs no contienen token ni PII', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const created = await place();
    const token = created.access?.guestToken as string;
    const before = {
      orders: h.ordersRepo.orders.size,
      tokens: h.ordersRepo.tokens.length,
      audits: h.ordersRepo.audits.length,
      history: h.ordersRepo.history.length,
      keys: h.ordersRepo.keys.size,
    };
    logged.length = 0;
    await track(created.order.id, { token }).expect(200);
    await track(created.order.id, { token: `smo_${'E'.repeat(43)}` }).expect(404);
    expect({
      orders: h.ordersRepo.orders.size,
      tokens: h.ordersRepo.tokens.length,
      audits: h.ordersRepo.audits.length,
      history: h.ordersRepo.history.length,
      keys: h.ordersRepo.keys.size,
    }).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const all = logged.join('\n');
    for (const secret of [
      token,
      `smo_${'E'.repeat(43)}`,
      'Ana',
      '5555',
      'ana@example.com',
      'wasabi',
    ]) {
      expect(all).not.toContain(secret);
    }
  });

  it('REGRESIÓN: `getOrder` conserva su forma (detalle) y las rutas protegidas siguen exigiendo JWT', async () => {
    const created = await place();
    const res = await getOrder(created.order.id, { token: created.access?.guestToken }).expect(200);
    expect(res.body).toMatchObject({ id: created.order.id, total: '170.00' });
    await http().get('/v1/me').expect(401);
  });
});
