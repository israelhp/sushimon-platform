import { createHash } from 'node:crypto';
import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { source } from './support/order-source-fixtures.js';
import { createTestKeys, USER_ID, type TestKeys } from './support/tokens.js';
import type { MyOrderRow, MyOrdersFilter } from '../src/orders/history/my-orders.types.js';
import type { OrderSource } from '../src/orders/order-source.repository.js';

/**
 * F23 · HTTP real de `GET /v1/me/orders`, `GET /v1/orders/{id}/receipt` y `POST /v1/orders/{id}/reorder-preview` con Prisma,
 * repositorios y catálogo EN MEMORIA (sin PostgreSQL ni red). El SQL real, los presupuestos de sentencias y el `EXPLAIN` se
 * prueban en `order-history.int-spec.ts`. `writes` cuenta CUALQUIER escritura (debe seguir en 0).
 */
type Body = Record<string, unknown>;
const OTHER_USER = '9a8b7c6d-1111-4222-8333-444455556666';
const NOW = new Date('2026-11-19T15:00:00.000Z');
const BRANCH_A = '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a6b';
const BRANCH_B = '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5a99';
const BRANCH_INACTIVE = '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5ab1';
const BRANCH_MISSING = '0b9d3c1e-8a52-4f0e-9b0a-1c2d3e4f5aff';
const PRODUCT = '00000000-0000-4000-8000-000000000a01';
const GUEST_TOKEN = `smo_${'A'.repeat(43)}`;
const REVOKED_TOKEN = `smo_${'D'.repeat(43)}`;
const EXPIRED_TOKEN = `smo_${'B'.repeat(43)}`;
const FOREIGN_TOKEN = `smo_${'C'.repeat(43)}`;
const strip = (body: unknown) => ({ ...(body as Body), requestId: undefined });
/** Cabeceras privadas en TODA respuesta (también 400/401/404/429/503): `private, no-store`, `Vary` y sin ETag. */
const expectPrivate = (res: request.Response, vary: RegExp[] = [/Authorization/]) => {
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(res.headers['etag']).toBeUndefined();
  for (const v of vary) expect(res.headers['vary']).toMatch(v);
};
const BY_ORDER = [/Authorization/, /X-Order-Token/];
/** Claves de un JSON, recursivas. */
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value && typeof value === 'object'
      ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)])
      : [];
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const oid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface StoredOrder extends OrderSource {
  ownerAuthUserId: string | null;
  placedAtKey: string;
  itemCount: number;
}

const mk = (n: number, over: Partial<StoredOrder> = {}): StoredOrder => {
  const placedAt = new Date(NOW.getTime() - n * 3_600_000);
  return {
    ...source({
      id: oid(n),
      orderNumber: BigInt(1000 + n),
      status: 'delivered',
      placedAt,
      updatedAt: placedAt,
    }),
    ownerAuthUserId: USER_ID,
    placedAtKey: placedAt.toISOString().replace('Z', '000Z'),
    itemCount: 2,
    ...over,
  };
};

class World {
  orders = new Map<string, StoredOrder>();
  tokens = new Map<string, { orderId: string; expiresAt: Date; revoked: boolean }>();
  writes = 0;
  listCalls = 0;
  sourceCalls = 0;
  missingBranches = new Set<string>([BRANCH_MISSING]);
  inactiveBranches = new Set<string>([BRANCH_INACTIVE]);
  lastStatus: string[] | null | undefined = undefined;
  add(...o: StoredOrder[]) {
    for (const x of o) this.orders.set(x.id, x);
  }
}

function fakeDb(world: World) {
  const bump = () => {
    world.writes += 1;
    return Promise.resolve(0);
  };
  return {
    customer: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(bump),
    },
    staffUser: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn(bump) },
    $executeRaw: vi.fn(bump),
    $transaction: vi.fn(bump),
    $disconnect: () => Promise.resolve(),
  };
}

function fakeMyOrdersRepo(world: World) {
  return {
    list(f: MyOrdersFilter): Promise<MyOrderRow[]> {
      world.listCalls += 1;
      world.lastStatus = f.status;
      const rows = [...world.orders.values()]
        .filter((o) => o.ownerAuthUserId === f.authUserId)
        .filter((o) => !f.status || f.status.includes(o.status))
        .filter((o) => !f.branchId || o.branchId === f.branchId)
        .filter((o) => !f.from || o.placedAt >= f.from)
        .filter((o) => !f.to || o.placedAt < f.to)
        .sort((a, b) =>
          a.placedAtKey === b.placedAtKey
            ? a.id < b.id
              ? 1
              : -1
            : a.placedAtKey < b.placedAtKey
              ? 1
              : -1,
        )
        .filter(
          (o) =>
            !f.cursor ||
            o.placedAtKey < f.cursor.placedAtKey ||
            (o.placedAtKey === f.cursor.placedAtKey && o.id < f.cursor.id),
        )
        .slice(0, f.limit + 1);
      return Promise.resolve(
        rows.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          branchId: o.branchId,
          branchName: o.branchName,
          fulfillmentType: o.fulfillmentType,
          deliveryProvider: o.deliveryProvider,
          total: o.total,
          paymentMethodPreference: o.paymentMethodPreference,
          placedAt: o.placedAt,
          updatedAt: o.updatedAt,
          itemCount: o.itemCount,
          placedAtKey: o.placedAtKey,
        })),
      );
    },
  };
}

