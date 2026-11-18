import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { request as httpRequest } from 'node:http';
import request from 'supertest';
import {
  A,
  ADDR_MISSING,
  ADDR_OTHER,
  ADDR_OWN,
  B,
  checkoutHarness,
  coverageResult,
  groupRow,
  INACTIVE,
  MUNI_GUATEMALA,
  MUNI_MISSING,
  MUNI_MIXCO,
  mid,
  optionRow,
  ownZone,
  P1,
  P2,
} from './support/checkout-harness.js';
import { createTestKeys, USER_ID, type TestKeys } from './support/tokens.js';

type Harness = ReturnType<typeof checkoutHarness>;
type Body = Record<string, unknown>;
const SECRET = 'e2e-secret-'.padEnd(40, 'x');
const OTHER_USER = '9a8b7c6d-1111-4222-8333-444455556666';

function fakeDb() {
  return {
    customer: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
    staffUser: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
    $disconnect: () => Promise.resolve(),
  };
}

async function createApp(keys: TestKeys, h: Harness, overrides: { gate?: unknown } = {}) {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
    RATE_LIMIT_MAX: '1000',
    MEDIA_STORAGE_ADAPTER: 'mock',
    CHECKOUT_QUOTE_SECRET: SECRET,
  });
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
  const { CHECKOUT_DB_GATE } = await import('../src/checkout/checkout-errors.js');
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
    .useValue(h.clock);
  if (overrides.gate) builder = builder.overrideProvider(CHECKOUT_DB_GATE).useValue(overrides.gate);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'], trustProxyHops: 1 });
  await app.init();
  return app;
}

const cart = (over: Body = {}) => ({
  branchId: A,
  lines: [{ productId: P1, quantity: 2, selections: [] }],
  ...over,
});
const quoteBody = (over: Body = {}) => ({ cart: cart(), fulfillment: { type: 'PICKUP' }, ...over });
const strip = (body: Body) => ({ ...body, requestId: undefined });

