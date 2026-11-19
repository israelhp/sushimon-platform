import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { ordersBusy } from '../src/orders/orders-errors.js';
import { BRANCH_A, BRANCH_B, FakeFulfillment, NOW } from './support/admin-orders-harness.js';
import { FakeAdminOrdersRepo } from './support/fake-admin-orders-repo.js';
import { FakePaymentsRepo } from './support/fake-payments-repo.js';
import { ROLE_PERMISSIONS } from './support/staff-context.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

/**
 * F24 (spec 025 §13, nivel E): pagos en efectivo del backoffice con supertest sobre la app REAL (guards, pipes, filtro,
 * throttles y middleware) y repositorios en memoria. El SQL se prueba contra PostgreSQL en `test/payments.int-spec.ts`.
 */
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const AAL1 = { aal: 'aal1', amr: [{ method: 'oauth', timestamp: 1 }] };
const MISSING = 'c0000000-0000-4000-8000-0000000000ff';
const KEY_A = 'aaaa1111-bbbb-4222-8ccc-dddd33334444';
const KEY_B = 'eeee5555-ffff-4666-8777-888899990000';
const PII_NAME = 'NOMBRE-SECRETO-E2E';
const CASH_PERMS = ['orders.read', 'payments.read', 'payments.confirm'];

interface Assignment {
  branchId: string | null;
  permissions: string[];
}
type Body = Record<string, unknown>;
const json = (res: request.Response) =>
  res.body as Body & { code?: string; current?: Body; message?: string };

function staffRow(id: string, assignments: Assignment[]) {
  return {
    id,
    fullName: `Empleado ${id.slice(0, 4)}`,
    active: true,
    assignments: assignments.map((a, i) => ({
      active: true,
      branchId: a.branchId,
      branch: a.branchId
        ? { id: a.branchId, name: `Sucursal ${i}`, code: `s-${i}`, active: true }
        : null,
      role: {
        code: `rol-${i}`,
        permissions: a.permissions.map((code) => ({ permission: { code } })),
      },
    })),
  };
}