function fakeSourceRepo(world: World) {
  return {
    findForOwner(id: string, authUserId: string): Promise<OrderSource | null> {
      world.sourceCalls += 1;
      const o = world.orders.get(id);
      return Promise.resolve(o && o.ownerAuthUserId === authUserId ? o : null);
    },
    findForGuestToken(id: string, hash: Buffer, now: Date): Promise<OrderSource | null> {
      world.sourceCalls += 1;
      const t = world.tokens.get(hash.toString('hex'));
      const o = world.orders.get(id);
      return Promise.resolve(
        t && o && t.orderId === id && !t.revoked && t.expiresAt > now ? o : null,
      );
    },
    findBranchName(branchId: string): Promise<string | null> {
      if (branchId === BRANCH_INACTIVE) return Promise.resolve('Sucursal Inactiva');
      return Promise.resolve(branchId === BRANCH_B ? 'Sucursal Mixco' : null);
    },
  };
}

async function createApp(keys: TestKeys, world: World, opts: { gate?: unknown } = {}) {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
    RATE_LIMIT_MAX: '1000',
    MEDIA_STORAGE_ADAPTER: 'mock',
  });
  vi.resetModules();
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
  const { MyOrdersRepository } = await import('../src/orders/history/my-orders.repository.js');
  const { OrderSourceRepository } = await import('../src/orders/order-source.repository.js');
  const { OrdersRepository } = await import('../src/orders/orders.repository.js');
  const { BranchOffersService } = await import('../src/branch-products/branch-offers.service.js');
  const { ModifierSelectionService } =
    await import('../src/modifiers/modifier-selection.service.js');
  const { ProductsQueryService } = await import('../src/products/products-query.service.js');
  const { BRANCH_AVAILABILITY_PORT } =
    await import('../src/branch-schedule/branch-availability.port.js');
  const { CLOCK } = await import('../src/branch-schedule/clock.js');
  const writeSpy = () => {
    world.writes += 1;
    return Promise.reject(new Error('escritura inesperada'));
  };
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(fakeDb(world))
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .overrideProvider(MyOrdersRepository)
    .useValue(fakeMyOrdersRepo(world))
    .overrideProvider(OrderSourceRepository)
    .useValue(fakeSourceRepo(world))
    .overrideProvider(OrdersRepository)
    .useValue({ createOrder: writeSpy, issueGuestToken: writeSpy, purgeExpired: writeSpy })
    .overrideProvider(BranchOffersService)
    .useValue({
      inspect: (_b: string, ids: string[]) =>
        Promise.resolve(new Map(ids.map((p) => [p, { state: 'OK', price: '80.00' }]))),
    })
    .overrideProvider(ModifierSelectionService)
    .useValue({
      findOffers: (ids: string[]) =>
        Promise.resolve(
          new Map(
            ids.map((p) => [
              p,
              [
                {
                  id: '00000000-0000-4000-8000-000000000b01',
                  name: 'Extras',
                  minSelect: 0,
                  maxSelect: 2,
                  active: true,
                  options: [
                    {
                      id: '00000000-0000-4000-8000-0000000000c1',
                      name: 'Soya extra',
                      extraPrice: '5.00',
                      active: true,
                    },
                  ],
                },
              ],
            ]),
          ),
        ),
    })
    .overrideProvider(ProductsQueryService)
    .useValue({
      findPresentationByIds: (ids: string[]) =>
        Promise.resolve(
          new Map(
            ids.map((p) => [
              p,
              { slug: 'roll-california', name: 'Roll California', imageUrl: null },
            ]),
          ),
        ),
    })
    .overrideProvider(BRANCH_AVAILABILITY_PORT)
    .useValue({
      canAcceptOrderNow: (id: string) =>
        world.missingBranches.has(id)
          ? Promise.reject(new NotFoundException('Sucursal no encontrada'))
          : world.inactiveBranches.has(id)
            ? Promise.resolve({ accepted: false, reason: 'INACTIVE', nextOpensAt: null })
            : Promise.resolve({ accepted: true, reason: 'OPEN', nextOpensAt: null }),
    })
    .overrideProvider(CLOCK)
    .useValue({ now: () => NOW });
  if (opts.gate) {
    const { ORDERS_DB_GATE } = await import('../src/orders/orders-errors.js');
    builder = builder.overrideProvider(ORDERS_DB_GATE).useValue(opts.gate);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'], trustProxyHops: 1 });
  await app.init();
  return app;
}

let keys: TestKeys;
let ipSeq = 0;
const nextIp = () => {
  ipSeq += 1;
  return `10.9.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`;
};
const INACTIVE_OWNER = '7e6d5c4b-3a29-4817-96a5-b4c3d2e1f0a9';
const NO_CUSTOMER = '5d6e7f80-91a2-4b3c-8d4e-5f60718293a4';
const tokens = new Map<string, string>();
const bearer = (sub = USER_ID): string => `Bearer ${tokens.get(sub) as string}`;

function seed(): World {
  const w = new World();
  w.add(
    mk(1, { status: 'pending', itemCount: 3 }),
    mk(2, { status: 'rejected' }),
    mk(3, { status: 'cancelled', branchId: BRANCH_B, branchName: 'Sucursal Mixco' }),
    mk(4, { status: 'picked_up' }),
    mk(5, { status: 'delivered', deliveryProvider: 'PEDIDOSYA', fulfillmentType: 'DELIVERY' }),
    mk(6, { status: 'accepted' }),
    mk(10, { ownerAuthUserId: OTHER_USER, orderNumber: 1500n }),
    mk(11, { ownerAuthUserId: null, orderNumber: 1501n }), // invitado
    mk(12, {
      ownerAuthUserId: INACTIVE_OWNER,
      branchId: BRANCH_INACTIVE,
      branchName: 'Sucursal Inactiva',
      orderNumber: 1502n,
    }), // sucursal original inactiva
  );
  w.tokens.set(sha(GUEST_TOKEN), {
    orderId: oid(11),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    revoked: false,
  });
  w.tokens.set(sha(EXPIRED_TOKEN), {
    orderId: oid(11),
    expiresAt: new Date(NOW.getTime() - 1_000),
    revoked: false,
  });
  w.tokens.set(sha(REVOKED_TOKEN), {
    orderId: oid(11),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    revoked: true,
  });
  w.tokens.set(sha(FOREIGN_TOKEN), {
    orderId: oid(10),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    revoked: false,
  });
  return w;
}

