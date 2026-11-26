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

const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const AAL1 = { aal: 'aal1', amr: [{ method: 'oauth', timestamp: 1 }] };
const PII_NAME = 'NOMBRE-SECRETO-E2E';
const PII_PHONE = '+50299887766';
const PII_NOTES = 'NOTA-SECRETA-E2E';
const REASON = 'MOTIVO-INTERNO-E2E';
const MISSING = 'c0000000-0000-4000-8000-0000000000ff';

interface Assignment {
  branchId: string | null;
  permissions: string[];
}
type Body = Record<string, unknown>;
const json = (res: request.Response) => res.body as Body & { code?: string; current?: Body };

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

describe('Gestión de pedidos del backoffice (e2e, F22)', () => {
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
    staffRows.set(id, staffRow(id, assignments));
    return `Bearer ${await keys.sign({ sub: id, ...claims })}`;
  };
  const roleAt = (role: string, branchId: string | null) => [
    { branchId, permissions: ROLE_PERMISSIONS[role] as string[] },
  ];
  const manager = (b: string | null = BRANCH_A) => actor(roleAt('manager', b));
  const post = (path: string, auth: string, body: Body, ip = '10.0.0.1') =>
    http().post(path).set('Authorization', auth).set('X-Forwarded-For', ip).send(body);
  const get = (path: string, auth: string, ip = '10.0.0.1') =>
    http().get(path).set('Authorization', auth).set('X-Forwarded-For', ip);

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
      customerPhone: PII_PHONE,
      notes: PII_NOTES,
      placedAt: new Date(NOW.getTime() - 3_600_000),
      ...over,
    });

  describe('fila 4: autenticación y MFA', () => {
    const routes: [string, string][] = [
      ['get', '/v1/admin/orders'],
      ['get', '/v1/admin/orders/board'],
      ['get', `/v1/admin/orders/${MISSING}`],
      ['post', `/v1/admin/orders/${MISSING}/accept`],
      ['post', `/v1/admin/orders/${MISSING}/reject`],
      ['post', `/v1/admin/orders/${MISSING}/start-preparing`],
      ['post', `/v1/admin/orders/${MISSING}/mark-ready`],
      ['post', `/v1/admin/orders/${MISSING}/complete`],
      ['post', `/v1/admin/orders/${MISSING}/cancel`],
    ];
    it.each(routes)(
      '%s %s: sin token => 401, sin personal => 403, aal1 => 403 MFA_REQUIRED, todos con no-store',
      async (method, path) => {
        const call = (auth?: string) => {
          const r =
            method === 'get'
              ? http().get(path)
              : http().post(path).send({ expectedStatus: 'pending', reason: 'motivo' });
          return auth ? r.set('Authorization', auth) : r;
        };
        const none = await call();
        expect(none.status).toBe(401);
        expect(none.headers['cache-control']).toBe('no-store');
        const customer = `Bearer ${await keys.sign({ sub: randomUUID() })}`; // Google OAuth sin ser personal
        const notStaff = await call(customer);
        expect(notStaff.status).toBe(403);
        expect(notStaff.headers['cache-control']).toBe('no-store');
        const aal1 = await call(await actor(roleAt('admin', null), AAL1));
        expect(aal1.status).toBe(403);
        expect(json(aal1)['message']).toBe('MFA_REQUIRED');
        expect(aal1.headers['cache-control']).toBe('no-store');
      },
    );
  });

  it('fila 3: sin el permiso del comando => 403 genérico (no personal con ese permiso); permisos legados no sirven', async () => {
    const id = seed();
    const readOnly = await actor([{ branchId: BRANCH_A, permissions: ['orders.read'] }]);
    const res = await post(`/v1/admin/orders/${id}/accept`, readOnly, {
      expectedStatus: 'pending',
    });
    expect(res.status).toBe(403);
    expect(json(res).code).toBeUndefined();
    const legacy = await actor([
      { branchId: BRANCH_A, permissions: ['orders.read', 'orders.status', 'orders.dispatch'] },
    ]);
    expect(
      (await post(`/v1/admin/orders/${id}/accept`, legacy, { expectedStatus: 'pending' })).status,
    ).toBe(403);
    expect(repo.audits).toHaveLength(0);
  });

  describe('lecturas', () => {
    it('listado: forma del contrato, sin PII de contacto, no-store y alcance por sucursal', async () => {
      const a = seed();
      seed({ branchId: BRANCH_B });
      const res = await get('/v1/admin/orders', await manager());
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const page = json(res) as { items: Body[]; nextCursor: unknown; generatedAt: unknown };
      expect(Object.keys(page).sort()).toEqual(['generatedAt', 'items', 'nextCursor']);
      expect(page.items.map((i) => i['id'])).toEqual([a]);
      expect(Object.keys(page.items[0] as Body).sort()).toEqual(
        [
          'availableActions',
          'branchId',
          'branchName',
          'customerName',
          'deliveryProvider',
          'displayNumber',
          'fulfillmentType',
          'id',
          'itemCount',
          'orderNumber',
          'paymentMethodPreference',
          'paymentStatus',
          'placedAt',
          'status',
          'total',
          'updatedAt',
        ].sort(),
      );
      const raw = JSON.stringify(res.body);
      for (const leak of [PII_PHONE, PII_NOTES, 'customerPhone', 'email'])
        expect(raw).not.toContain(leak);
      expect(page.items[0]).toMatchObject({
        customerName: PII_NAME,
        displayNumber: expect.stringMatching(/^MON-\d{6}$/) as unknown,
      });
    });

    it('validación de parámetros: status fuera del catálogo, limit, uuid, fechas sin zona, rango => 400', async () => {
      const auth = await manager();
      for (const q of [
        'status=hacked',
        'status=pending,pending',
        'limit=0',
        'limit=51',
        'branchId=nope',
        'from=2026-11-01T00:00:00',
        'q=a',
        'cursor=!!!',
        'sort=x',
      ]) {
        const res = await get(`/v1/admin/orders?${q}`, auth);
        expect(res.status, q).toBe(400);
        expect(res.headers['cache-control']).toBe('no-store');
      }
      expect(json(await get('/v1/admin/orders?cursor=AAAA', auth)).code).toBe(
        'ORDER_CURSOR_INVALID',
      );
      expect((await get('/v1/admin/orders?status=pending,accepted&limit=5', auth)).status).toBe(
        200,
      );
      // ADR-0036: el filtro `fulfillmentType` se retiró => 400 como cualquier parámetro desconocido.
      for (const q of ['fulfillmentType=PICKUP', 'fulfillmentType=DELIVERY']) {
        const res = await get(`/v1/admin/orders?${q}`, auth);
        expect(res.status, q).toBe(400);
        expect(res.headers['cache-control']).toBe('no-store');
      }
      expect((await get('/v1/admin/orders/board?limit=0', auth)).status).toBe(400);
    });

    it('cursor con fecha inexistente o año 0000 => 400 ORDER_CURSOR_INVALID (nunca 500); 22008 de la BD => 400', async () => {
      const auth = await manager();
      const enc = (key: string) =>
        Buffer.from(`v1|${key}|c0000000-0000-4000-8000-000000000001`).toString('base64url');
      for (const key of ['2023-02-31T10:00:00.000000Z', '0000-01-01T00:00:00.000000Z']) {
        const res = await get(`/v1/admin/orders?cursor=${enc(key)}`, auth);
        expect([res.status, json(res).code], key).toEqual([400, 'ORDER_CURSOR_INVALID']);
        expect(res.headers['cache-control']).toBe('no-store');
      }
      repo.listFailWith = { code: '22008' };
      const res = await get('/v1/admin/orders', auth);
      expect([res.status, json(res).code]).toEqual([400, 'ORDER_CURSOR_INVALID']);
    });

    it('fila 6: branchId ajeno => 404 BRANCH_NOT_FOUND (listado y tablero)', async () => {
      seed({ branchId: BRANCH_B });
      const auth = await manager();
      for (const path of ['/v1/admin/orders', '/v1/admin/orders/board']) {
        const res = await get(`${path}?branchId=${BRANCH_B}`, auth);
        expect(res.status).toBe(404);
        expect(json(res).code).toBe('BRANCH_NOT_FOUND');
      }
    });

    it('tablero: 9 columnas, `board` no se confunde con un id, summary y pollAfterSeconds', async () => {
      seed();
      const res = await get('/v1/admin/orders/board', await manager());
      expect(res.status).toBe(200);
      const board = json(res) as {
        columns: { status: string; count: number }[];
        summary: Body;
        pollAfterSeconds: number;
        terminalWindowHours: number;
      };
      expect(board.columns).toHaveLength(9);
      expect(board.columns[0]).toMatchObject({ status: 'pending', count: 1 });
      expect(board.summary).toMatchObject({ pending: 1, active: 1 });
      expect(board).toMatchObject({
        pollAfterSeconds: 15,
        terminalWindowHours: 24,
        branchId: null,
      });
    });

    it('detalle: teléfono completo y sin correo; UUID inválido => 400; ajeno e inexistente => 404 IDÉNTICO (fila 6)', async () => {
      const mine = seed();
      const foreign = seed({ branchId: BRANCH_B });
      const auth = await manager();
      const res = await get(`/v1/admin/orders/${mine}`, auth);
      expect(res.status).toBe(200);
      expect(json(res)['contact']).toEqual({ fullName: PII_NAME, phone: PII_PHONE });
      expect(json(res)['payment']).toMatchObject({
        method: 'CASH',
        status: 'PENDING',
        amountDue: '185.00',
        registration: { allowed: false, blockedReason: 'NO_PERMISSION' }, // el gerente no tiene payments.confirm (P91)
      });
      expect(JSON.stringify(res.body)).not.toMatch(/email|changedBy/i);
      expect((await get('/v1/admin/orders/no-es-uuid', auth)).status).toBe(400);
      const a = await get(`/v1/admin/orders/${foreign}`, auth);
      const b = await get(`/v1/admin/orders/${MISSING}`, auth);
      expect(a.status).toBe(404);
      expect(json(a).code).toBe('ORDER_NOT_FOUND');
      const norm = (r: request.Response) => {
        const { requestId: _r, ...body } = r.body as Body;
        void _r;
        const headers = { ...r.headers };
        for (const h of Object.keys(headers)) {
          if (
            ['x-request-id', 'date', 'etag', 'content-length'].includes(h) ||
            h.startsWith('x-ratelimit')
          )
            delete headers[h];
        }
        return { status: r.status, body, headers };
      };
      expect(norm(a)).toEqual(norm(b));
    });
  });

  describe('comandos', () => {
    it('recorrido PICKUP por HTTP: 200 (no 201), historial y auditoría; el motivo no sale en logs ni auditoría de valores', async () => {
      const id = seed();
      const auth = await manager();
      const steps: [string, string, string][] = [
        ['accept', 'pending', 'accepted'],
        ['start-preparing', 'accepted', 'preparing'],
        ['mark-ready', 'preparing', 'ready'],
        ['complete', 'ready', 'picked_up'],
      ];
      for (const [route, from, to] of steps) {
        const res = await post(`/v1/admin/orders/${id}/${route}`, auth, { expectedStatus: from });
        expect(res.status, route).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(json(res)['transition']).toMatchObject({
          from,
          to,
          replayed: false,
          appliedByMe: true,
        });
        expect(Object.keys(json(res)).sort()).toEqual(['order', 'pendingActions', 'transition']);
        expect((json(res)['order'] as Body)['status']).toBe(to);
      }
      expect(repo.eventsOf(id).map((e) => e.newStatus)).toEqual([
        'pending',
        'accepted',
        'preparing',
        'ready',
        'picked_up',
      ]);
      const second = seed();
      const cancelled = await post(`/v1/admin/orders/${second}/cancel`, auth, {
        expectedStatus: 'pending',
        reason: REASON,
      });
      expect(cancelled.status).toBe(200);
      expect(JSON.stringify(repo.audits.map((a) => [a.oldValues, a.newValues]))).not.toContain(
        REASON,
      );
      for (const line of logged)
        for (const leak of [REASON, PII_NAME, PII_PHONE, PII_NOTES])
          expect(line).not.toContain(leak);
    });

    it('fila 9: cuerpo — expectedStatus ausente/fuera del catálogo, campos desconocidos, __proto__, reason en otros comandos, UUID => 400 sin escribir', async () => {
      const id = seed();
      const auth = await manager();
      const bad: Body[] = [
        {},
        { expectedStatus: 'hacked' },
        { expectedStatus: 5 },
        { expectedStatus: 'pending', extra: 1 },
        { expectedStatus: 'pending', reason: 'no aplica' },
      ];
      for (const body of bad)
        expect(
          (await post(`/v1/admin/orders/${id}/accept`, auth, body)).status,
          JSON.stringify(body),
        ).toBe(400);
      const proto = await http()
        .post(`/v1/admin/orders/${id}/accept`)
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send('{"expectedStatus":"pending","__proto__":{"x":1}}');
      expect(proto.status).toBe(400);
      expect(
        (await post('/v1/admin/orders/xyz/accept', auth, { expectedStatus: 'pending' })).status,
      ).toBe(400);
      expect(
        (
          await post(`/v1/admin/orders/${id}/accept`, auth, {
            expectedStatus: 'pending',
            reason: 'x',
          })
        ).status,
      ).toBe(400);
      expect(repo.audits).toHaveLength(0);
      expect(repo.calls).not.toContain('transaction');
    });

    it('fila 8: reject/cancel sin motivo, vacío o corto => 400 ORDER_REASON_REQUIRED; 281 => 400', async () => {
      const id = seed();
      const auth = await manager();
      for (const route of ['reject', 'cancel']) {
        for (const body of [
          { expectedStatus: 'pending' },
          { expectedStatus: 'pending', reason: '' },
          { expectedStatus: 'pending', reason: '   ' },
          { expectedStatus: 'pending', reason: 'ab' },
        ]) {
          const res = await post(`/v1/admin/orders/${id}/${route}`, auth, body);
          expect(res.status).toBe(400);
          expect(json(res).code).toBe('ORDER_REASON_REQUIRED');
        }
        expect(
          (
            await post(`/v1/admin/orders/${id}/${route}`, auth, {
              expectedStatus: 'pending',
              reason: 'x'.repeat(281),
            })
          ).status,
        ).toBe(400);
      }
      expect(repo.audits).toHaveLength(0);
    });

    it('fila 6 y 7: 404 uniforme (ajeno = inexistente) y 403 ORDER_ACTION_FORBIDDEN solo si ve el pedido', async () => {
      const mine = seed();
      const foreign = seed({ branchId: BRANCH_B });
      const kitchen = await actor(roleAt('kitchen', BRANCH_A));
      // ve A (orders.read) pero su orders.cancel es solo de B: pasa RequireStaff y recibe 403 de recurso
      const cancelOnlyInB = await actor([
        { branchId: BRANCH_A, permissions: ['orders.read'] },
        { branchId: BRANCH_B, permissions: ['orders.read', 'orders.cancel'] },
      ]);
      const res403 = await post(`/v1/admin/orders/${mine}/cancel`, cancelOnlyInB, {
        expectedStatus: 'pending',
        reason: 'motivo ok',
      });
      expect(res403.status).toBe(403);
      expect(json(res403).code).toBe('ORDER_ACTION_FORBIDDEN');
      const foreignRes = await post(`/v1/admin/orders/${foreign}/accept`, kitchen, {
        expectedStatus: 'pending',
      });
      const missingRes = await post(`/v1/admin/orders/${MISSING}/accept`, kitchen, {
        expectedStatus: 'pending',
      });
      expect(foreignRes.status).toBe(404);
      const strip = (r: request.Response) => ({ ...(r.body as Body), requestId: undefined });
      expect(strip(foreignRes)).toEqual(strip(missingRes));
      expect(json(foreignRes).code).toBe('ORDER_NOT_FOUND');
      // IDOR por los seis comandos
      for (const route of [
        'accept',
        'reject',
        'start-preparing',
        'mark-ready',
        'complete',
        'cancel',
      ]) {
        const payload = ['reject', 'cancel'].includes(route)
          ? { expectedStatus: 'pending', reason: 'motivo ok' }
          : { expectedStatus: 'pending' };
        const m = await post(`/v1/admin/orders/${foreign}/${route}`, await manager(), payload);
        const n = await post(`/v1/admin/orders/${MISSING}/${route}`, await manager(), payload);
        expect([m.status, json(m).code]).toEqual([404, 'ORDER_NOT_FOUND']);
        expect(strip(m)).toEqual(strip(n));
      }
      expect(repo.orders.get(foreign)?.status).toBe('pending');
    });

    it('fila 19: 409 ORDER_STATE_CONFLICT con current {status, updatedAt}; fila 10/12: 422 con violations y current', async () => {
      const id = seed({ status: 'accepted' });
      const auth = await manager();
      const conflict = await post(`/v1/admin/orders/${id}/cancel`, auth, {
        expectedStatus: 'pending',
        reason: 'tarde',
      });
      expect(conflict.status).toBe(409);
      expect(json(conflict).code).toBe('ORDER_STATE_CONFLICT');
      expect(json(conflict).current).toEqual({
        status: 'accepted',
        updatedAt: repo.orders.get(id)?.updatedAt.toISOString(),
      });
      expect(conflict.headers['cache-control']).toBe('no-store');
      const ready = seed({ status: 'ready', fulfillmentType: 'DELIVERY' });
      const invalid = await post(`/v1/admin/orders/${ready}/complete`, auth, {
        expectedStatus: 'ready',
      });
      expect(invalid.status).toBe(422);
      expect(json(invalid)).toMatchObject({
        code: 'ORDER_TRANSITION_INVALID',
        violations: [{ code: 'ORDER_FULFILLMENT_MISMATCH' }],
        current: { status: 'ready' },
      });
      const source = await post(`/v1/admin/orders/${id}/accept`, auth, {
        expectedStatus: 'accepted',
      });
      expect(json(source)).toMatchObject({ violations: [{ code: 'ORDER_SOURCE_INVALID' }] });
      const terminal = seed({ status: 'cancelled' });
      expect(
        json(
          await post(`/v1/admin/orders/${terminal}/accept`, auth, { expectedStatus: 'cancelled' }),
        ),
      ).toMatchObject({ violations: [{ code: 'ORDER_TERMINAL' }] });
      expect(repo.audits).toHaveLength(0);
    });

    it('fila 20/21: doble clic => 200 replayed (UNA fila de historial); otra persona => appliedByMe=false', async () => {
      const id = seed();
      const first = await manager();
      const second = await manager();
      const a = await post(`/v1/admin/orders/${id}/accept`, first, { expectedStatus: 'pending' });
      const b = await post(`/v1/admin/orders/${id}/accept`, first, { expectedStatus: 'pending' });
      const c = await post(`/v1/admin/orders/${id}/accept`, second, { expectedStatus: 'pending' });
      expect((json(a)['transition'] as Body)['replayed']).toBe(false);
      expect(json(b)['transition']).toMatchObject({
        replayed: true,
        appliedByMe: true,
        at: (json(a)['transition'] as Body)['at'],
      });
      expect(json(c)['transition']).toMatchObject({ replayed: true, appliedByMe: false });
      expect(repo.eventsOf(id)).toHaveLength(2);
      expect(repo.audits).toHaveLength(1);
    });

    it('dos actores simultáneos (accept y reject): una 200 y la otra 409; estado coherente', async () => {
      const id = seed();
      const [x, y] = [await manager(), await manager()];
      const [r1, r2] = await Promise.all([
        post(`/v1/admin/orders/${id}/accept`, x, { expectedStatus: 'pending' }, '10.0.0.2'),
        post(
          `/v1/admin/orders/${id}/reject`,
          y,
          { expectedStatus: 'pending', reason: 'sin stock' },
          '10.0.0.3',
        ),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect(repo.eventsOf(id)).toHaveLength(2);
      expect(['accepted', 'rejected']).toContain(repo.orders.get(id)?.status);
      expect(repo.audits).toHaveLength(1);
    });

    it('rechazo con pago PAID real: pendingActions payment_review; con delivery activa del puerto: delivery_cancellation', async () => {
      const auth = await manager();
      const bank = seed();
      paymentsRepo.seedPaid(bank);
      const res = await post(`/v1/admin/orders/${bank}/reject`, auth, {
        expectedStatus: 'pending',
        reason: 'Sin existencias',
      });
      expect(json(res)['pendingActions']).toEqual(['payment_review']);
      fulfillment.result = { activeDelivery: true, pendingActions: ['delivery_cancellation'] };
      const own = seed({
        status: 'ready',
        fulfillmentType: 'DELIVERY',
        paymentMethodPreference: 'cash',
      });
      const res2 = await post(`/v1/admin/orders/${own}/cancel`, auth, {
        expectedStatus: 'ready',
        reason: 'Sin repartidor',
      });
      expect(json(res2)['pendingActions']).toEqual(['delivery_cancellation']);
    });

    it('fila 39: el estado queda visible en el detalle con historial y actor', async () => {
      const id = seed();
      const auth = await manager();
      await post(`/v1/admin/orders/${id}/accept`, auth, { expectedStatus: 'pending' });
      const d = json(await get(`/v1/admin/orders/${id}`, auth));
      expect((d['history'] as Body[]).map((h) => h['status'])).toEqual(['pending', 'accepted']);
      expect(d['status']).toBe('accepted');
    });
  });

  describe('filas 34, 36: gate y throttles', () => {
    it('gate saturado => 503 ORDERS_BUSY con Retry-After y no-store', async () => {
      await app.close();
      const gate = new DbGate(1, 0, 5_000, ordersBusy);
      app = await createApp(gate);
      let free!: () => void;
      const held = gate.run(() => new Promise<void>((resolve) => (free = resolve)));
      const auth = await manager();
      const id = seed();
      for (const res of [
        await get('/v1/admin/orders', auth),
        await post(`/v1/admin/orders/${id}/accept`, auth, { expectedStatus: 'pending' }),
      ]) {
        expect(res.status).toBe(503);
        expect(json(res).code).toBe('ORDERS_BUSY');
        expect(res.headers['retry-after']).toBe('2');
        expect(res.headers['cache-control']).toBe('no-store');
      }
      free();
      await held;
    });

    it('throttle de comandos: 60/min por actor => 429 RATE_LIMITED con Retry-After; las lecturas del mismo actor tienen contador propio', async () => {
      const auth = await manager();
      const id = seed();
      let last = 0;
      for (let i = 0; i < 61; i += 1) {
        const res = await post(`/v1/admin/orders/${id}/accept`, auth, {}, `10.9.0.${i % 200}`);
        last = res.status;
        if (i < 60) expect(res.status).toBe(400);
        else {
          expect(res.status).toBe(429);
          expect(json(res).code).toBe('RATE_LIMITED');
          expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
          expect(res.headers['cache-control']).toBe('no-store');
        }
      }
      expect(last).toBe(429);
      expect((await get('/v1/admin/orders', auth, '10.9.1.1')).status).toBe(200);
    });

    it('throttle de lectura: 90/min por actor => 429', async () => {
      const auth = await manager();
      for (let i = 0; i < 90; i += 1)
        expect((await get('/v1/admin/orders/board', auth, `10.8.0.${i % 200}`)).status).toBe(200);
      const res = await get('/v1/admin/orders/board', auth, '10.8.1.1');
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  it('fila 38: los logs de una solicitud con PII y motivo no contienen valores sembrados', async () => {
    const id = seed();
    const auth = await manager();
    await get(`/v1/admin/orders/${id}`, auth);
    await post(`/v1/admin/orders/${id}/reject`, auth, {
      expectedStatus: 'pending',
      reason: REASON,
    });
    await post(`/v1/admin/orders/${id}/reject`, auth, { expectedStatus: 'pending' });
    for (const line of logged)
      for (const leak of [REASON, PII_NAME, PII_PHONE, PII_NOTES]) expect(line).not.toContain(leak);
  });
});