describe('POST /v1/checkout/quote (e2e, F19)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let h: Harness;
  let ip = 0;
  const http = () => request(app.getHttpServer());
  /** Cada solicitud llega desde una IP distinta (proxy de confianza): los contadores por IP no interfieren. */
  const post = (body: unknown = quoteBody(), token?: string, fixedIp?: string) => {
    ip += 1;
    const req = http()
      .post('/v1/checkout/quote')
      .set('X-Forwarded-For', fixedIp ?? `10.1.${Math.floor(ip / 250)}.${ip % 250}`);
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body as object);
  };

  beforeAll(async () => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    h = checkoutHarness({ secret: SECRET });
    h.ownerOf.set(ADDR_OWN, USER_ID);
    h.ownerOf.set(ADDR_OTHER, OTHER_USER);
    app = await createApp(keys, h);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('acceso y Cache-Control (filas 7 y 18)', () => {
    it('invitado: 200, `private, no-store`, sin ETag, forma del contrato', async () => {
      const res = await post().expect(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['etag']).toBeUndefined();
      expect(Object.keys(res.body as Body).sort()).toEqual(
        [
          'blockers',
          'branch',
          'canProceed',
          'coupon',
          'currency',
          'deliveryFee',
          'discountTotal',
          'extrasTotal',
          'fulfillment',
          'lines',
          'notices',
          'quote',
          'subtotal',
          'total',
        ].sort(),
      );
      expect(res.body).toMatchObject({ total: '170.00', canProceed: true, currency: 'GTQ' });
      expect((res.body as { quote: { token: string } }).quote.token).toMatch(/^v1\./);
    });

    it('cliente autenticado: 200 y el token queda ligado a su sujeto', async () => {
      const guest = await post().expect(200);
      const user = await post(quoteBody(), await keys.sign()).expect(200);
      const sub = (r: request.Response) =>
        JSON.parse(
          Buffer.from(
            (r.body as { quote: { token: string } }).quote.token.split('.')[1] as string,
            'base64url',
          ).toString(),
        ) as { sub: string };
      expect(sub(guest).sub).toBe('guest');
      expect(sub(user).sub).not.toBe('guest');
    });

    it('token presente e inválido => 401 (no se degrada a invitado) con `private, no-store`', async () => {
      for (const token of ['basura', 'a.b.c']) {
        const res = await post(quoteBody(), token).expect(401);
        expect(res.headers['cache-control']).toBe('private, no-store');
      }
      const foreign = await post(quoteBody(), await keys.signWithForeignKey()).expect(401);
      expect(foreign.headers['www-authenticate']).toBe('Bearer');
      const expired = await keys.sign({}, { expiresIn: -60 });
      await post(quoteBody(), expired).expect(401);
      const malformed = await http()
        .post('/v1/checkout/quote')
        .set('Authorization', 'Basic abc')
        .send(quoteBody())
        .expect(401);
      expect(malformed.headers['cache-control']).toBe('private, no-store');
    });

    it('REGRESIÓN: el resto de rutas protegidas sigue exigiendo JWT (el guard global no se abrió)', async () => {
      await http().get('/v1/me').expect(401);
      await http().get('/v1/me/addresses').expect(401);
      await http().post('/v1/admin/promotions').send({}).expect(401);
    });

    it('errores 400, 422 y 429 también llevan `private, no-store`', async () => {
      const bad = await post({ cart: cart({ lines: [] }), fulfillment: { type: 'PICKUP' } }).expect(
        400,
      );
      expect(bad.headers['cache-control']).toBe('private, no-store');
      const branch = await post(quoteBody({ cart: cart({ branchId: INACTIVE }) })).expect(422);
      expect(branch.headers['cache-control']).toBe('private, no-store');
    });
  });

  describe('dirección guardada: anti-IDOR (fila 7)', () => {
    const delivery = (extra: Body) => quoteBody({ fulfillment: { type: 'DELIVERY', ...extra } });

    it('sin sesión => 401', async () => {
      const res = await post(delivery({ customerAddressId: ADDR_OWN })).expect(401);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(h.addresses.get).not.toHaveBeenCalled();
    });

    it('dirección propia => 200 con la tarifa de la zona', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const res = await post(delivery({ customerAddressId: ADDR_OWN }), await keys.sign()).expect(
        200,
      );
      expect(res.body).toMatchObject({
        deliveryFee: '15.00',
        total: '185.00',
        canProceed: true,
        fulfillment: { type: 'DELIVERY', delivery: { selectedProvider: 'OWN' } },
      });
    });

    it('ajena e inexistente => 404 con cuerpo idéntico (sin enumeración)', async () => {
      const token = await keys.sign();
      const other = await post(delivery({ customerAddressId: ADDR_OTHER }), token).expect(404);
      const missing = await post(delivery({ customerAddressId: ADDR_MISSING }), token).expect(404);
      expect(strip(other.body as Body)).toEqual(strip(missing.body as Body));
      expect(other.headers['cache-control']).toBe('private, no-store');
      expect(JSON.stringify(other.body)).not.toContain(OTHER_USER);
    });

    it('invitado con municipio y zona; municipio inexistente => 422; incompleta => blocker', async () => {
      h.cover.result = coverageResult({ own: ownZone('20.00') });
      const ok = await post(delivery({ municipalityId: MUNI_GUATEMALA, zone: 'Zona 10' })).expect(
        200,
      );
      expect((ok.body as Body)['deliveryFee']).toBe('20.00');
      const missing = await post(delivery({ municipalityId: MUNI_MISSING })).expect(422);
      expect(missing.body).toMatchObject({ code: 'MUNICIPALITY_NOT_FOUND' });
      const incomplete = await post(delivery({ municipalityId: MUNI_GUATEMALA })).expect(200);
      expect(incomplete.body).toMatchObject({
        total: null,
        canProceed: false,
        blockers: [{ code: 'ADDRESS_INCOMPLETE', scope: 'FULFILLMENT' }],
      });
    });

    it('combinaciones incoherentes de fulfillment => 400', async () => {
      const token = await keys.sign();
      for (const fulfillment of [
        { type: 'DELIVERY' },
        { type: 'DELIVERY', customerAddressId: ADDR_OWN, municipalityId: MUNI_MIXCO },
        { type: 'PICKUP', municipalityId: MUNI_MIXCO },
        { type: 'DELIVERY', municipalityId: 'no-uuid' },
        { type: 'TELEPORT' },
        { type: 'DELIVERY', municipalityId: MUNI_MIXCO, deliveryProvider: 'UBER' },
      ]) {
        await post(quoteBody({ fulfillment }), token).expect(400);
      }
    });
  });

  describe('entrada: lista blanca y topes (filas 1 y 17)', () => {
    it.each([
      [
        'price en la línea',
        quoteBody({
          cart: cart({ lines: [{ productId: P1, quantity: 1, selections: [], price: '1.00' }] }),
        }),
      ],
      [
        'unitPrice en la línea',
        quoteBody({
          cart: cart({
            lines: [{ productId: P1, quantity: 1, selections: [], unitPrice: '1.00' }],
          }),
        }),
      ],
      ['price en el carrito', quoteBody({ cart: cart({ price: '1.00' }) })],
      [
        'price en la selección',
        quoteBody({
          cart: cart({
            lines: [
              {
                productId: P1,
                quantity: 1,
                selections: [{ groupId: mid(1), optionId: mid(2), quantity: 1, price: '0.00' }],
              },
            ],
          }),
        }),
      ],
      [
        'fee en fulfillment',
        quoteBody({ fulfillment: { type: 'DELIVERY', municipalityId: MUNI_MIXCO, fee: '0.00' } }),
      ],
      [
        'deliveryFee en fulfillment',
        quoteBody({
          fulfillment: { type: 'DELIVERY', municipalityId: MUNI_MIXCO, deliveryFee: '0.00' },
        }),
      ],
      ['total en la raíz', quoteBody({ total: '1.00' })],
      ['discount en la raíz', quoteBody({ discount: '1.00' })],
      ['deliveryFee en la raíz', quoteBody({ deliveryFee: '0.00' })],
      ['discount en clientView', quoteBody({ clientView: { discount: '1.00' } })],
      [
        'price en clientView.lines',
        quoteBody({ clientView: { lines: [{ index: 0, unitPrice: '1.00', price: '1.00' }] } }),
      ],
      ['subtotal en la raíz', quoteBody({ subtotal: '1.00' })],
    ])('%s => 400 sin consultar la BD', async (_name, body) => {
      const res = await post(body).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400 });
      expect(h.availability.canAcceptOrderNow).not.toHaveBeenCalled();
    });

    it.each([
      ['sin cart', { fulfillment: { type: 'PICKUP' } }],
      ['sin fulfillment', { cart: cart() }],
      ['cuerpo vacío', {}],
      ['líneas vacías', quoteBody({ cart: cart({ lines: [] }) })],
      [
        'quantity 0',
        quoteBody({ cart: cart({ lines: [{ productId: P1, quantity: 0, selections: [] }] }) }),
      ],
      [
        'quantity 100',
        quoteBody({ cart: cart({ lines: [{ productId: P1, quantity: 100, selections: [] }] }) }),
      ],
      [
        'quantity decimal',
        quoteBody({ cart: cart({ lines: [{ productId: P1, quantity: 1.5, selections: [] }] }) }),
      ],
      [
        'quantity de selección 2',
        quoteBody({
          cart: cart({
            lines: [
              {
                productId: P1,
                quantity: 1,
                selections: [{ groupId: mid(1), optionId: mid(2), quantity: 2 }],
              },
            ],
          }),
        }),
      ],
      [
        'productId no UUID',
        quoteBody({ cart: cart({ lines: [{ productId: 'x', quantity: 1, selections: [] }] }) }),
      ],
      ['branchId no UUID', quoteBody({ cart: cart({ branchId: 'x' }) })],
      ['cupón demasiado largo', quoteBody({ couponCode: 'x'.repeat(65) })],
      ['clientView con importe mal formado', quoteBody({ clientView: { total: '12' } })],
      [
        'zona demasiado larga',
        quoteBody({
          fulfillment: { type: 'DELIVERY', municipalityId: MUNI_MIXCO, zone: 'z'.repeat(61) },
        }),
      ],
      [
        '__proto__',
        JSON.parse(
          '{"cart":{"branchId":"' +
            A +
            '","lines":[{"productId":"' +
            P1 +
            '","quantity":1,"selections":[]}]},"fulfillment":{"type":"PICKUP"},"__proto__":{"x":1}}',
        ) as object,
      ],
    ])('%s => 400', async (_name, body) => {
      await post(body).expect(400);
    });

    it('topes: 31 líneas, 201 unidades, 301 selecciones => 400 QUOTE_LIMITS_EXCEEDED', async () => {
      const line = (quantity: number, n = 0) => ({
        productId: P1,
        quantity,
        selections: Array.from({ length: n }, (_, i) => ({
          groupId: mid(i),
          optionId: mid(i + 500),
          quantity: 1,
        })),
      });
      for (const lines of [
        Array.from({ length: 31 }, () => line(1)),
        [line(99), line(99), line(3)],
        Array.from({ length: 11 }, () => line(1, 28)),
        [line(1, 31)],
      ]) {
        const res = await post(quoteBody({ cart: cart({ lines }) })).expect(400);
        expect(res.body).toMatchObject({ code: 'QUOTE_LIMITS_EXCEEDED' });
        expect(res.headers['cache-control']).toBe('private, no-store');
      }
      expect(h.availability.canAcceptOrderNow).not.toHaveBeenCalled();
    });

    it('cuerpo > 64 KB => 400 QUOTE_LIMITS_EXCEEDED; > 100 KB lo corta el parser (no 5xx)', async () => {
      const big = await post({ ...quoteBody(), relleno: 'a'.repeat(70_000) }).expect(400);
      expect(big.body).toMatchObject({ code: 'QUOTE_LIMITS_EXCEEDED' });
      const huge = await post({ ...quoteBody(), relleno: 'a'.repeat(200_000) }).expect(413);
      expect(huge.body).toMatchObject({ statusCode: 413, error: 'PAYLOAD_TOO_LARGE' });
    });

    it('clientView alterado no cambia importes; solo produce avisos', async () => {
      const honest = await post().expect(200);
      const forged = await post(
        quoteBody({ clientView: { lines: [{ index: 0, unitPrice: '0.01' }], total: '0.01' } }),
      ).expect(200);
      const pick = (r: request.Response) => {
        const b = r.body as {
          subtotal: string;
          discountTotal: string;
          total: string;
          lines: { unitPrice: string; lineTotal: string }[];
        };
        return {
          s: b.subtotal,
          d: b.discountTotal,
          t: b.total,
          u: b.lines[0]?.unitPrice,
          l: b.lines[0]?.lineTotal,
        };
      };
      expect(pick(forged)).toEqual(pick(honest));
      expect(forged.body).toMatchObject({
        notices: [{ code: 'PRICE_CHANGED', lineIndex: 0 }, { code: 'TOTAL_CHANGED' }],
        lines: [{ status: 'PRICE_CHANGED', previousUnitPrice: '0.01' }],
        canProceed: true,
      });
    });
  });

  describe('dinero y estado de líneas', () => {
    it('producto inexistente/oculto => total null y blockers por línea', async () => {
      const res = await post(
        quoteBody({
          cart: cart({
            lines: [
              { productId: P1, quantity: 1, selections: [] },
              { productId: mid(900), quantity: 1, selections: [] },
            ],
          }),
        }),
      ).expect(200);
      expect(res.body).toMatchObject({
        total: null,
        canProceed: false,
        blockers: [{ code: 'NOT_FOUND', scope: 'LINE', lineIndex: 1 }],
      });
      expect((res.body as { quote: { token: unknown } }).quote.token).toBeNull();
    });

    it('extras, promoción y cupón se calculan en el servidor', async () => {
      const g = mid(1);
      h.modifiersRepo.seedGroup(groupRow(g, { minSelect: 1, maxSelect: 1 }), [
        optionRow(mid(11), g, { extraPrice: '5.00' }),
      ]);
      h.modifiersRepo.seedProduct(P2, [g]);
      h.repo.seed({ code: 'SUSHI10', kind: 'PERCENT', value: '10.00' });
      const res = await post(
        quoteBody({
          cart: cart({
            lines: [
              {
                productId: P2,
                quantity: 2,
                selections: [{ groupId: g, optionId: mid(11), quantity: 1 }],
              },
            ],
          }),
          couponCode: 'sushi10',
        }),
      ).expect(200);
      // 30.00 × 2 = 60.00 de producto; extras 5.00 × 2; 10 % solo sobre el producto (6.00)
      expect(res.body).toMatchObject({
        subtotal: '70.00',
        extrasTotal: '10.00',
        discountTotal: '6.00',
        total: '64.00',
        coupon: { status: 'APPLIED' },
      });
    });

    it('sucursal cerrada => blocker BRANCH_CLOSED con total visible y nextOpensAt', async () => {
      h.state.accepted = false;
      h.state.reason = 'OUTSIDE_BUSINESS_HOURS';
      h.state.nextOpensAt = new Date('2026-11-17T14:00:00Z');
      const res = await post().expect(200);
      expect(res.body).toMatchObject({
        total: '170.00',
        canProceed: false,
        blockers: [{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }],
        branch: { isAcceptingOrders: false, nextOpensAt: '2026-11-17T14:00:00.000Z' },
      });
    });

    it('sucursal inexistente o inactiva => 422 BRANCH_NOT_AVAILABLE idéntico', async () => {
      const a = await post(quoteBody({ cart: cart({ branchId: INACTIVE }) })).expect(422);
      const b = await post(quoteBody({ cart: cart({ branchId: mid(777) }) })).expect(422);
      expect(a.body).toMatchObject({ code: 'BRANCH_NOT_AVAILABLE' });
      expect(strip(a.body as Body)).toEqual(strip(b.body as Body));
    });

    it('precio por sucursal: B sin override devuelve el base', async () => {
      h.world.seedRow(A, P1, { priceOverride: '90.00' });
      const a = await post().expect(200);
      const b = await post(quoteBody({ cart: cart({ branchId: B }) })).expect(200);
      expect((a.body as Body)['total']).toBe('180.00');
      expect((b.body as Body)['total']).toBe('170.00');
    });
  });

  describe('entrega: PedidosYa nunca selecciona ni da tarifa (fila 10 y 11)', () => {
    const delivery = (extra: Body = {}) =>
      quoteBody({ fulfillment: { type: 'DELIVERY', municipalityId: MUNI_MIXCO, ...extra } });

    it('por defecto: OWN apagado y PedidosYa UNKNOWN => DELIVERY_UNVERIFIED, sin total', async () => {
      const res = await post(delivery()).expect(200);
      expect(res.body).toMatchObject({
        total: null,
        deliveryFee: null,
        canProceed: false,
        blockers: [{ code: 'DELIVERY_UNVERIFIED', scope: 'FULFILLMENT' }],
      });
    });

    it.each(['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'] as const)(
      'PedidosYa simulado %s: jamás AVAILABLE seleccionable, sin tarifa ni total',
      async (status) => {
        h.cover.result = coverageResult({
          pedidosya: { coverageStatus: status, integrationStatus: 'MOCK', reason: undefined },
        });
        const res = await post(delivery()).expect(200);
        const body = res.body as {
          canProceed: boolean;
          total: unknown;
          fulfillment: {
            delivery: {
              selectedProvider: unknown;
              options: {
                provider: string;
                selectable: boolean;
                customerFee: unknown;
                simulated: boolean;
              }[];
            };
          };
        };
        const py = body.fulfillment.delivery.options.find((o) => o.provider === 'PEDIDOSYA');
        expect(py).toMatchObject({ selectable: false, customerFee: null, simulated: true });
        expect(body.fulfillment.delivery.selectedProvider).toBeNull();
        expect(body.canProceed).toBe(false);
        expect(body.total).toBeNull();
      },
    );

    it('deliveryProvider=PEDIDOSYA con OWN disponible => DELIVERY_PROVIDER_NOT_SELECTABLE y sin cambiar a OWN', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const res = await post(delivery({ deliveryProvider: 'PEDIDOSYA' })).expect(200);
      expect(res.body).toMatchObject({
        canProceed: false,
        total: null,
        blockers: [{ code: 'DELIVERY_PROVIDER_NOT_SELECTABLE', scope: 'FULFILLMENT' }],
        fulfillment: { delivery: { selectedProvider: null } },
      });
    });

    it('la respuesta no expone costo del proveedor ni flags administrativos', async () => {
      h.cover.result = coverageResult({ own: ownZone('15.00') });
      const text = JSON.stringify((await post(delivery()).expect(200)).body).toLowerCase();
      for (const forbidden of [
        'cost',
        'ownDeliveryZonesEnabled'.toLowerCase(),
        'deliveryzoneid',
        'basefee',
      ]) {
        expect(text).not.toContain(forbidden);
      }
    });
  });

  describe('límites de tasa (fila 19)', () => {
    it('60/min por IP: la solicitud 61 => 429 RATE_LIMITED con Retry-After y `private, no-store`', async () => {
      for (let i = 0; i < 60; i++) await post(quoteBody(), undefined, '203.0.113.7').expect(200);
      const res = await post(quoteBody(), undefined, '203.0.113.7').expect(429);
      expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(res.headers['retry-after']).toBeDefined();
      expect(res.headers['cache-control']).toBe('private, no-store');
      await post(quoteBody(), undefined, '203.0.113.8').expect(200); // otra IP no se ve afectada
    });

    it('cupón: 10/min por IP, contador aparte; sin cupón sigue pasando', async () => {
      const ipA = '203.0.113.20';
      for (let i = 0; i < 10; i++)
        await post(quoteBody({ couponCode: `C${i}` }), undefined, ipA).expect(200);
      const blocked = await post(quoteBody({ couponCode: 'C11' }), undefined, ipA).expect(429);
      expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
      await post(quoteBody(), undefined, ipA).expect(200); // sin cupón: solo cuenta el límite general
    });

    it('por actor autenticado: 60/min desde IPs distintas; otro actor y los invitados no se ven afectados', async () => {
      const token = await keys.sign();
      for (let i = 0; i < 60; i++) await post(quoteBody(), token).expect(200);
      const blocked = await post(quoteBody(), token).expect(429);
      expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
      await post(quoteBody(), await keys.sign({ sub: OTHER_USER })).expect(200);
      await post(quoteBody()).expect(200);
    });

    it('cupón por actor: 20/min aunque cambie de IP; el orden de guards pobló el principal antes', async () => {
      const token = await keys.sign();
      for (let i = 0; i < 20; i++)
        await post(quoteBody({ couponCode: `X${i}` }), token).expect(200);
      const blocked = await post(quoteBody({ couponCode: 'X99' }), token).expect(429);
      expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
      await post(quoteBody({ couponCode: 'X1' }), await keys.sign({ sub: OTHER_USER })).expect(200);
    });
  });

  describe('503 CHECKOUT_BUSY (fila 20)', () => {
    it('semáforo saturado => 503 con código público, mensaje fijo y `private, no-store`', async () => {
      await app.close();
      app = await createApp(keys, h, {
        gate: { run: () => Promise.reject(Object.assign(new Error('x'), {})) },
      });
      // Un fallo no reintentable no filtra detalle: 500 genérico.
      const generic = await post().expect(500);
      expect(JSON.stringify(generic.body)).not.toContain('x');
      await app.close();
      const { DbGate } = await import('../src/common/concurrency/db-gate.js');
      const { checkoutBusy } = await import('../src/checkout/checkout-errors.js');
      const gate = new DbGate(1, 0, 10, checkoutBusy);
      app = await createApp(keys, h, { gate });
      let release: () => void = () => undefined;
      const hold = gate.run(() => new Promise<void>((resolve) => (release = resolve)));
      const res = await post().expect(503);
      expect(res.body).toMatchObject({
        statusCode: 503,
        code: 'CHECKOUT_BUSY',
        message: 'El cotizador está ocupado; reintenta en unos segundos',
      });
      expect(res.headers['cache-control']).toBe('private, no-store');
      release();
      await hold;
      await new Promise((r) => setTimeout(r, 0));
      await post().expect(200); // el cupo se liberó
    });

    it('error reintentable de BD (P2024) => 503 CHECKOUT_BUSY sin detalle de la causa', async () => {
      h.availability.canAcceptOrderNow.mockRejectedValueOnce(
        Object.assign(new Error('connection pool secret detail'), { code: 'P2024' }),
      );
      const res = await post().expect(503);
      expect(res.body).toMatchObject({ code: 'CHECKOUT_BUSY' });
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });
  });

  describe('endurecimiento (revisiones de seguridad y rendimiento)', () => {
    const cleanHeaders = (res: request.Response) => {
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['etag']).toBeUndefined();
    };

    it.each([
      ['customerAddressId', { type: 'DELIVERY', customerAddressId: null }],
      ['municipalityId', { type: 'DELIVERY', municipalityId: null }],
      [
        'deliveryProvider',
        { type: 'DELIVERY', municipalityId: MUNI_MIXCO, deliveryProvider: null },
      ],
      ['zone con customerAddressId', { type: 'DELIVERY', customerAddressId: ADDR_OWN, zone: null }],
    ])(
      'null en fulfillment.%s => 400 (sin 5xx), invitado y autenticado',
      async (_name, fulfillment) => {
        const token = await keys.sign();
        for (const t of [undefined, token]) {
          const res = await post(quoteBody({ fulfillment }), t).expect(400);
          cleanHeaders(res);
        }
      },
    );

    it.each([
      ['couponCode', { couponCode: null }],
      ['clientView', { clientView: null }],
      ['clientView.lines', { clientView: { lines: null } }],
      ['clientView.total', { clientView: { total: null } }],
      ['cart', { cart: null }],
      ['fulfillment', { fulfillment: null }],
      ['cart.lines', { cart: { branchId: A, lines: null } }],
      ['selections', { cart: cart({ lines: [{ productId: P1, quantity: 1, selections: null }] }) }],
    ])('null en %s => 400 (sin 5xx), invitado y autenticado', async (_name, over) => {
      const token = await keys.sign();
      for (const t of [undefined, token]) {
        await post(quoteBody(over), t).expect(400);
      }
    });

    it('zone: null SÍ es válido (nullable en el contrato)', async () => {
      await post(
        quoteBody({ fulfillment: { type: 'DELIVERY', municipalityId: MUNI_MIXCO, zone: null } }),
      ).expect(200);
    });

    it('errores del parser: 413 y JSON inválido salen privados, sin ETag y con ErrorResponse estándar', async () => {
      const invalid = await http()
        .post('/v1/checkout/quote')
        .set('Content-Type', 'application/json')
        .send('{"cart":')
        .expect(400);
      cleanHeaders(invalid);
      expect(invalid.body).toMatchObject({
        statusCode: 400,
        error: 'BAD_REQUEST',
        message: 'Cuerpo inválido',
      });
      expect(JSON.stringify(invalid.body)).not.toContain('cart'); // sin eco del cuerpo
      const huge = await http()
        .post('/v1/checkout/quote')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ relleno: 'a'.repeat(200_000) }))
        .expect(413);
      cleanHeaders(huge);
      expect(huge.body).toMatchObject({ statusCode: 413, error: 'PAYLOAD_TOO_LARGE' });
    });

    it('otras rutas conservan no-store (no private) en errores del parser', async () => {
      const res = await http()
        .post('/v1/me/addresses')
        .set('Content-Type', 'application/json')
        .send('{"x":')
        .expect(400);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('topes de líneas/selecciones se aplican antes de la validación profunda', async () => {
      const lines = Array.from({ length: 31 }, () => ({
        productId: 'no-uuid',
        quantity: 'x',
        selections: [],
      }));
      const res = await post(quoteBody({ cart: cart({ lines }) })).expect(400);
      expect(res.body).toMatchObject({ code: 'QUOTE_LIMITS_EXCEEDED' }); // gana al 400 de validación de cada línea
    });

    it.each([
      ['Basic', 'Basic dXNlcjpwYXNz'],
      ['bearer en minúscula', 'bearer a.b.c'],
      ['vacía', ''],
      ['dos tokens en una cabecera', 'Bearer a.b.c, Bearer d.e.f'],
      ['sin esquema', 'a.b.c'],
    ])('Authorization %s => 401 y NO se degrada a invitado', async (_name, header) => {
      const res = await http()
        .post('/v1/checkout/quote')
        .set('Authorization', header)
        .send(quoteBody())
        .expect(401);
      cleanHeaders(res);
    });

    it('Authorization duplicada (dos cabeceras) con tokens inválidos => 401', async () => {
      const server = app.getHttpServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as import('node:net').AddressInfo;
      const payload = JSON.stringify(quoteBody());
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            port,
            method: 'POST',
            path: '/v1/checkout/quote',
            headers: [
              'Host',
              '127.0.0.1',
              'Content-Type',
              'application/json',
              'Content-Length',
              String(Buffer.byteLength(payload)),
              'Authorization',
              'Bearer a.b.c',
              'Authorization',
              'Bearer d.e.f',
            ],
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end(payload);
      });
      expect(status).toBe(401);
    });

    it('un 5xx no registra cupón, token, Authorization, dirección ni cuerpo en ningún log', async () => {
      const calls: unknown[][] = [];
      for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
        const spy = vi.spyOn(Logger.prototype, level);
        spy.mockClear();
        spy.mockImplementation((...args: unknown[]) => {
          calls.push(args);
        });
      }
      const token = await keys.sign();
      h.availability.canAcceptOrderNow.mockRejectedValueOnce(new Error('boom'));
      const res = await post(
        quoteBody({
          couponCode: 'SECRETCUPON99',
          fulfillment: { type: 'DELIVERY', customerAddressId: ADDR_OWN },
        }),
        token,
      ).expect(500);
      cleanHeaders(res);
      expect(res.body).toMatchObject({ statusCode: 500, message: 'Error interno del servidor' });
      // Y un 401 por token inválido, que también registra.
      await post(quoteBody({ couponCode: 'SECRETCUPON99' }), 'zzz.yyy.xxx').expect(401);
      const dump = JSON.stringify(
        calls.map((c) => c.map((a) => (a instanceof Error ? a.stack : a))),
      );
      expect(calls.length).toBeGreaterThan(0); // sí se registró algo (el 5xx)
      for (const secret of [
        'SECRETCUPON99',
        token,
        'zzz.yyy.xxx',
        ADDR_OWN,
        'Bearer',
        SECRET,
        USER_ID,
      ]) {
        expect(dump).not.toContain(secret);
      }
    });
  });
});