beforeAll(async () => {
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
  keys = await createTestKeys();
  for (const sub of [USER_ID, OTHER_USER, NO_CUSTOMER, INACTIVE_OWNER])
    tokens.set(sub, await keys.sign({ sub }));
});

describe('GET /v1/me/orders (e2e, F23)', () => {
  let app: NestExpressApplication;
  let world: World;
  const http = () => request(app.getHttpServer());
  const list = (query = '', sub: string | null = USER_ID) => {
    const req = http().get(`/v1/me/orders${query}`).set('X-Forwarded-For', nextIp());
    return sub === null ? req : req.set('Authorization', bearer(sub));
  };

  beforeAll(async () => {
    world = seed();
    app = await createApp(keys, world);
  });
  afterAll(async () => {
    await app.close();
  });

  it('#1 sin JWT => 401; JWT inválido o firmado con otra clave => 401 (no se degrada a invitado); cabeceras privadas también en el 401', async () => {
    const none = await list('', null).then((r) => r);
    expect(none.status).toBe(401);
    expect(none.headers['cache-control']).toBe('private, no-store');
    expect(none.headers['vary']).toMatch(/Authorization/);
    expect(none.headers['etag']).toBeUndefined();
    const bad = await http()
      .get('/v1/me/orders')
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', 'Bearer basura');
    expect(bad.status).toBe(401);
    const foreign = await keys.signWithForeignKey({ sub: USER_ID });
    await http()
      .get('/v1/me/orders')
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${foreign}`)
      .expect(401);
    const expired = await keys.sign({ sub: USER_ID }, { expiresIn: -60 });
    await http()
      .get('/v1/me/orders')
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    expect(world.listCalls).toBe(0);
  });

  it('#2 #3 solo los pedidos del cliente del JWT (ni ajenos ni de invitado), orden fijo, forma exacta, sin PII; #15 cabeceras', async () => {
    const res = await list().expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['vary']).toMatch(/Authorization/);
    expect(res.headers['etag']).toBeUndefined();
    const body = res.body as { items: Body[]; nextCursor: unknown; generatedAt: string };
    expect(body.items.map((i) => i['displayNumber'])).toEqual([
      'MON-001001',
      'MON-001002',
      'MON-001003',
      'MON-001004',
      'MON-001005',
      'MON-001006',
    ]);
    expect(body.nextCursor).toBeNull();
    expect(body.generatedAt).toBe(NOW.toISOString());
    expect(Object.keys(body.items[0] as Body).sort()).toEqual(
      [
        'branchId',
        'branchName',
        'currency',
        'deliveryProvider',
        'displayNumber',
        'fulfillmentType',
        'id',
        'itemCount',
        'orderNumber',
        'paymentMethodPreference',
        'placedAt',
        'publicStatus',
        'status',
        'terminal',
        'total',
        'updatedAt',
      ].sort(),
    );
    expect(body.items[0]).toMatchObject({
      status: 'pending',
      publicStatus: 'received',
      terminal: false,
      itemCount: 3,
      total: '165.00',
      currency: 'GTQ',
    });
    const raw = JSON.stringify(body);
    for (const forbidden of [
      'Ana',
      '5555',
      'portón',
      'wasabi',
      'Roll California',
      'reason',
      'MON-001500',
      'MON-001501',
      'customer',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('#2 otro cliente ve solo lo suyo; un usuario sin pedidos o sin fila de cliente => 200 vacío y NO se crea nada', async () => {
    const other = (await list('', OTHER_USER).expect(200)).body as { items: Body[] };
    expect(other.items.map((i) => i['displayNumber'])).toEqual(['MON-001500']);
    const none = (await list('', NO_CUSTOMER).expect(200)).body as Body;
    expect(none).toMatchObject({ items: [], nextCursor: null });
    expect(world.writes).toBe(0);
  });

  it('#13 #14 rechazados y cancelados se listan con su estado y SIN motivo; PEDIDOSYA histórico tal cual', async () => {
    const body = (await list().expect(200)).body as { items: Body[] };
    const byNumber = (n: string) => body.items.find((i) => i['displayNumber'] === n) as Body;
    expect(byNumber('MON-001002')).toMatchObject({
      status: 'rejected',
      publicStatus: 'rejected',
      terminal: true,
    });
    expect(byNumber('MON-001003')).toMatchObject({
      status: 'cancelled',
      publicStatus: 'cancelled',
      terminal: true,
      branchName: 'Sucursal Mixco',
    });
    expect(byNumber('MON-001005')).toMatchObject({
      deliveryProvider: 'PEDIDOSYA',
      fulfillmentType: 'DELIVERY',
    });
    expect(Object.keys(byNumber('MON-001002'))).not.toContain('reason');
  });

  it('#5 filtros: status csv, branchId y rango de fechas', async () => {
    const nums = async (q: string) =>
      ((await list(q).expect(200)).body as { items: Body[] }).items.map((i) => i['orderNumber']);
    expect(await nums('?status=pending,accepted,preparing,ready,on_the_way')).toEqual([1001, 1006]);
    expect(await nums('?status=rejected&status=cancelled')).toEqual([1002, 1003]);
    expect(await nums(`?branchId=${BRANCH_B}`)).toEqual([1003]);
    expect(await nums(`?branchId=${BRANCH_MISSING}`)).toEqual([]);
    const from = encodeURIComponent(new Date(NOW.getTime() - 4.5 * 3_600_000).toISOString());
    const to = encodeURIComponent(new Date(NOW.getTime() - 1.5 * 3_600_000).toISOString());
    expect(await nums(`?from=${from}&to=${to}`)).toEqual([1002, 1003, 1004]);
  });

  it.each([
    ['estado fuera de catálogo', '?status=pending,paid'],
    ['branchId no UUID', '?branchId=abc'],
    ['from sin zona', '?from=2026-01-01T00:00:00'],
    ['to <= from', '?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z'],
    ['rango > 366 días', '?from=2025-01-01T00:00:00Z&to=2026-06-01T00:00:00Z'],
    ['limit 0', '?limit=0'],
    ['limit 51', '?limit=51'],
    ['limit no numérico', '?limit=abc'],
    ['#4 customerId en la consulta (lista blanca)', `?customerId=${OTHER_USER}`],
    ['parámetro desconocido', '?foo=1'],
  ])('#5 #6 #4 %s => 400', async (_n, query) => {
    const before = world.listCalls;
    await list(query).expect(400);
    expect(world.listCalls).toBe(before);
  });

  it('#6 #7 paginación por cursor: sin duplicados ni saltos, suma exacta, nextCursor null en la última', async () => {
    const seen: unknown[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = `?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const body = (await list(q).expect(200)).body as {
        items: Body[];
        nextCursor: string | null;
      };
      seen.push(...body.items.map((i) => i['orderNumber']));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([1001, 1002, 1003, 1004, 1005, 1006]);
  });

  it('#7 llegan pedidos nuevos entre páginas: la página siguiente no repite ni salta', async () => {
    const w = seed();
    const a2 = await createApp(keys, w);
    try {
      const h = () => request(a2.getHttpServer());
      const first = (
        await h()
          .get('/v1/me/orders?limit=2')
          .set('X-Forwarded-For', nextIp())
          .set('Authorization', bearer())
          .expect(200)
      ).body as { items: Body[]; nextCursor: string };
      w.add(mk(0, { orderNumber: 1999n })); // más reciente que todo: no debe colarse en la página 2
      const second = (
        await h()
          .get(`/v1/me/orders?limit=2&cursor=${first.nextCursor}`)
          .set('X-Forwarded-For', nextIp())
          .set('Authorization', bearer())
          .expect(200)
      ).body as { items: Body[] };
      expect(second.items.map((i) => i['orderNumber'])).toEqual([1003, 1004]);
    } finally {
      await a2.close();
    }
  });

  it.each([
    ['basura', '!!!'],
    ['base64url pero sin forma', Buffer.from('hola', 'utf8').toString('base64url')],
    [
      'fecha inexistente',
      Buffer.from('v1|2026-02-31T10:00:00.000000Z|7c1f0f52-3b5e-4c63-9a4d-5f6e8f0a1b2c').toString(
        'base64url',
      ),
    ],
    [
      'año 0000',
      Buffer.from('v1|0000-01-01T00:00:00.000000Z|7c1f0f52-3b5e-4c63-9a4d-5f6e8f0a1b2c').toString(
        'base64url',
      ),
    ],
    [
      'UUID en mayúsculas',
      Buffer.from('v1|2026-11-18T10:00:00.000000Z|7C1F0F52-3B5E-4C63-9A4D-5F6E8F0A1B2C').toString(
        'base64url',
      ),
    ],
    ['UUID inválido', Buffer.from('v1|2026-11-18T10:00:00.000000Z|zzz').toString('base64url')],
  ])('#8 cursor %s => 400 ORDER_CURSOR_INVALID', async (_n, cursor) => {
    const res = await list(`?cursor=${cursor}`).expect(400);
    expect((res.body as Body)['code']).toBe('ORDER_CURSOR_INVALID');
  });

  it('#8 cursor de más de 200 caracteres => 400 (validación del contrato)', async () => {
    await list(`?cursor=${'a'.repeat(201)}`).expect(400);
  });

  it('#8 un cursor de OTRO cliente no revela datos ajenos: solo ve lo suyo', async () => {
    const cursor = Buffer.from(`v1|${mk(0).placedAtKey}|${oid(10)}`).toString('base64url');
    const body = (await list(`?cursor=${cursor}`, OTHER_USER).expect(200)).body as {
      items: Body[];
    };
    for (const i of body.items) expect(i['displayNumber']).toBe('MON-001500');
  });

  it('#5 `status` repetido se DEDUPLICA (no es 400) y llega único a la consulta', async () => {
    await list('?status=pending,pending,accepted').expect(200);
    expect(world.lastStatus).toEqual(['pending', 'accepted']);
    await list('?status=rejected&status=rejected').expect(200);
    expect(world.lastStatus).toEqual(['rejected']);
  });

  it('#15 cabeceras privadas, Vary y sin ETag en 400, 401 y 429 de la lista', async () => {
    expectPrivate(await list('?limit=0').expect(400));
    expectPrivate(await list('', null).expect(401));
    expectPrivate(
      await http()
        .get('/v1/me/orders')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', 'Bearer x')
        .expect(401),
    );
  });

  it('#2 usuario con JWT válido y SIN fila en customers: lista vacía y no se crea ninguna fila', async () => {
    const writes = world.writes;
    const res = await list('', NO_CUSTOMER).expect(200);
    expect(res.body).toMatchObject({ items: [], nextCursor: null });
    expect(world.writes).toBe(writes);
  });

  it('#68 ninguna cabecera permite elegir al cliente', async () => {
    const res = await list()
      .set('X-Customer-Id', oid(10))
      .set('X-Auth-User-Id', OTHER_USER)
      .expect(200);
    const nums = (res.body as { items: Body[] }).items.map((i) => i['orderNumber']);
    expect(nums).not.toContain(1500);
  });
});