describe('Pagos en efectivo del backoffice (e2e, F24)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let repo: FakeAdminOrdersRepo;
  let paymentsRepo: FakePaymentsRepo;
  let fulfillment: FakeFulfillment;
  let staffRows: Map<string, ReturnType<typeof staffRow>>;
  let logged: string[];
  const http = () => request(app.getHttpServer());

  async function createApp(gate?: DbGate) {
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
    const { AdminOrdersRepository } =
      await import('../src/orders/admin/admin-orders.repository.js');
    const { PaymentsRepository } = await import('../src/orders/payments/payments.repository.js');
    const { CLOCK } = await import('../src/branch-schedule/clock.js');
    const { ORDERS_DB_GATE } = await import('../src/orders/orders-errors.js');
    const { ORDER_FULFILLMENT_PORT } =
      await import('../src/orders/ports/order-fulfillment.port.js');
    const db = {
      customer: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      staffUser: {
        findUnique: vi.fn(({ where }: { where: { authUserId?: string; id?: string } }) =>
          Promise.resolve(staffRows.get(where.authUserId ?? where.id ?? '') ?? null),
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn(),
      $disconnect: () => Promise.resolve(),
    };
    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(JWKS_RESOLVER)
      .useValue(keys.jwks)
      .overrideProvider(AdminOrdersRepository)
      .useValue(repo)
      .overrideProvider(PaymentsRepository)
      .useValue(paymentsRepo)
      .overrideProvider(CLOCK)
      .useValue({ now: () => new Date(NOW.getTime()) })
      .overrideProvider(ORDER_FULFILLMENT_PORT)
      .useValue(fulfillment);
    if (gate) builder = builder.overrideProvider(ORDERS_DB_GATE).useValue(gate);
    const moduleRef = await builder.compile();
    const instance = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(instance, { corsOrigins: ['http://localhost:3000'], trustProxyHops: 1 });
    await instance.init();
    return instance;
  }

  /** Registra un empleado y devuelve su cabecera `Authorization` (cada empleado = un `sub` propio). */
  const actor = async (assignments: Assignment[], claims: Record<string, unknown> = AAL2) => {
    const id = randomUUID();
    const row = staffRow(id, assignments);
    staffRows.set(id, row);
    repo.staffNames.set(id, row.fullName);
    return `Bearer ${await keys.sign({ sub: id, ...claims })}`;
  };
  const admin = (claims?: Record<string, unknown>) =>
    actor([{ branchId: null, permissions: ROLE_PERMISSIONS['admin'] as string[] }], claims);
  const cashierAt = (b: string) => actor([{ branchId: b, permissions: CASH_PERMS }]);
  const base = (id: string) => `/v1/admin/orders/${id}/payment`;
  const getPay = (id: string, auth: string, ip = '10.0.0.1') =>
    http().get(base(id)).set('Authorization', auth).set('X-Forwarded-For', ip);
  const getHistory = (id: string, auth: string, ip = '10.0.0.1') =>
    http()
      .get(`${base(id)}/history`)
      .set('Authorization', auth)
      .set('X-Forwarded-For', ip);
  const pay = (
    id: string,
    auth: string,
    body: Body = { tendered: '200.00', receivedConfirmed: true },
    key: string | null = KEY_A,
    ip = '10.0.0.1',
  ) => {
    const r = http()
      .post(`${base(id)}/cash`)
      .set('Authorization', auth)
      .set('X-Forwarded-For', ip);
    return (key === null ? r : r.set('Idempotency-Key', key)).send(body);
  };

  beforeAll(async () => {
    keys = await createTestKeys();
  });

  beforeEach(async () => {
    logged = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    staffRows = new Map();
    repo = new FakeAdminOrdersRepo();
    paymentsRepo = new FakePaymentsRepo(repo);
    fulfillment = new FakeFulfillment();
    app = await createApp();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const seed = (over: Partial<Parameters<FakeAdminOrdersRepo['seed']>[0]> = {}) =>
    repo.seed({
      branchId: BRANCH_A,
      customerName: PII_NAME,
      placedAt: new Date(NOW.getTime() - 3_600_000),
      ...over,
    });

  describe('#23 #24 autenticación, MFA y permisos', () => {
    const routes: [string, (id: string, auth?: string) => request.Test][] = [
      ['GET payment', (id, a) => (a ? getPay(id, a) : http().get(base(id)))],
      ['GET history', (id, a) => (a ? getHistory(id, a) : http().get(`${base(id)}/history`))],
      [
        'POST cash',
        (id, a) => {
          const r = http()
            .post(`${base(id)}/cash`)
            .set('Idempotency-Key', KEY_A);
          return (a ? r.set('Authorization', a) : r).send({
            tendered: '200.00',
            receivedConfirmed: true,
          });
        },
      ],
    ];
    it.each(routes)(
      '%s: sin token 401; cliente (Google sin ser personal) 403; aal1 => 403 MFA_REQUIRED; todos con `private, no-store`',
      async (_name, call) => {
        const id = seed();
        const none = await call(id);
        expect(none.status).toBe(401);
        expect(none.headers['cache-control']).toBe('private, no-store');
        const customer = `Bearer ${await keys.sign({ sub: randomUUID() })}`;
        const notStaff = await call(id, customer);
        expect(notStaff.status).toBe(403);
        expect(notStaff.headers['cache-control']).toBe('private, no-store');
        const aal1 = await call(id, await admin(AAL1));
        expect(aal1.status).toBe(403);
        expect(json(aal1).message).toBe('MFA_REQUIRED');
        expect(aal1.headers['cache-control']).toBe('private, no-store');
      },
    );

    it('sin payments.read/payments.confirm (gerente: solo orders.*) => 403 genérico; permisos legados no sirven', async () => {
      const id = seed();
      const manager = await actor([
        { branchId: BRANCH_A, permissions: ROLE_PERMISSIONS['manager'] as string[] },
      ]);
      for (const res of [
        await getPay(id, manager),
        await getHistory(id, manager),
        await pay(id, manager),
      ]) {
        expect(res.status).toBe(403);
        expect(json(res).code).toBeUndefined();
      }
    });

    it('solo payments.read: GET ok con registration NO_PERMISSION; POST => 403 genérico (RequireStaff)', async () => {
      const id = seed();
      const reader = await actor([
        { branchId: BRANCH_A, permissions: ['orders.read', 'payments.read'] },
      ]);
      const res = await getPay(id, reader);
      expect(res.status).toBe(200);
      expect(json(res)['registration']).toEqual({ allowed: false, blockedReason: 'NO_PERMISSION' });
      expect((await getHistory(id, reader)).status).toBe(200);
      expect((await pay(id, reader)).status).toBe(403);
      expect(paymentsRepo.payments.get(id)?.status).toBe('pending');
    });

    it('ve el pedido (orders.read) pero payments.confirm solo en OTRA sucursal => 403 PAYMENT_ACTION_FORBIDDEN', async () => {
      const id = seed({ branchId: BRANCH_A });
      const auth = await actor([
        { branchId: BRANCH_A, permissions: ['orders.read'] },
        { branchId: BRANCH_B, permissions: ['payments.confirm', 'payments.read'] },
      ]);
      const res = await pay(id, auth);
      expect(res.status).toBe(403);
      expect(json(res).code).toBe('PAYMENT_ACTION_FORBIDDEN');
      expect(paymentsRepo.payments.get(id)?.status).toBe('pending');
    });
  });

  describe('#25 payments.confirm solo en A, orders.read en A y B', () => {
    it('POST sobre un pedido de B => 403 PAYMENT_ACTION_FORBIDDEN, sin pago ni evento ni auditoría; sobre A funciona', async () => {
      const inA = seed({ branchId: BRANCH_A });
      const inB = seed({ branchId: BRANCH_B });
      const auth = await actor([
        { branchId: BRANCH_A, permissions: ['orders.read', 'payments.read', 'payments.confirm'] },
        { branchId: BRANCH_B, permissions: ['orders.read'] },
      ]);
      const denied = await pay(inB, auth);
      expect(denied.status).toBe(403);
      expect(json(denied).code).toBe('PAYMENT_ACTION_FORBIDDEN');
      expect(paymentsRepo.payments.get(inB)?.status ?? 'pending').toBe('pending');
      expect(paymentsRepo.eventsOf(inB).filter((e) => e.type === 'cash_received')).toHaveLength(0);
      expect(paymentsRepo.audits).toEqual([]);
      expect((await pay(inA, auth)).status).toBe(201);
    });
  });

  describe('DELIVERY sin proveedor (GET y POST coinciden)', () => {
    it('GET registration bloqueada y POST 422 PAYMENT_NOT_COLLECTABLE', async () => {
      const id = seed({ fulfillmentType: 'DELIVERY', deliveryProvider: null });
      const auth = await cashierAt(BRANCH_A);
      expect((await getPay(id, auth)).body).toMatchObject({
        collectionContext: null,
        registration: { allowed: false, blockedReason: 'PROVIDER_BLOCKED_EXTERNAL' },
      });
      const res = await pay(id, auth);
      expect(res.status).toBe(422);
      expect(json(res).code).toBe('PAYMENT_NOT_COLLECTABLE');
    });
  });

  describe('#26 anti-IDOR: inexistente y otra sucursal => el MISMO 404', () => {
    it('cuerpo, cabeceras y número de sentencias idénticos en las tres rutas', async () => {
      const foreign = seed({ branchId: BRANCH_B });
      const auth = await cashierAt(BRANCH_A);
      const calls = [
        (id: string) => getPay(id, auth),
        (id: string) => getHistory(id, auth),
        (id: string) => pay(id, auth),
      ];
      for (const call of calls) {
        paymentsRepo.calls.length = 0;
        const a = await call(foreign);
        const callsA = [...paymentsRepo.calls];
        paymentsRepo.calls.length = 0;
        const b = await call(MISSING);
        const callsB = [...paymentsRepo.calls];
        expect(a.status).toBe(404);
        expect(json(a).code).toBe('ORDER_NOT_FOUND');
        expect(a.body).toEqual({ ...(b.body as Body), requestId: (a.body as Body)['requestId'] });
        expect(a.headers['cache-control']).toBe(b.headers['cache-control']);
        expect(callsA).toEqual(callsB);
      }
      expect(paymentsRepo.payments.has(foreign)).toBe(false);
    });

    it('id que no es UUID => 400', async () => {
      const auth = await admin();
      expect((await getPay('no-es-uuid', auth)).status).toBe(400);
      expect((await pay('no-es-uuid', auth)).status).toBe(400);
    });

    it('personal de la sucursal A no ve el pago ni el historial de B', async () => {
      const foreign = seed({ branchId: BRANCH_B });
      const auth = await cashierAt(BRANCH_A);
      expect((await getPay(foreign, auth)).status).toBe(404);
      expect((await getHistory(foreign, auth)).status).toBe(404);
    });
  });

  describe('#8 #9 #10 registro, idempotencia y respuesta perdida', () => {
    it('GET: pedido PENDING => CASH/PENDING con registration permitida; el cliente nunca ve datos internos', async () => {
      const id = seed();
      const res = await getPay(id, await cashierAt(BRANCH_A));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        orderId: id,
        method: 'CASH',
        status: 'PENDING',
        amountDue: '185.00',
        outstanding: '185.00',
        currency: 'GTQ',
        collectionContext: 'BRANCH',
        registration: { allowed: true, blockedReason: null },
        reception: null,
      });
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['etag']).toBeUndefined();
    });

    it('POST: 201 con cambio calculado en el servidor, recepción y `private, no-store`; luego GET = PAID', async () => {
      const id = seed();
      const auth = await cashierAt(BRANCH_A);
      const res = await pay(id, auth);
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['idempotent-replayed']).toBeUndefined();
      expect(res.body).toMatchObject({
        replayed: false,
        appliedByMe: true,
        payment: {
          status: 'PAID',
          outstanding: '0.00',
          amountDue: '185.00',
          reception: {
            amountApplied: '185.00',
            tendered: '200.00',
            change: '15.00',
            collectorType: 'STAFF',
            context: 'BRANCH',
            branchId: BRANCH_A,
          },
        },
      });
      const after = await getPay(id, auth);
      expect(after.body).toMatchObject({
        status: 'PAID',
        registration: { blockedReason: 'ALREADY_PAID' },
      });
    });

    it('#18 repetición misma clave+cuerpo => 200 + Idempotent-Replayed: true con la recepción original', async () => {
      const id = seed();
      const auth = await cashierAt(BRANCH_A);
      const first = await pay(id, auth);
      const again = await pay(id, auth);
      expect(again.status).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.headers['cache-control']).toBe('private, no-store');
      expect(json(again)['replayed']).toBe(true);
      expect((again.body as Body & { payment: Body })['payment']['reception']).toEqual(
        (first.body as Body & { payment: Body })['payment']['reception'],
      );
      expect(paymentsRepo.audits).toHaveLength(1);
    });

    it('#18 otra persona repite la misma clave+cuerpo: replay con appliedByMe=false', async () => {
      const id = seed();
      await pay(id, await cashierAt(BRANCH_A));
      const again = await pay(id, await cashierAt(BRANCH_A));
      expect(again.status).toBe(200);
      expect(json(again)['appliedByMe']).toBe(false);
    });

    it('#16 doble pago con OTRA clave => 409 PAYMENT_ALREADY_REGISTERED con `current`', async () => {
      const id = seed();
      const auth = await cashierAt(BRANCH_A);
      await pay(id, auth);
      const res = await pay(id, auth, { tendered: '200.00', receivedConfirmed: true }, KEY_B);
      expect(res.status).toBe(409);
      expect(json(res).code).toBe('PAYMENT_ALREADY_REGISTERED');
      expect(json(res).current).toMatchObject({ orderId: id, status: 'PAID' });
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(paymentsRepo.audits).toHaveLength(1);
    });

    it('#22 misma clave con OTRO cuerpo => 409 IDEMPOTENCY_KEY_REUSED (sin `current`)', async () => {
      const id = seed();
      const auth = await cashierAt(BRANCH_A);
      await pay(id, auth);
      const res = await pay(id, auth, { tendered: '300.00', receivedConfirmed: true });
      expect(res.status).toBe(409);
      expect(json(res).code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(json(res).current).toBeUndefined();
    });

    it('#17 doble clic simultáneo con la misma clave: un 201 y un 200 replayed; un solo evento y una auditoría', async () => {
      const id = seed();
      const auth = await cashierAt(BRANCH_A);
      const [x, y] = await Promise.all([
        pay(id, auth),
        pay(id, auth, undefined, KEY_A, '10.0.0.2'),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 201]);
      expect(paymentsRepo.eventsOf(id).filter((e) => e.type === 'cash_received')).toHaveLength(1);
      expect(paymentsRepo.audits).toHaveLength(1);
    });

    it('#19 carrera simulada: 6 cajeros con claves distintas => 1 gana (201) y 5 reciben 409', async () => {
      const id = seed();
      const results = await Promise.all(
        Array.from({ length: 6 }, async (_, i) =>
          pay(
            id,
            await cashierAt(BRANCH_A),
            undefined,
            `k${i}-abcdefghijklmnopqrstuvwxyz`,
            `10.1.0.${i}`,
          ),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).map((r) => json(r).code)).toEqual(
        Array(5).fill('PAYMENT_ALREADY_REGISTERED'),
      );
    });
  });

  describe('#11 #12 #14 validación de entrada', () => {
    it.each([
      ['-5', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['0', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['0.00', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['abc', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['1e2', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['1,000.00', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['NaN', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['200.001', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['-1', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['1.234', 400, 'PAYMENT_AMOUNT_INVALID'],
      [' 100', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['100 ', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['100\n', 400, 'PAYMENT_AMOUNT_INVALID'],
      ['100\n.00', 400, 'PAYMENT_AMOUNT_INVALID'],
      [200, 400, 'PAYMENT_AMOUNT_INVALID'],
      ['184.99', 422, 'CASH_AMOUNT_INSUFFICIENT'],
      ['5000.01', 422, 'CASH_TENDERED_TOO_LARGE'],
    ])('tendered %j => %i %s y no escribe nada', async (tendered, status, code) => {
      const id = seed();
      const res = await pay(id, await cashierAt(BRANCH_A), { tendered, receivedConfirmed: true });
      expect(res.status).toBe(status);
      expect(json(res).code).toBe(code);
      expect(paymentsRepo.payments.get(id)?.status ?? 'pending').toBe('pending');
      expect(paymentsRepo.audits).toEqual([]);
    });

    it('5000.00 => 201', async () => {
      const res = await pay(seed(), await cashierAt(BRANCH_A), {
        tendered: '5000.00',
        receivedConfirmed: true,
      });
      expect(res.status).toBe(201);
    });

    it.each([[false], ['true'], [undefined]])(
      'receivedConfirmed %j => 400 PAYMENT_CONFIRMATION_REQUIRED',
      async (receivedConfirmed) => {
        const res = await pay(seed(), await cashierAt(BRANCH_A), {
          tendered: '200.00',
          receivedConfirmed,
        });
        expect(res.status).toBe(400);
        expect(json(res).code).toBe('PAYMENT_CONFIRMATION_REQUIRED');
      },
    );

    it.each([
      ['staffId', { staffId: randomUUID() }],
      ['collectorId', { collectorId: randomUUID() }],
      ['receivedBy', { receivedBy: 'otro' }],
      ['branchId', { branchId: BRANCH_B }],
      ['change', { change: '0.00' }],
      ['receivedAt', { receivedAt: '2020-01-01T00:00:00.000Z' }],
      ['date', { date: '2020-01-01' }],
      ['collectorType (RIDER)', { collectorType: 'RIDER' }],
      ['currency', { currency: 'USD' }],
      ['total', { total: '1.00' }],
    ])('campo %s en la entrada => 400 (lista blanca) y no escribe', async (_n, extra) => {
      const id = seed();
      const res = await pay(id, await cashierAt(BRANCH_A), {
        tendered: '200.00',
        receivedConfirmed: true,
        ...extra,
      });
      expect(res.status).toBe(400);
      expect(paymentsRepo.payments.get(id)?.status ?? 'pending').toBe('pending');
    });

    it('`__proto__` en el cuerpo => 400', async () => {
      const res = await http()
        .post(`${base(seed())}/cash`)
        .set('Authorization', await cashierAt(BRANCH_A))
        .set('Idempotency-Key', KEY_A)
        .set('Content-Type', 'application/json')
        .send('{"tendered":"200.00","receivedConfirmed":true,"__proto__":{"x":1}}');
      expect(res.status).toBe(400);
    });

    it('Idempotency-Key duplicada como cabecera múltiple (a, b) => 400 IDEMPOTENCY_KEY_INVALID sin escribir', async () => {
      const id = seed();
      const auth = await cashierAt(BRANCH_A);
      const merged = await http()
        .post(`${base(id)}/cash`)
        .set('Authorization', auth)
        .set('Idempotency-Key', `${KEY_A}, ${KEY_B}`)
        .send({ tendered: '200.00', receivedConfirmed: true });
      expect(merged.status).toBe(400);
      expect(json(merged).code).toBe('IDEMPOTENCY_KEY_INVALID');
      const repeated = await http()
        .post(`${base(id)}/cash`)
        .set('Authorization', auth)
        .set('Idempotency-Key', [KEY_A, KEY_B] as unknown as string)
        .send({ tendered: '200.00', receivedConfirmed: true });
      expect(repeated.status).toBe(400);
      expect(json(repeated).code).toBe('IDEMPOTENCY_KEY_INVALID');
      expect(paymentsRepo.payments.get(id)?.status ?? 'pending').toBe('pending');
    });

    it.each([[null], ['corta'], ['x'.repeat(129)]])(
      'Idempotency-Key %j => 400 IDEMPOTENCY_KEY_INVALID',
      async (key) => {
        const res = await pay(seed(), await cashierAt(BRANCH_A), undefined, key);
        expect(res.status).toBe(400);
        expect(json(res).code).toBe('IDEMPOTENCY_KEY_INVALID');
      },
    );
  });

  describe('#33 #34 #36 #37 modalidades y estado operativo', () => {
    it('cobrar NO cambia el estado del pedido ni updatedAt; F22 lo ve PAID en listado y detalle (paymentStatus)', async () => {
      const id = seed({ status: 'preparing' });
      const before = repo.orders.get(id)?.updatedAt;
      const auth = await admin();
      expect((await pay(id, auth)).status).toBe(201);
      expect(repo.orders.get(id)?.status).toBe('preparing');
      expect(repo.orders.get(id)?.updatedAt).toEqual(before);
      const list = await get('/v1/admin/orders', auth);
      expect((json(list)['items'] as Body[]).find((o) => o['id'] === id)).toMatchObject({
        status: 'preparing',
        paymentStatus: 'PAID',
      });
      const detail = await get(`/v1/admin/orders/${id}`, auth);
      expect(json(detail)['payment']).toMatchObject({ status: 'PAID', outstanding: '0.00' });
    });

    it('mover el pedido (accept..complete) nunca marca PAID', async () => {
      const id = seed({ status: 'ready' });
      const auth = await admin();
      const done = await http()
        .post(`/v1/admin/orders/${id}/complete`)
        .set('Authorization', auth)
        .send({ expectedStatus: 'ready' });
      expect(done.status).toBe(200);
      expect((json(done)['order'] as Body)['paymentStatus']).toBe('PENDING');
      expect((await getPay(id, auth)).body).toMatchObject({
        status: 'PENDING',
        orderStatus: 'picked_up',
      });
    });

    it('DELIVERY OWN: contexto OWN_DELIVERY derivado del pedido (no de la entrada)', async () => {
      const id = seed({ fulfillmentType: 'DELIVERY' });
      const res = await pay(id, await cashierAt(BRANCH_A));
      expect((res.body as Body & { payment: Body })['payment']['collectionContext']).toBe(
        'OWN_DELIVERY',
      );
    });

    it('PedidosYa: registration bloqueada, collectionContext null y POST 422 PAYMENT_NOT_COLLECTABLE', async () => {
      const id = seed({ fulfillmentType: 'DELIVERY', deliveryProvider: 'PEDIDOSYA' });
      const auth = await cashierAt(BRANCH_A);
      expect((await getPay(id, auth)).body).toMatchObject({
        collectionContext: null,
        registration: { allowed: false, blockedReason: 'PROVIDER_BLOCKED_EXTERNAL' },
      });
      const res = await pay(id, auth);
      expect(res.status).toBe(422);
      expect(json(res).code).toBe('PAYMENT_NOT_COLLECTABLE');
      expect((json(res) as Body & { violations: Body[] }).violations[0]?.['code']).toBe(
        'PROVIDER_BLOCKED_EXTERNAL',
      );
    });

    it('#61 pedido histórico sin pago: lectura CASH/PENDING y POST 422 LEGACY_PAYMENT_METHOD', async () => {
      const id = seed({ paymentStatus: null, paymentMethodPreference: 'bank_transfer' });
      const auth = await cashierAt(BRANCH_A);
      expect((await getPay(id, auth)).body).toMatchObject({ method: 'CASH', status: 'PENDING' });
      const res = await pay(id, auth);
      expect(res.status).toBe(422);
      expect((json(res) as Body & { violations: Body[] }).violations[0]?.['code']).toBe(
        'LEGACY_PAYMENT_METHOD',
      );
    });
  });

  describe('#38 #39 cancelado/rechazado', () => {
    it('SIN cobro => 409 ORDER_NOT_PAYABLE con `current`; el pago sigue PENDING y no hay devolución', async () => {
      const id = seed({ status: 'cancelled' });
      const res = await pay(id, await cashierAt(BRANCH_A));
      expect(res.status).toBe(409);
      expect(json(res).code).toBe('ORDER_NOT_PAYABLE');
      expect(json(res).current).toMatchObject({ status: 'PENDING', possibleRefundReview: false });
      expect(paymentsRepo.payments.get(id)?.status ?? 'pending').toBe('pending');
    });

    it('CON cobro: sigue PAID, possibleRefundReview y `payment_review` al cancelar/rechazar', async () => {
      const id = seed();
      const auth = await admin();
      await pay(id, auth);
      const cancel = await http()
        .post(`/v1/admin/orders/${id}/cancel`)
        .set('Authorization', auth)
        .send({ expectedStatus: 'pending', reason: 'Cliente canceló' });
      expect(cancel.status).toBe(200);
      expect(json(cancel)['pendingActions']).toEqual(['payment_review']);
      expect((await getPay(id, auth)).body).toMatchObject({
        status: 'PAID',
        orderStatus: 'cancelled',
        possibleRefundReview: true,
      });
      expect((await pay(id, auth)).status).toBe(200); // replay, no 409
    });
  });

  describe('#30 historial y #46 sin fuga', () => {
    it('GET history: CREATED y CASH_RECEIVED con nombre del actor; sin ids ni hashes ni PII del cliente', async () => {
      const id = seed();
      const auth = await cashierAt(BRANCH_A);
      await pay(id, auth);
      const res = await getHistory(id, auth);
      expect(res.status).toBe(200);
      const items = json(res)['items'] as Body[];
      expect(items.map((e) => e['type'])).toEqual(['CREATED', 'CASH_RECEIVED']);
      expect(items[1]).toMatchObject({ tendered: '200.00', change: '15.00', amountDue: '185.00' });
      expect(typeof items[1]?.['actorName']).toBe('string');
      expect(res.headers['cache-control']).toBe('private, no-store');
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/hash|staffId|receivedBy|Idempotency/i);
      expect(raw).not.toContain(PII_NAME);
      for (const [id2] of staffRows) expect(raw).not.toContain(id2);
    });
  });

  describe('sin transferencia ni rutas fuera del contrato', () => {
    it.each([
      ['post', '/payment/transfer'],
      ['post', '/payment/confirm-transfer'],
      ['post', '/payment/card'],
      ['get', '/payments'],
      ['post', '/payment/refund'],
    ])('%s %s => 404', async (method, suffix) => {
      const id = seed();
      const auth = await admin();
      const url = `/v1/admin/orders/${id}${suffix}`;
      const r = method === 'get' ? http().get(url) : http().post(url).send({});
      expect((await r.set('Authorization', auth)).status).toBe(404);
    });
  });

  describe('#59 #60 gate, throttles y logs', () => {
    it('gate saturado => 503 ORDERS_BUSY con Retry-After y `private, no-store` (lectura y escritura)', async () => {
      await app.close();
      const gate = new DbGate(1, 0, 5_000, ordersBusy);
      app = await createApp(gate);
      let free!: () => void;
      const held = gate.run(() => new Promise<void>((resolve) => (free = resolve)));
      const auth = await admin();
      const id = seed();
      for (const res of [await getPay(id, auth), await getHistory(id, auth), await pay(id, auth)]) {
        expect(res.status).toBe(503);
        expect(json(res).code).toBe('ORDERS_BUSY');
        expect(res.headers['retry-after']).toBe('2');
        expect(res.headers['cache-control']).toBe('private, no-store');
      }
      free();
      await held;
      expect(paymentsRepo.payments.get(id)?.status ?? 'pending').toBe('pending');
    });

    it('comando: 30/min por actor => 429 RATE_LIMITED con Retry-After; las lecturas tienen contador propio', async () => {
      const auth = await cashierAt(BRANCH_A);
      const id = seed();
      let last = 0;
      for (let i = 0; i < 31; i += 1) {
        const res = await pay(id, auth, {}, KEY_A, `10.9.0.${i % 200}`);
        last = res.status;
        if (i < 30) expect(res.status).toBe(400);
        else {
          expect(json(res).code).toBe('RATE_LIMITED');
          expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
          expect(res.headers['cache-control']).toBe('private, no-store');
        }
      }
      expect(last).toBe(429);
      expect((await getPay(id, auth)).status).toBe(200);
    });

    it('lectura: 60/min por actor => 429', async () => {
      const auth = await cashierAt(BRANCH_A);
      const id = seed();
      let last = 0;
      for (let i = 0; i < 61; i += 1) last = (await getPay(id, auth, `10.8.0.${i % 200}`)).status;
      expect(last).toBe(429);
    });

    it('#60 los logs no contienen claves, importes entregados, hashes ni PII', async () => {
      const id = seed();
      await pay(id, await cashierAt(BRANCH_A));
      await pay(id, await cashierAt(BRANCH_A));
      const raw = logged.join('\n');
      expect(raw).not.toContain(KEY_A);
      expect(raw).not.toMatch(/200\.00|tendered|hash/i);
      expect(raw).not.toContain(PII_NAME);
    });
  });

  const get = (path: string, auth: string, ip = '10.0.0.1') =>
    http().get(path).set('Authorization', auth).set('X-Forwarded-For', ip);
});