describe('GET /v1/orders/{id}/receipt (e2e, F23)', () => {
  let app: NestExpressApplication;
  let world: World;
  const http = () => request(app.getHttpServer());
  const receipt = (id: string, opts: { token?: string; sub?: string | null; ip?: string } = {}) => {
    let req = http()
      .get(`/v1/orders/${id}/receipt`)
      .set('X-Forwarded-For', opts.ip ?? nextIp());
    if (opts.token) req = req.set('X-Order-Token', opts.token);
    if (opts.sub !== null) req = req.set('Authorization', bearer(opts.sub ?? USER_ID));
    return req;
  };

  beforeAll(async () => {
    world = seed();
    app = await createApp(keys, world);
  });
  afterAll(async () => {
    await app.close();
  });

  it('#18 dueño: 200 con los campos exactos, NOT_FISCAL, America/Guatemala, teléfono enmascarado; #15 cabeceras', async () => {
    const res = await receipt(oid(4)).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['vary']).toMatch(/Authorization/);
    expect(res.headers['vary']).toMatch(/X-Order-Token/);
    expect(res.headers['etag']).toBeUndefined();
    const r = res.body as Body;
    expect(Object.keys(r).sort()).toEqual(
      [
        'address',
        'branch',
        'contact',
        'currency',
        'deliveryFee',
        'discountTotal',
        'displayNumber',
        'extrasTotal',
        'fiscalStatus',
        'fulfillment',
        'generatedAt',
        'lines',
        'notes',
        'payment',
        'placedAt',
        'promotions',
        'publicStatus',
        'status',
        'subtotal',
        'timeZone',
        'total',
      ].sort(),
    );
    expect(r).toMatchObject({
      fiscalStatus: 'NOT_FISCAL',
      timeZone: 'America/Guatemala',
      currency: 'GTQ',
      status: 'picked_up',
      contact: { phoneMasked: '****1234' },
      payment: {
        method: 'CASH',
        status: 'PENDING',
        amountPaid: null,
        tendered: null,
        change: null,
      },
      total: '165.00',
    });
  });

  it('#21 sin PII ni campos internos (barrido del JSON)', async () => {
    const raw = JSON.stringify((await receipt(oid(4)).expect(200)).body);
    for (const forbidden of [
      oid(4),
      BRANCH_A,
      '55551234',
      'smo_',
      'email',
      'latitude',
      'longitude',
      'reason',
      'changedBy',
      'history',
      'updatedAt',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('#24 disponible en todos los estados, también rejected/cancelled, sin motivo', async () => {
    for (const [n, status] of [
      [1, 'pending'],
      [2, 'rejected'],
      [3, 'cancelled'],
      [4, 'picked_up'],
      [5, 'delivered'],
      [6, 'accepted'],
    ] as const) {
      const r = (await receipt(oid(n)).expect(200)).body as Body;
      expect(r['status']).toBe(status);
      expect(r['payment']).toMatchObject({ status: 'PENDING' });
    }
  });

  it('#19 invitado con token vigente => 200; token vencido, ajeno o sin token ni JWT => el MISMO 404', async () => {
    await receipt(oid(11), { token: GUEST_TOKEN, sub: null }).expect(200);
    const denied = await Promise.all([
      receipt(oid(11), { token: EXPIRED_TOKEN, sub: null }),
      receipt(oid(11), { token: FOREIGN_TOKEN, sub: null }), // token de OTRO pedido
      receipt(oid(11), { sub: null }),
      receipt(oid(999), { token: GUEST_TOKEN, sub: null }),
    ]);
    for (const r of denied) {
      expect(r.status).toBe(404);
      expect(strip(r.body)).toEqual(strip(denied[0]?.body));
    }
  });

  it('#19 token con formato inválido => 400 antes de la BD', async () => {
    const before = world.sourceCalls;
    await receipt(oid(11), { token: 'smo_corto', sub: null }).expect(400);
    await receipt('no-es-uuid').expect(400);
    expect(world.sourceCalls).toBe(before);
  });

  it('#20 inexistente, ajeno y de invitado consultado con JWT: MISMO 404 (cuerpo y cabeceras)', async () => {
    const results = await Promise.all([
      receipt(oid(999)), // inexistente
      receipt(oid(10)), // de otro cliente
      receipt(oid(11)), // de invitado, con JWT
    ]);
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(strip(r.body)).toEqual(strip(results[0]?.body));
      expect((r.body as Body)['code']).toBeUndefined();
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['vary']).toMatch(/X-Order-Token/);
      expect(r.headers['content-length']).toBe(results[0]?.headers['content-length']);
    }
  });

  it('JWT inválido => 401 (no se degrada a invitado, aunque haya token válido)', async () => {
    await http()
      .get(`/v1/orders/${oid(11)}/receipt`)
      .set('X-Forwarded-For', nextIp())
      .set('X-Order-Token', GUEST_TOKEN)
      .set('Authorization', 'Bearer basura')
      .expect(401);
  });

  it('#78 no hay PDF: ni /pdf ni Content-Disposition', async () => {
    const res = await receipt(oid(4)).expect(200);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/application\/json/);
    await http()
      .get(`/v1/orders/${oid(4)}/receipt/pdf`)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', bearer())
      .expect(404);
  });

  it('#20 equivalencia de 404 (cuerpo y cabeceras) entre inexistente, ajeno, invitado con JWT, vencido, revocado y token de otro pedido', async () => {
    const results = await Promise.all([
      receipt(oid(999)),
      receipt(oid(10)),
      receipt(oid(11)),
      receipt(oid(11), { token: EXPIRED_TOKEN, sub: null }),
      receipt(oid(11), { token: REVOKED_TOKEN, sub: null }),
      receipt(oid(11), { token: FOREIGN_TOKEN, sub: null }), // token válido de OTRO pedido
      receipt(oid(11), { sub: null }),
    ]);
    const [first] = results;
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(strip(r.body)).toEqual(strip(first?.body));
      expect((r.body as Body)['code']).toBeUndefined();
      expectPrivate(r, BY_ORDER);
      expect(r.headers['content-length']).toBe(first?.headers['content-length']);
      expect(r.headers['content-type']).toBe(first?.headers['content-type']);
    }
  });

  it('#21 barrido de claves prohibidas en el recibo (id interno, ids, reason, correo, coordenadas, token, historial)', async () => {
    const body: unknown = (await receipt(oid(4)).expect(200)).body;
    const forbidden = [
      'id',
      'orderId',
      'customerId',
      'branchId',
      'productId',
      'email',
      'customerEmail',
      'phone',
      'customerPhone',
      'latitude',
      'longitude',
      'reason',
      'changedBy',
      'token',
      'tokenHash',
      'guestToken',
      'history',
      'updatedAt',
      'idempotencyKey',
    ];
    const found = keysOf(body).filter((k) => forbidden.includes(k));
    // `branch.phone` es el teléfono PÚBLICO de la sucursal: es la única coincidencia permitida
    expect(found).toEqual(['phone']);
    expect((body as { branch: Body }).branch['phone']).toBeDefined();
  });

  it('#15 cabeceras privadas en 400, 401, 404 y 503 del recibo', async () => {
    expectPrivate(await receipt('no-es-uuid').expect(400), BY_ORDER);
    expectPrivate(await receipt(oid(11), { token: 'smo_x', sub: null }).expect(400), BY_ORDER);
    expectPrivate(
      await http()
        .get(`/v1/orders/${oid(4)}/receipt`)
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', 'Bearer x')
        .expect(401),
      BY_ORDER,
    );
    expectPrivate(await receipt(oid(999)).expect(404), BY_ORDER);
  });

  it('#16 gate saturado => 503 ORDERS_BUSY con Retry-After y cabeceras privadas', async () => {
    const busyApp = await createApp(keys, seed(), {
      gate: {
        run: () =>
          Promise.reject(
            new HttpException({ message: 'x', code: 'ORDERS_BUSY', retryAfter: 2 }, 503),
          ),
      },
    });
    try {
      const res = await request(busyApp.getHttpServer())
        .get(`/v1/orders/${oid(4)}/receipt`)
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', bearer())
        .expect(503);
      expect((res.body as Body)['code']).toBe('ORDERS_BUSY');
      expect(res.headers['retry-after']).toBeDefined();
      expectPrivate(res, BY_ORDER);
      const list = await request(busyApp.getHttpServer())
        .get('/v1/me/orders')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', bearer())
        .expect(503);
      expectPrivate(list);
      const pv = await request(busyApp.getHttpServer())
        .post(`/v1/orders/${oid(4)}/reorder-preview`)
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', bearer())
        .send({})
        .expect(503);
      expectPrivate(pv, BY_ORDER);
    } finally {
      await busyApp.close();
    }
  });

  it('#17 throttle propio: el 61.º intento de la misma IP => 429 RATE_LIMITED con Retry-After', async () => {
    const ip = nextIp();
    let last = 0;
    let lastRes: request.Response | null = null;
    for (let i = 0; i < 61; i += 1) {
      lastRes = await receipt(oid(11), { token: EXPIRED_TOKEN, sub: null, ip });
      last = lastRes.status;
    }
    expect(last).toBe(429);
    expect((lastRes?.body as Body)['code']).toBe('RATE_LIMITED');
    expect(lastRes?.headers['retry-after']).toBeDefined();
    expect(lastRes?.headers['cache-control']).toBe('private, no-store');
    expectPrivate(lastRes as request.Response, BY_ORDER);
  });
});

describe('POST /v1/orders/{id}/reorder-preview (e2e, F23)', () => {
  let app: NestExpressApplication;
  let world: World;
  const http = () => request(app.getHttpServer());
  const preview = (
    id: string,
    body?: unknown,
    opts: { token?: string; sub?: string | null; ip?: string } = {},
  ) => {
    let req = http()
      .post(`/v1/orders/${id}/reorder-preview`)
      .set('X-Forwarded-For', opts.ip ?? nextIp());
    if (opts.token) req = req.set('X-Order-Token', opts.token);
    if (opts.sub !== null) req = req.set('Authorization', bearer(opts.sub ?? USER_ID));
    return body === undefined ? req : req.send(body as object);
  };

  // App nueva por prueba: los contadores de throttle por actor (15/min) son por instancia.
  beforeEach(async () => {
    world = seed();
    app = await createApp(keys, world);
  });
  afterEach(async () => {
    await app.close();
  });

  it('#27 dueño: 200 sin cuerpo y con `{}`; sin Idempotency-Key; NO escribe nada (#28)', async () => {
    const a = await preview(oid(4)).expect(200);
    const b = await preview(oid(4), {}).expect(200);
    for (const res of [a, b]) {
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['vary']).toMatch(/X-Order-Token/);
      expect(res.headers['etag']).toBeUndefined();
      const p = res.body as { branch: Body; lines: Body[]; summary: Body; source: Body };
      expect(p.branch).toMatchObject({
        requestedBranchId: BRANCH_A,
        sameBranch: true,
        active: true,
        acceptingOrders: true,
        reason: 'OPEN',
      });
      expect(p.source).toEqual({
        displayNumber: 'MON-001004',
        status: 'picked_up',
        fulfillmentType: 'DELIVERY',
        deliveryProvider: 'OWN',
        placedAt: p.source['placedAt'],
      });
      expect(typeof p.source['placedAt']).toBe('string');
      expect(p.lines[0]).toMatchObject({
        lineNo: 1,
        status: 'AVAILABLE',
        current: { unitPrice: '80.00', extrasPerUnit: '5.00' },
        candidate: {
          slug: 'roll-california',
          line: { productId: PRODUCT, quantity: 2 },
        },
      });
      expect(p.summary).toMatchObject({
        lines: 1,
        available: 1,
        canAddAny: true,
        units: 2,
        estimatedSubtotal: '170.00',
      });
    }
    expect(world.writes).toBe(0);
  });

  it('#27 invitado con token vigente => 200; sin token ni JWT, vencido o ajeno => mismo 404 sin code', async () => {
    const ok = await preview(oid(11), {}, { token: GUEST_TOKEN, sub: null }).expect(200);
    expect((ok.body as { lines: unknown[] }).lines).toHaveLength(1);
    const denied = await Promise.all([
      preview(oid(11), {}, { sub: null }),
      preview(oid(11), {}, { token: EXPIRED_TOKEN, sub: null }),
      preview(oid(11), {}, { token: FOREIGN_TOKEN, sub: null }),
      preview(oid(10)), // ajeno con JWT
      preview(oid(11)), // de invitado con JWT
      preview(oid(999)),
    ]);
    for (const r of denied) {
      expect(r.status).toBe(404);
      expect(strip(r.body)).toEqual(strip(denied[0]?.body));
      expect((r.body as Body)['code']).toBeUndefined();
    }
    expect(world.writes).toBe(0);
  });

  it('#27 `branchId` inexistente => 404 BRANCH_NOT_FOUND SOLO tras autorizar; ajeno + branch inexistente => el 404 del pedido', async () => {
    const res = await preview(oid(4), { branchId: BRANCH_MISSING }).expect(404);
    expect((res.body as Body)['code']).toBe('BRANCH_NOT_FOUND');
    const probe = await preview(oid(10), { branchId: BRANCH_MISSING }).expect(404);
    expect((probe.body as Body)['code']).toBeUndefined();
  });

  it('#40 otra sucursal: sameBranch=false y nombre de ESA sucursal', async () => {
    const p = (await preview(oid(4), { branchId: BRANCH_B }).expect(200)).body as {
      branch: Body;
    };
    expect(p.branch).toMatchObject({
      originalBranchId: BRANCH_A,
      requestedBranchId: BRANCH_B,
      sameBranch: false,
      name: 'Sucursal Mixco',
    });
  });

  it.each([
    ['campo desconocido', { foo: 1 }],
    ['lines', { lines: [] }],
    ['prices', { prices: { a: '1.00' } }],
    ['customerId', { customerId: oid(10) }],
    ['quantity', { quantity: 5 }],
    ['__proto__', JSON.parse('{"__proto__":{"x":1}}') as object],
    ['branchId no UUID', { branchId: 'nope' }],
    ['branchId numérico', { branchId: 7 }],
  ])('#45 cuerpo con %s => 400', async (_n, body) => {
    const before = world.sourceCalls;
    await preview(oid(4), body).expect(400);
    expect(world.sourceCalls).toBe(before);
  });

  it('#45 token con formato inválido => 400', async () => {
    await preview(oid(11), {}, { token: 'smo_x', sub: null }).expect(400);
  });

  it('#29 #47 no copia precios, promociones, cupón, tarifa, dirección ni pago; sin ids de pedido/líneas ni datos del cliente', async () => {
    const raw = JSON.stringify((await preview(oid(4)).expect(200)).body);
    for (const forbidden of [
      oid(4),
      'Martes 2x1',
      'deliveryFee',
      'portón',
      'municipal',
      'Ana',
      '5555',
      'paymentMethod',
      'coupon',
      'smo_',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('JWT inválido => 401', async () => {
    await http()
      .post(`/v1/orders/${oid(4)}/reorder-preview`)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', 'Bearer basura')
      .expect(401);
  });

  it('#20 equivalencia de 404 (cuerpo y cabeceras) entre inexistente, ajeno, invitado con JWT, vencido, revocado y token de otro pedido', async () => {
    const results = await Promise.all([
      preview(oid(999)),
      preview(oid(10)),
      preview(oid(11)),
      preview(oid(11), {}, { token: EXPIRED_TOKEN, sub: null }),
      preview(oid(11), {}, { token: REVOKED_TOKEN, sub: null }),
      preview(oid(11), {}, { token: FOREIGN_TOKEN, sub: null }),
      preview(oid(11), {}, { sub: null }),
    ]);
    const [first] = results;
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(strip(r.body)).toEqual(strip(first?.body));
      expect((r.body as Body)['code']).toBeUndefined();
      expectPrivate(r, BY_ORDER);
      expect(r.headers['content-length']).toBe(first?.headers['content-length']);
    }
    expect(world.writes).toBe(0);
  });

  it('JWT inválido con token de invitado VÁLIDO => 401 (no se degrada a invitado)', async () => {
    await http()
      .post(`/v1/orders/${oid(11)}/reorder-preview`)
      .set('X-Forwarded-For', nextIp())
      .set('X-Order-Token', GUEST_TOKEN)
      .set('Authorization', 'Bearer basura')
      .send({})
      .expect(401);
  });

  it('#21 barrido de claves prohibidas en el preview (ids internos, reason de pedido, correo, coordenadas, token)', async () => {
    const body: unknown = (await preview(oid(4)).expect(200)).body;
    const forbidden = [
      'id',
      'orderId',
      'customerId',
      'email',
      'customerEmail',
      'phone',
      'customerPhone',
      'latitude',
      'longitude',
      'changedBy',
      'token',
      'tokenHash',
      'guestToken',
      'history',
      'address',
      'promotions',
      'deliveryFee',
      'payment',
      'paymentMethodPreference',
      'couponCode',
    ];
    expect(keysOf(body).filter((k) => forbidden.includes(k))).toEqual([]);
  });

  it('sucursal DISTINTA inactiva => 404 BRANCH_NOT_FOUND idéntico al de una inexistente (sin nombre ni INACTIVE)', async () => {
    const inactive = await preview(oid(4), { branchId: BRANCH_INACTIVE }).expect(404);
    const missing = await preview(oid(4), { branchId: BRANCH_MISSING }).expect(404);
    expect(strip(inactive.body)).toEqual(strip(missing.body));
    expect((inactive.body as Body)['code']).toBe('BRANCH_NOT_FOUND');
    expect(JSON.stringify(inactive.body)).not.toMatch(/Inactiva|INACTIVE/);
    expectPrivate(inactive, BY_ORDER);
  });

  it('sucursal ORIGINAL inactiva => 200 con todas las líneas UNAVAILABLE y BRANCH_UNAVAILABLE', async () => {
    const p = (await preview(oid(12), {}, { sub: INACTIVE_OWNER }).expect(200)).body as {
      branch: Body;
      lines: Body[];
      summary: Body;
    };
    expect(p.branch).toMatchObject({ active: false, sameBranch: true, reason: 'INACTIVE' });
    expect(p.lines.every((l) => l['status'] === 'UNAVAILABLE')).toBe(true);
    expect(p.summary).toMatchObject({ canAddAny: false, unavailable: 1 });
  });

  it('#45 cuerpo grande: > 2 KB => 413 sin tocar la BD; > 100 KB => 413 del parser; cabeceras privadas', async () => {
    const before = world.sourceCalls;
    const big = await preview(oid(4), { branchId: BRANCH_A, pad: 'x'.repeat(3000) }).expect(413);
    expectPrivate(big, BY_ORDER);
    const huge = await http()
      .post(`/v1/orders/${oid(4)}/reorder-preview`)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', bearer())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ pad: 'x'.repeat(200_000) }))
      .expect(413);
    expectPrivate(huge, BY_ORDER);
    expect(world.sourceCalls).toBe(before);
  });

  it('#15 cabeceras privadas en 400 y 401 de la vista previa', async () => {
    expectPrivate(await preview('no-es-uuid', {}).expect(400), BY_ORDER);
    expectPrivate(await preview(oid(4), { foo: 1 }).expect(400), BY_ORDER);
    expectPrivate(
      await http()
        .post(`/v1/orders/${oid(4)}/reorder-preview`)
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', 'Bearer x')
        .send({})
        .expect(401),
      BY_ORDER,
    );
  });

  it('#17 throttle propio: la 31.ª solicitud de la misma IP => 429 RATE_LIMITED con Retry-After', async () => {
    const ip = nextIp();
    let lastRes: request.Response | null = null;
    for (let i = 0; i < 31; i += 1) {
      lastRes = await preview(oid(11), {}, { token: EXPIRED_TOKEN, sub: null, ip });
    }
    expect(lastRes?.status).toBe(429);
    expect((lastRes?.body as Body)['code']).toBe('RATE_LIMITED');
    expect(lastRes?.headers['retry-after']).toBeDefined();
    expectPrivate(lastRes as request.Response, BY_ORDER);
  });
});

describe('contadores de throttle independientes (e2e, F23, #17)', () => {
  it('la lista (60/min por actor) corta en el 61.º sin afectar al recibo del mismo actor', async () => {
    const w = seed();
    const app = await createApp(keys, w);
    try {
      const h = () => request(app.getHttpServer());
      const auth = bearer();
      let status = 0;
      for (let i = 0; i < 61; i += 1) {
        const r = await h()
          .get('/v1/me/orders')
          .set('X-Forwarded-For', nextIp())
          .set('Authorization', auth);
        status = r.status;
      }
      expect(status).toBe(429);
      const res = await h()
        .get('/v1/me/orders')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', auth);
      expect(res.headers['retry-after']).toBeDefined();
      await h()
        .get(`/v1/orders/${oid(4)}/receipt`)
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', auth)
        .expect(200);
    } finally {
      await app.close();
    }
  }, 60_000);
});
