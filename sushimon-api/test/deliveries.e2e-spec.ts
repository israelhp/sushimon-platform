import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { deliveriesBusy } from '../src/deliveries/delivery-errors.js';
import { FakeActiveDeliveriesPort, FakeDeliveriesRepo } from './support/fake-deliveries-repo.js';
import { FakeRidersRepo } from './support/fake-riders-repo.js';
import { ROLE_PERMISSIONS } from './support/staff-context.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

/**
 * F28 (spec 029 §16, nivel E): entregas propias del backoffice con supertest sobre la app REAL (guards, pipes, filtro, throttles,
 * middleware y servicios reales) y repositorios en memoria. El SQL y los bloqueos se prueban contra PostgreSQL en
 * `test/deliveries.int-spec.ts`.
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
const CLIENT = 'CLIENTE-SECRETO';
const CLIENT_PHONE = '+50255559999';
const ADDRESS = 'DIRECCION-SECRETA';
const RIDER_NAME = 'NOMBRE-RIDER-SECRETO';
const RIDER_PHONE = '+50255501122';
const PLATE = 'PLACA9X7';
/** Datos del CLIENTE (el nombre del motorista sí puede aparecer en una entrega). */
const CLIENT_PII = /CLIENTE-SECRETO|DIRECCION-SECRETA|REFERENCIA-SECRETA|\+50255559999/;

interface Assignment {
  branchId: string | null;
  permissions: string[];
}
type Body = Record<string, unknown>;
const json = (res: request.Response) =>
  res.body as Body & {
    code?: string;
    current?: { status: string; version?: number };
    message?: string;
    details?: string[];
    violations?: { code: string; path: string }[];
    delivery?: Body & { id: string; version: number; status: string };
    transition?: Body;
  };

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

async function buildApp(
  keys: TestKeys,
  staffRows: Map<string, ReturnType<typeof staffRow>>,
  opts: {
    repo?: FakeDeliveriesRepo;
    riders?: FakeRidersRepo;
    port?: FakeActiveDeliveriesPort;
    gate?: DbGate;
    real?: boolean;
  } = {},
) {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
    RATE_LIMIT_MAX: '1000',
    MEDIA_STORAGE_ADAPTER: 'mock',
  });
  const { vi: _vi } = { vi };
  void _vi;
  vi.resetModules();
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
  const { DeliveriesRepository } = await import('../src/deliveries/deliveries.repository.js');
  const { DELIVERIES_DB_GATE } = await import('../src/deliveries/delivery-errors.js');
  const { AdminOrdersRepository } = await import('../src/orders/admin/admin-orders.repository.js');
  const { RidersRepository } = await import('../src/riders/riders.repository.js');
  const { RIDER_ACTIVE_DELIVERIES_PORT } =
    await import('../src/riders/ports/rider-active-deliveries.port.js');
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
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
    $disconnect: () => Promise.resolve(),
  };
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks);
  if (!opts.real && opts.repo && opts.riders && opts.port) {
    builder = builder
      .overrideProvider(DeliveriesRepository)
      .useValue(opts.repo.asRepository())
      .overrideProvider(AdminOrdersRepository)
      .useValue(opts.repo.ordersRepository())
      .overrideProvider(RidersRepository)
      .useValue(opts.riders)
      .overrideProvider(RIDER_ACTIVE_DELIVERIES_PORT)
      .useValue(opts.port);
  }
  if (opts.gate) builder = builder.overrideProvider(DELIVERIES_DB_GATE).useValue(opts.gate);
  const moduleRef = await builder.compile();
  const instance = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(instance, { corsOrigins: ['http://localhost:3000'], trustProxyHops: 1 });
  await instance.init();
  return { app: instance, moduleRef, db };
}

describe('Entregas propias del backoffice (e2e, F28)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let repo: FakeDeliveriesRepo;
  let riders: FakeRidersRepo;
  let port: FakeActiveDeliveriesPort;
  let staffRows: Map<string, ReturnType<typeof staffRow>>;
  let logged: string[];
  let A: string;
  let B: string;
  const http = () => request(app.getHttpServer());

  const actorIds = new Map<string, string>();
  const actor = async (assignments: Assignment[], claims: Record<string, unknown> = AAL2) => {
    const id = randomUUID();
    staffRows.set(id, staffRow(id, assignments));
    const auth = `Bearer ${await keys.sign({ sub: id, ...claims })}`;
    actorIds.set(auth, id);
    return auth;
  };
  const admin = (claims?: Record<string, unknown>) =>
    actor([{ branchId: null, permissions: ROLE_PERMISSIONS['admin'] as string[] }], claims);
  const managerAt = (b: string) =>
    actor([{ branchId: b, permissions: ROLE_PERMISSIONS['manager'] as string[] }]);
  const readerAt = (b: string) =>
    actor([{ branchId: b, permissions: ROLE_PERMISSIONS['staff'] as string[] }]);
  const ip = (n = 1) => `10.0.0.${n}`;
  const get = (path: string, auth: string, addr = ip()) =>
    http().get(path).set('Authorization', auth).set('X-Forwarded-For', addr);
  const post = (path: string, auth: string, body: Body, addr = ip()) =>
    http().post(path).set('Authorization', auth).set('X-Forwarded-For', addr).send(body);
  const URL = '/v1/admin/deliveries';

  const order = (over: Record<string, unknown> = {}) => repo.seedOrder({ branchId: A, ...over });
  const rider = (over: Record<string, unknown> = {}) =>
    riders.seed({
      branchId: A,
      fullName: RIDER_NAME,
      phone: RIDER_PHONE,
      licensePlate: PLATE,
      availability: 'AVAILABLE',
      ...over,
      ...(over['phone'] ? {} : { phone: `+502${String(50000000 + riders.riders.size)}` }),
    });
  const make = async (auth: string, over: Record<string, unknown> = {}) => {
    const o = order(over);
    const res = await post(URL, auth, { orderId: o.id });
    return {
      order: o,
      res,
      id: json(res).delivery?.id ?? '',
      version: json(res).delivery?.version ?? 0,
    };
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
    riders = new FakeRidersRepo();
    repo = new FakeDeliveriesRepo(riders);
    port = repo.port();
    A = repo.addBranch('Centro');
    B = repo.addBranch('Zona 10');
    for (const [id, name] of [
      [A, 'Centro'],
      [B, 'Zona 10'],
    ] as const) {
      riders.branches.set(id, { name, active: true });
      riders.ownDelivery.set(id, true);
    }
    ({ app } = await buildApp(keys, staffRows, { repo, riders, port }));
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('R23 autenticación, MFA y permisos por ruta', () => {
    const routes: [string, (auth?: string) => request.Test][] = [
      ['GET list', (a) => (a ? get(URL, a) : http().get(URL))],
      ['GET detail', (a) => (a ? get(`${URL}/${MISSING}`, a) : http().get(`${URL}/${MISSING}`))],
      ['POST create', (a) => withAuth(http().post(URL), a).send({ orderId: MISSING })],
      ...(
        [
          ['assign-own-rider', { riderId: MISSING, expectedVersion: 1 }],
          ['unassign-rider', { expectedVersion: 1 }],
          ['mark-picked-up', { expectedVersion: 1 }],
          ['mark-delivered', { expectedVersion: 1 }],
          ['return-to-branch', { expectedVersion: 1 }],
          ['cancel', { expectedVersion: 1, reason: 'motivo uno' }],
        ] as [string, Body][]
      ).map(([route, body]): [string, (auth?: string) => request.Test] => [
        `POST ${route}`,
        (a) => withAuth(http().post(`${URL}/${MISSING}/${route}`), a).send(body),
      ]),
    ];
    function withAuth(r: request.Test, a?: string): request.Test {
      return a ? r.set('Authorization', a) : r;
    }

    it.each(routes)(
      '%s: sin token 401; JWT ajeno 401; cliente 403; aal1 => 403 MFA_REQUIRED; todos `private, no-store`',
      async (_name, call) => {
        const none = await call();
        expect(none.status).toBe(401);
        expect(none.headers['cache-control']).toBe('private, no-store');
        const forged = await call(`Bearer ${await keys.signWithForeignKey({ sub: randomUUID() })}`);
        expect(forged.status).toBe(401);
        const customer = await call(`Bearer ${await keys.sign({ sub: randomUUID() })}`);
        expect(customer.status).toBe(403);
        expect(customer.headers['cache-control']).toBe('private, no-store');
        const aal1 = await call(await admin(AAL1));
        expect(aal1.status).toBe(403);
        expect(json(aal1).message).toBe('MFA_REQUIRED');
        expect(aal1.headers['cache-control']).toBe('private, no-store');
      },
    );

    it('`kitchen` no tiene ningún permiso de entregas: 403 genérico en lectura y comandos', async () => {
      const kitchen = await actor([
        { branchId: A, permissions: ROLE_PERMISSIONS['kitchen'] as string[] },
      ]);
      const d = repo.seedDelivery({ orderId: order().id });
      for (const res of [
        await get(URL, kitchen),
        await get(`${URL}/${d.id}`, kitchen),
        await post(URL, kitchen, { orderId: order().id }),
        await post(`${URL}/${d.id}/cancel`, kitchen, { expectedVersion: 1, reason: 'motivo uno' }),
      ]) {
        expect(res.status).toBe(403);
        expect(json(res).code).toBeUndefined();
      }
      expect(repo.deliveries.get(d.id)?.status).toBe('pending');
    });

    it('`staff` (solo deliveries.read) ve la lista y el detalle pero NO actúa: 403 en todos los comandos', async () => {
      const auth = await readerAt(A);
      const d = repo.seedDelivery({ orderId: order().id });
      expect((await get(URL, auth)).status).toBe(200);
      expect((await get(`${URL}/${d.id}`, auth)).status).toBe(200);
      for (const res of [
        await post(URL, auth, { orderId: order().id }),
        await post(`${URL}/${d.id}/assign-own-rider`, auth, {
          riderId: rider().id,
          expectedVersion: 1,
        }),
        await post(`${URL}/${d.id}/unassign-rider`, auth, { expectedVersion: 1 }),
        await post(`${URL}/${d.id}/mark-picked-up`, auth, { expectedVersion: 1 }),
        await post(`${URL}/${d.id}/mark-delivered`, auth, { expectedVersion: 1 }),
        await post(`${URL}/${d.id}/return-to-branch`, auth, { expectedVersion: 1 }),
        await post(`${URL}/${d.id}/cancel`, auth, { expectedVersion: 1, reason: 'motivo uno' }),
      ]) {
        expect(res.status).toBe(403);
      }
      expect(repo.deliveries.get(d.id)).toMatchObject({ status: 'pending', version: 1 });
      expect(repo.history).toHaveLength(1);
    });

    it('asignar sin riders.assign => 403 aunque tenga deliveries.assign (permisos del backoffice, no del rol)', async () => {
      const auth = await actor([
        { branchId: A, permissions: ['deliveries.read', 'deliveries.assign', 'riders.read'] },
      ]);
      const d = repo.seedDelivery({ orderId: order().id });
      const res = await post(`${URL}/${d.id}/assign-own-rider`, auth, {
        riderId: rider().id,
        expectedVersion: 1,
      });
      expect(res.status).toBe(403);
      expect(repo.deliveries.get(d.id)?.status).toBe('pending');
    });

    it('permiso por sucursal: lee A pero actúa solo en B => 403 DELIVERY_ACTION_FORBIDDEN en A', async () => {
      const auth = await actor([
        { branchId: A, permissions: ['deliveries.read'] },
        { branchId: B, permissions: ['deliveries.read', 'deliveries.update', 'deliveries.assign'] },
      ]);
      const d = repo.seedDelivery({ orderId: order().id });
      const res = await post(`${URL}/${d.id}/cancel`, auth, {
        expectedVersion: 1,
        reason: 'motivo uno',
      });
      expect(res.status).toBe(403);
      expect(json(res).code).toBe('DELIVERY_ACTION_FORBIDDEN');
      const create = await post(URL, auth, { orderId: order().id });
      expect(json(create).code).toBe('DELIVERY_ACTION_FORBIDDEN');
    });
  });

  describe('validación de la forma (400)', () => {
    it.each([
      ['orderId no UUID', { orderId: 'x' }],
      ['sin orderId', {}],
      ['campo desconocido', { orderId: MISSING, status: 'assigned' }],
      ['riderId en crear', { orderId: MISSING, riderId: MISSING }],
    ])('crear: %s => 400', async (_n, body) => {
      const res = await post(URL, await admin(), body);
      expect(res.status).toBe(400);
      expect(repo.deliveries.size).toBe(0);
    });

    it.each([
      ['assign-own-rider', 'sin expectedVersion', { riderId: MISSING }],
      ['assign-own-rider', 'sin riderId', { expectedVersion: 1 }],
      ['assign-own-rider', 'riderId no UUID', { riderId: 'x', expectedVersion: 1 }],
      [
        'assign-own-rider',
        'riderBranchId (campo prohibido)',
        {
          riderId: MISSING,
          expectedVersion: 1,
          riderBranchId: 'b0000000-0000-4000-8000-000000000001',
        },
      ],
      ['assign-own-rider', 'version 0', { riderId: MISSING, expectedVersion: 0 }],
      ['assign-own-rider', 'version decimal', { riderId: MISSING, expectedVersion: 1.5 }],
      ['assign-own-rider', 'version texto', { riderId: MISSING, expectedVersion: '1' }],
      ['unassign-rider', 'sin expectedVersion', {}],
      ['unassign-rider', 'reason no cadena', { expectedVersion: 1, reason: 5 }],
      ['mark-picked-up', 'sin expectedVersion', {}],
      ['mark-picked-up', 'campo desconocido', { expectedVersion: 1, status: 'picked_up' }],
      ['mark-delivered', 'version enorme', { expectedVersion: 2_147_483_648 }],
      ['return-to-branch', 'sin expectedVersion', {}],
      ['cancel', 'sin expectedVersion', { reason: 'motivo uno' }],
      ['cancel', 'reason no cadena', { expectedVersion: 1, reason: ['x'] }],
    ])('%s: %s => 400', async (route, _n, body) => {
      const d = repo.seedDelivery({ orderId: order().id });
      const res = await post(`${URL}/${d.id}/${route}`, await admin(), body);
      expect(res.status).toBe(400);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(repo.deliveries.get(d.id)).toMatchObject({ status: 'pending', version: 1 });
    });

    it('cancel sin motivo / corto / con control => 400 DELIVERY_REASON_REQUIRED; unassign con motivo inválido también', async () => {
      const auth = await admin();
      const d = repo.seedDelivery({ orderId: order().id });
      for (const reason of [undefined, '', '  ', 'ab', 'x'.repeat(281), 'a\u0000b']) {
        const res = await post(`${URL}/${d.id}/cancel`, auth, { expectedVersion: 1, reason });
        expect([res.status, json(res).code]).toEqual([400, 'DELIVERY_REASON_REQUIRED']);
      }
      const a = repo.seedDelivery({ orderId: order().id, status: 'assigned', riderId: rider().id });
      const res = await post(`${URL}/${a.id}/unassign-rider`, auth, {
        expectedVersion: 1,
        reason: 'ab',
      });
      expect([res.status, json(res).code]).toEqual([400, 'DELIVERY_REASON_REQUIRED']);
    });

    it('identificador de ruta no UUID => 400 en detalle y en TODOS los comandos', async () => {
      const auth = await admin();
      expect((await get(`${URL}/no-uuid`, auth)).status).toBe(400);
      for (const route of [
        'assign-own-rider',
        'unassign-rider',
        'mark-picked-up',
        'mark-delivered',
        'return-to-branch',
        'cancel',
      ]) {
        const res = await post(`${URL}/no-uuid/${route}`, auth, {
          expectedVersion: 1,
          riderId: MISSING,
          reason: 'motivo uno',
        });
        expect(res.status).toBe(400);
      }
    });

    it.each([
      'limit=101',
      'limit=0',
      'limit=x',
      'status=pending,otro',
      'status=pending,pending',
      'status=a,b,c,d,e,f,g',
      'riderId=x',
      'branchId=x',
      'from=ayer',
      'from=2026-11-01T00:00:00',
      `cursor=${'a'.repeat(201)}`,
      'foo=1',
    ])('listado: ?%s => 400', async (qs) => {
      expect((await get(`${URL}?${qs}`, await admin())).status).toBe(400);
    });

    it('listado: rango a > 92 días => 400; to <= from => 400; cursor alterado => 400 DELIVERY_CURSOR_INVALID', async () => {
      const auth = await admin();
      const wide = await get(`${URL}?from=2026-01-01T00:00:00Z&to=2026-11-01T00:00:00Z`, auth);
      expect(wide.status).toBe(400);
      expect(
        (await get(`${URL}?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z`, auth)).status,
      ).toBe(400);
      const bad = await get(`${URL}?cursor=basura`, auth);
      expect([bad.status, json(bad).code]).toEqual([400, 'DELIVERY_CURSOR_INVALID']);
    });
  });

  describe('R03 R04 R05 crear y reabrir', () => {
    it('201 al crear (sin PII en cuerpo ni auditoría) y 200 `replayed` al repetir; reabrir => 201', async () => {
      const auth = await admin();
      const o = order({ status: 'accepted' });
      const first = await post(URL, auth, { orderId: o.id });
      expect(first.status).toBe(201);
      expect(first.headers['cache-control']).toBe('private, no-store');
      expect(first.body).toMatchObject({
        delivery: {
          orderId: o.id,
          status: 'pending',
          version: 1,
          rider: null,
          orderStatus: 'accepted',
        },
        transition: {
          from: null,
          to: 'pending',
          event: 'created',
          replayed: false,
          appliedByMe: true,
        },
      });
      const again = await post(URL, auth, { orderId: o.id });
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({
        transition: { replayed: true },
        delivery: { id: json(first).delivery?.id },
      });
      expect(repo.deliveries.size).toBe(1);
      expect(repo.audits).toHaveLength(1);
      expect(JSON.stringify([first.body, repo.audits])).not.toMatch(CLIENT_PII);
      const id = json(first).delivery?.id;
      await post(`${URL}/${id}/cancel`, auth, { expectedVersion: 1, reason: 'cliente canceló' });
      const reopened = await post(URL, auth, { orderId: o.id });
      expect(reopened.status).toBe(201);
      expect(reopened.body).toMatchObject({
        transition: { event: 'reopened', from: 'cancelled', replayed: false },
      });
    });

    it.each([
      ['PICKUP', { fulfillmentType: 'PICKUP' }, 'ORDER_NOT_DELIVERY'],
      ['PEDIDOSYA', { deliveryProvider: 'PEDIDOSYA' }, 'ORDER_PROVIDER_NOT_OWN'],
      ['pending', { status: 'pending' }, 'ORDER_STATUS_NOT_DISPATCHABLE'],
      ['terminal', { status: 'cancelled' }, 'ORDER_STATUS_NOT_DISPATCHABLE'],
      ['on_the_way', { status: 'on_the_way' }, 'ORDER_STATUS_NOT_DISPATCHABLE'],
    ])(
      'pedido %s => 422 DELIVERY_ORDER_NOT_ELIGIBLE (%s) y NUNCA crea fila',
      async (_n, over, code) => {
        const res = await post(URL, await admin(), { orderId: order(over).id });
        expect([res.status, json(res).code, json(res).violations?.[0]?.code]).toEqual([
          422,
          'DELIVERY_ORDER_NOT_ELIGIBLE',
          code,
        ]);
        expect(res.headers['cache-control']).toBe('private, no-store');
        expect(repo.deliveries.size).toBe(0);
        expect(repo.history).toHaveLength(0);
        expect(repo.audits).toHaveLength(0);
      },
    );

    it('returned => 409 DELIVERY_STATE_CONFLICT con current; pedido ajeno o inexistente => el MISMO 404 ORDER_NOT_FOUND', async () => {
      const auth = await admin();
      const done = order({ status: 'delivered' });
      repo.seedDelivery({ orderId: done.id, status: 'returned', riderId: rider().id });
      const r = await post(URL, auth, { orderId: done.id });
      expect([r.status, json(r).code, json(r).current?.status]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        'returned',
      ]);
      const mgr = await managerAt(A);
      const theirs = await post(URL, mgr, { orderId: order({ branchId: B }).id });
      const ghost = await post(URL, mgr, { orderId: MISSING });
      expect([theirs.status, json(theirs).code]).toEqual([404, 'ORDER_NOT_FOUND']);
      expect(theirs.body).toEqual({
        ...(ghost.body as Body),
        requestId: (theirs.body as Body)['requestId'],
      });
    });
  });

  describe('flujo completo: crear → asignar → recoger → entregar → retorno', () => {
    it('cada paso responde 200 con el estado, la transición y las acciones disponibles; el motorista se libera SOLO al retorno', async () => {
      const auth = await admin();
      const r = rider();
      const created = await make(auth);
      expect(created.res.status).toBe(201);
      let { id, version } = created;

      const assign = await post(`${URL}/${id}/assign-own-rider`, auth, {
        riderId: r.id,
        expectedVersion: version,
      });
      expect(assign.status).toBe(200);
      expect(assign.body).toMatchObject({
        delivery: {
          status: 'assigned',
          riderOccupied: true,
          rider: { id: r.id, fullName: RIDER_NAME, vehicleType: 'MOTORCYCLE' },
        },
        transition: { from: 'pending', to: 'assigned', event: 'rider_assigned', replayed: false },
      });
      version = json(assign).delivery?.version ?? 0;
      expect(
        (
          (assign.body as Body)['delivery'] as { availableActions: { action: string }[] }
        ).availableActions.map((a) => a.action),
      ).toEqual(['reassign_rider', 'unassign_rider', 'mark_picked_up', 'cancel']);

      const pick = await post(`${URL}/${id}/mark-picked-up`, auth, { expectedVersion: version });
      expect(pick.status).toBe(200);
      expect(pick.body).toMatchObject({
        delivery: { status: 'picked_up', orderStatus: 'on_the_way' },
      });
      version = json(pick).delivery?.version ?? 0;
      expect(repo.orders.get(created.order.id)?.status).toBe('on_the_way');

      const done = await post(`${URL}/${id}/mark-delivered`, auth, { expectedVersion: version });
      expect(done.body).toMatchObject({
        delivery: {
          status: 'delivered',
          orderStatus: 'delivered',
          awaitingReturn: true,
          riderOccupied: true,
        },
      });
      version = json(done).delivery?.version ?? 0;
      expect((await port.findBusy({ riderIds: [r.id] })).busyIds.has(r.id)).toBe(true);

      const back = await post(`${URL}/${id}/return-to-branch`, auth, { expectedVersion: version });
      expect(back.body).toMatchObject({
        delivery: {
          status: 'returned',
          riderOccupied: false,
          awaitingReturn: false,
          availableActions: [],
        },
        transition: { from: 'delivered', to: 'returned', event: 'returned' },
      });
      expect((await port.findBusy({ riderIds: [r.id] })).busyIds.size).toBe(0);
      id = '';
      expect(repo.audits.map((a) => a.action)).toEqual([
        'delivery.created',
        'delivery.rider_assigned',
        'order.dispatched',
        'delivery.picked_up',
        'order.delivered',
        'delivery.delivered',
        'delivery.returned',
      ]);
      expect(repo.orderHistory.map((h) => h.newStatus)).toEqual(['on_the_way', 'delivered']);
    });
  });

  describe('R07 R10 R11 R17 códigos y repeticiones por HTTP', () => {
    it.each([
      ['INACTIVE', { active: false }],
      ['UNAVAILABLE', { availability: 'UNAVAILABLE' }],
    ])(
      'motorista %s => 422 RIDER_NOT_ELIGIBLE sin sucursal ni datos del motorista',
      async (code, over) => {
        const auth = await admin();
        const r = rider(over);
        const c = await make(auth);
        const res = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
          riderId: r.id,
          expectedVersion: c.version,
        });
        expect([res.status, json(res).code, json(res).violations?.map((v) => v.code)]).toEqual([
          422,
          'RIDER_NOT_ELIGIBLE',
          [code],
        ]);
        const raw = JSON.stringify(res.body);
        for (const secret of [A, B, RIDER_NAME, RIDER_PHONE, PLATE, 'riderBranchId'])
          expect(raw).not.toContain(secret);
      },
    );

    it('WRONG_BRANCH y OWN_DELIVERY_DISABLED y BUSY', async () => {
      const auth = await admin();
      const c = await make(auth);
      const far = rider({ branchId: B });
      const wrong = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
        riderId: far.id,
        expectedVersion: c.version,
      });
      expect(json(wrong).violations?.map((v) => v.code)).toEqual(['WRONG_BRANCH']);
      expect(JSON.stringify(wrong.body)).not.toContain(B);
      riders.ownDelivery.set(A, false);
      const off = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
        riderId: rider().id,
        expectedVersion: c.version,
      });
      expect(json(off).violations?.map((v) => v.code)).toEqual(['OWN_DELIVERY_DISABLED']);
      riders.ownDelivery.set(A, true);
      const busy = rider();
      const first = await make(auth);
      await post(`${URL}/${first.id}/assign-own-rider`, auth, {
        riderId: busy.id,
        expectedVersion: first.version,
      });
      const second = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
        riderId: busy.id,
        expectedVersion: c.version,
      });
      expect(json(second).violations?.map((v) => v.code)).toEqual(['BUSY']);
    });

    it('R08 doble asignación del mismo motorista en paralelo: una 200 y la otra 422 BUSY', async () => {
      const auth = await admin();
      const r = rider();
      const c1 = await make(auth);
      const c2 = await make(auth);
      const [x, y] = await Promise.all([
        post(
          `${URL}/${c1.id}/assign-own-rider`,
          auth,
          { riderId: r.id, expectedVersion: c1.version },
          ip(2),
        ),
        post(
          `${URL}/${c2.id}/assign-own-rider`,
          auth,
          { riderId: r.id, expectedVersion: c2.version },
          ip(3),
        ),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 422]);
      const loser = x.status === 422 ? x : y;
      expect(json(loser).violations?.map((v) => v.code)).toEqual(['BUSY']);
    });

    it('motorista inexistente o de otra sucursal sin permiso => el MISMO 404 RIDER_NOT_FOUND', async () => {
      const mgr = await managerAt(A);
      const c = await make(mgr);
      const far = rider({ branchId: B });
      const a = await post(`${URL}/${c.id}/assign-own-rider`, mgr, {
        riderId: far.id,
        expectedVersion: c.version,
      });
      const b = await post(`${URL}/${c.id}/assign-own-rider`, mgr, {
        riderId: MISSING,
        expectedVersion: c.version,
      });
      expect([a.status, json(a).code]).toEqual([404, 'RIDER_NOT_FOUND']);
      expect({ ...(a.body as Body), requestId: 0 }).toEqual({ ...(b.body as Body), requestId: 0 });
    });

    it('R11 repetir la asignación => 200 replayed sin duplicar; R10 reasignar y 409 si ya se recogió', async () => {
      const auth = await admin();
      const r = rider();
      const c = await make(auth);
      const body = { riderId: r.id, expectedVersion: c.version };
      expect((await post(`${URL}/${c.id}/assign-own-rider`, auth, body)).status).toBe(200);
      const again = await post(`${URL}/${c.id}/assign-own-rider`, auth, body);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ transition: { replayed: true, appliedByMe: true } });
      expect(repo.history).toHaveLength(2);
      const r2 = rider();
      const re = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
        riderId: r2.id,
        expectedVersion: c.version + 1,
      });
      expect(re.body).toMatchObject({
        transition: { event: 'rider_reassigned' },
        delivery: { rider: { id: r2.id } },
      });
      const v = json(re).delivery?.version ?? 0;
      const pick = await post(`${URL}/${c.id}/mark-picked-up`, auth, { expectedVersion: v });
      const late = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
        riderId: r.id,
        expectedVersion: json(pick).delivery?.version,
      });
      expect([late.status, json(late).code, json(late).current?.status]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        'picked_up',
      ]);
    });

    it('R17 repetir cada comando => 200 replayed sin historial ni auditoría nueva', async () => {
      const auth = await admin();
      const c = await make(auth);
      const r = rider();
      const a = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
        riderId: r.id,
        expectedVersion: c.version,
      });
      let v = json(a).delivery?.version ?? 0;
      const flow: [string, Body][] = [
        ['mark-picked-up', {}],
        ['mark-delivered', {}],
        ['return-to-branch', {}],
      ];
      for (const [route, extra] of flow) {
        const first = await post(`${URL}/${c.id}/${route}`, auth, { expectedVersion: v, ...extra });
        expect(first.status).toBe(200);
        const history = repo.history.length;
        const audits = repo.audits.length;
        const dup = await post(`${URL}/${c.id}/${route}`, auth, { expectedVersion: v, ...extra });
        expect(dup.status).toBe(200);
        expect(dup.body).toMatchObject({ transition: { replayed: true, appliedByMe: true } });
        expect(repo.history).toHaveLength(history);
        expect(repo.audits).toHaveLength(audits);
        v = json(first).delivery?.version ?? 0;
      }
    });

    it('409 DELIVERY_STATE_CONFLICT con current (versión vieja) y ORDER_STATE_CONFLICT con el estado del pedido; PEDIDOSYA => 422', async () => {
      const auth = await admin();
      const r = rider();
      const c = await make(auth, { status: 'preparing' });
      const a = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
        riderId: r.id,
        expectedVersion: c.version,
      });
      const v = json(a).delivery?.version ?? 0;
      const stale = await post(`${URL}/${c.id}/mark-picked-up`, auth, { expectedVersion: 1 });
      expect([stale.status, json(stale).code, json(stale).current]).toEqual([
        409,
        'DELIVERY_STATE_CONFLICT',
        { status: 'assigned', version: v },
      ]);
      const notReady = await post(`${URL}/${c.id}/mark-picked-up`, auth, { expectedVersion: v });
      expect([notReady.status, json(notReady).code, json(notReady).current?.status]).toEqual([
        409,
        'ORDER_STATE_CONFLICT',
        'preparing',
      ]);
      expect(repo.deliveries.get(c.id)?.status).toBe('assigned');
      const py = order({ deliveryProvider: 'PEDIDOSYA' });
      const d = repo.seedDelivery({ orderId: py.id, status: 'assigned', riderId: rider().id });
      const blocked = await post(`${URL}/${d.id}/mark-picked-up`, auth, { expectedVersion: 1 });
      expect([blocked.status, json(blocked).code]).toEqual([422, 'ORDER_TRANSITION_INVALID']);
      expect(repo.orders.get(py.id)?.status).toBe('ready');
    });

    it('R20 cancelar: pending|assigned con motivo; desde picked_up => 409', async () => {
      const auth = await admin();
      const r = rider();
      const c = await make(auth);
      const a = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
        riderId: r.id,
        expectedVersion: c.version,
      });
      const v = json(a).delivery?.version ?? 0;
      const ok = await post(`${URL}/${c.id}/cancel`, auth, {
        expectedVersion: v,
        reason: ' cliente canceló ',
      });
      expect(ok.body).toMatchObject({
        delivery: { status: 'cancelled', rider: null, availableActions: [] },
      });
      expect(repo.eventsOf(c.id).at(-1)).toMatchObject({
        event: 'cancelled',
        reason: 'cliente canceló',
      });
      expect(repo.orders.get(c.order.id)?.status).toBe('ready');
      const c2 = await make(auth);
      const a2 = await post(`${URL}/${c2.id}/assign-own-rider`, auth, {
        riderId: r.id,
        expectedVersion: c2.version,
      });
      const p = await post(`${URL}/${c2.id}/mark-picked-up`, auth, {
        expectedVersion: json(a2).delivery?.version,
      });
      const late = await post(`${URL}/${c2.id}/cancel`, auth, {
        expectedVersion: json(p).delivery?.version,
        reason: 'motivo uno',
      });
      expect([late.status, json(late).code]).toEqual([409, 'DELIVERY_STATE_CONFLICT']);
    });

    it('R19 un fallo de auditoría revierte entrega Y pedido (500 genérico)', async () => {
      const auth = await admin();
      const r = rider();
      const c = await make(auth);
      const a = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
        riderId: r.id,
        expectedVersion: c.version,
      });
      repo.failAudit = true;
      const res = await post(`${URL}/${c.id}/mark-picked-up`, auth, {
        expectedVersion: json(a).delivery?.version,
      });
      expect(res.status).toBe(500);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(repo.deliveries.get(c.id)?.status).toBe('assigned');
      expect(repo.orders.get(c.order.id)?.status).toBe('ready');
    });
  });

  describe('R24 alcance por sucursal (404 uniforme, anti-IDOR)', () => {
    it('detalle y TODOS los comandos de una entrega ajena o inexistente responden el MISMO 404 DELIVERY_NOT_FOUND', async () => {
      const mgr = await managerAt(A);
      const theirs = repo.seedDelivery({ orderId: order({ branchId: B }).id });
      const calls = (id: string): [string, () => request.Test][] => [
        ['detail', () => get(`${URL}/${id}`, mgr)],
        [
          'assign',
          () =>
            post(`${URL}/${id}/assign-own-rider`, mgr, { riderId: MISSING, expectedVersion: 1 }),
        ],
        ['unassign', () => post(`${URL}/${id}/unassign-rider`, mgr, { expectedVersion: 1 })],
        ['pick', () => post(`${URL}/${id}/mark-picked-up`, mgr, { expectedVersion: 1 })],
        ['deliver', () => post(`${URL}/${id}/mark-delivered`, mgr, { expectedVersion: 1 })],
        ['return', () => post(`${URL}/${id}/return-to-branch`, mgr, { expectedVersion: 1 })],
        [
          'cancel',
          () => post(`${URL}/${id}/cancel`, mgr, { expectedVersion: 1, reason: 'motivo uno' }),
        ],
      ];
      for (const [name, call] of calls(theirs.id)) {
        const foreign = await call();
        const missing = await calls(MISSING).find(([n]) => n === name)?.[1]();
        expect([name, foreign.status, json(foreign).code]).toEqual([
          name,
          404,
          'DELIVERY_NOT_FOUND',
        ]);
        const strip = (res?: request.Response) => ({ ...(res?.body as Body), requestId: 0 });
        expect(strip(foreign)).toEqual(strip(missing));
        expect(foreign.headers['cache-control']).toBe('private, no-store');
      }
      expect(repo.deliveries.get(theirs.id)).toMatchObject({ status: 'pending', version: 1 });
    });

    it('el listado nunca devuelve filas ajenas; branchId ajeno => 404 BRANCH_NOT_FOUND; global con sucursal inexistente => 404', async () => {
      const mgr = await managerAt(A);
      const mine = repo.seedDelivery({ orderId: order().id });
      repo.seedDelivery({ orderId: order({ branchId: B }).id });
      const list = await get(URL, mgr);
      expect((list.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([mine.id]);
      const foreign = await get(`${URL}?branchId=${B}`, mgr);
      expect([foreign.status, json(foreign).code]).toEqual([404, 'BRANCH_NOT_FOUND']);
      const ghost = await get(`${URL}?branchId=${MISSING}`, await admin());
      expect([ghost.status, json(ghost).code]).toEqual([404, 'BRANCH_NOT_FOUND']);
      expect((await get(`${URL}?branchId=${B}`, await admin())).status).toBe(200);
    });

    it('un manager de A no asigna un motorista de B (404 RIDER_NOT_FOUND, sin revelar su sucursal)', async () => {
      const mgr = await managerAt(A);
      const c = await make(mgr);
      const far = rider({ branchId: B });
      const res = await post(`${URL}/${c.id}/assign-own-rider`, mgr, {
        riderId: far.id,
        expectedVersion: c.version,
      });
      expect([res.status, json(res).code]).toEqual([404, 'RIDER_NOT_FOUND']);
      expect(JSON.stringify(res.body)).not.toContain(B);
    });
  });

  describe('R25 R36 PII, listado y detalle', () => {
    it('listado: sin teléfono ni dirección del cliente, sin placa/teléfono completo/sucursal del motorista; paginación por cursor', async () => {
      const auth = await admin();
      const r = rider();
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const d = repo.seedDelivery({
          orderId: order().id,
          status: 'assigned',
          riderId: i === 0 ? r.id : rider().id,
        });
        ids.push(d.id);
      }
      const p1 = await get(`${URL}?limit=2`, auth);
      expect(p1.status).toBe(200);
      expect(p1.headers['cache-control']).toBe('private, no-store');
      const raw = JSON.stringify(p1.body);
      for (const secret of [CLIENT, CLIENT_PHONE, ADDRESS, RIDER_PHONE, PLATE])
        expect(raw).not.toContain(secret);
      const body1 = p1.body as { items: { id: string; rider: Body }[]; nextCursor: string };
      expect(body1.items).toHaveLength(2);
      expect(body1.items[0]?.rider).toHaveProperty('phoneMasked');
      expect(body1.items[0]?.rider).not.toHaveProperty('branchId');
      const p2 = await get(`${URL}?limit=2&cursor=${body1.nextCursor}`, auth);
      const body2 = p2.body as { items: { id: string }[]; nextCursor: string | null };
      expect([...body1.items, ...body2.items].map((i) => i.id)).toEqual([...ids].reverse());
      expect(body2.nextCursor).toBeNull();
      // cursor de otra consulta => 400
      expect(
        (await get(`${URL}?limit=2&status=delivered&cursor=${body1.nextCursor}`, auth)).status,
      ).toBe(400);
      expect((await get(`${URL}?status=cancelled`, auth)).body).toMatchObject({
        items: [],
        nextCursor: null,
      });
    });

    it('detalle: contacto y dirección SOLO si abierta y orders.read; motorista enmascarado; historial', async () => {
      const auth = await admin();
      const r = rider();
      const d = repo.seedDelivery({ orderId: order().id, status: 'assigned', riderId: r.id });
      const res = await get(`${URL}/${d.id}`, auth);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toMatchObject({
        contactVisible: true,
        customer: { name: CLIENT, phone: CLIENT_PHONE },
        address: { addressLine: expect.stringContaining(ADDRESS) as string },
        rider: { id: r.id, fullName: RIDER_NAME },
        historyTruncated: false,
      });
      const raw = JSON.stringify(res.body);
      for (const secret of [RIDER_PHONE, PLATE]) expect(raw).not.toContain(secret);
      expect(((res.body as Body)['history'] as unknown[]).length).toBeGreaterThan(0);

      const noOrders = await actor([{ branchId: A, permissions: ['deliveries.read'] }]);
      const hidden = await get(`${URL}/${d.id}`, noOrders);
      expect(hidden.body).toMatchObject({ contactVisible: false, customer: null, address: null });
      expect(JSON.stringify(hidden.body)).not.toMatch(CLIENT_PII);

      for (const status of ['returned', 'cancelled'] as const) {
        const done = repo.seedDelivery({
          orderId: order().id,
          status,
          riderId: status === 'returned' ? rider().id : null,
        });
        const out = await get(`${URL}/${done.id}`, auth);
        expect(out.body).toMatchObject({ contactVisible: false, customer: null, address: null });
        expect(JSON.stringify(out.body)).not.toMatch(CLIENT_PII);
      }
    });

    it('`private, no-store` también en 4xx/5xx; sin etag', async () => {
      const auth = await admin();
      for (const res of [
        await get(`${URL}/${MISSING}`, auth),
        await get(`${URL}/no-uuid`, auth),
        await get(`${URL}?limit=0`, auth),
        await post(`${URL}/${MISSING}/cancel`, auth, { expectedVersion: 1 }),
      ]) {
        expect(res.headers['cache-control']).toBe('private, no-store');
        expect(res.headers['etag']).toBeUndefined();
      }
    });
  });

  describe('R26 logs y errores sin datos personales', () => {
    it('400, 403, 404, 409, 422 y 500 no vuelcan nombre, teléfono, dirección ni motivo en logs ni cuerpos', async () => {
      const auth = await admin();
      const r = rider();
      const c = await make(auth);
      const bodies: unknown[] = [];
      bodies.push(
        (await post(`${URL}/${c.id}/cancel`, auth, { expectedVersion: 1, reason: 'a' })).body,
      ); // 400
      bodies.push(
        (
          await post(`${URL}/${c.id}/cancel`, await readerAt(A), {
            expectedVersion: 1,
            reason: 'motivo uno',
          })
        ).body,
      ); // 403
      bodies.push((await get(`${URL}/${MISSING}`, auth)).body); // 404
      bodies.push((await post(`${URL}/${c.id}/mark-picked-up`, auth, { expectedVersion: 7 })).body); // 409
      riders.ownDelivery.set(A, false);
      bodies.push(
        (
          await post(`${URL}/${c.id}/assign-own-rider`, auth, {
            riderId: r.id,
            expectedVersion: c.version,
          })
        ).body,
      ); // 422
      riders.ownDelivery.set(A, true);
      repo.failAudit = true;
      bodies.push(
        (
          await post(`${URL}/${c.id}/cancel`, auth, {
            expectedVersion: c.version,
            reason: 'MOTIVO-INTERNO-X',
          })
        ).body,
      ); // 500
      const raw = `${logged.join('\n')}\n${JSON.stringify(bodies)}`;
      for (const pii of [
        CLIENT,
        CLIENT_PHONE,
        ADDRESS,
        RIDER_NAME,
        RIDER_PHONE,
        PLATE,
        'MOTIVO-INTERNO-X',
      ]) {
        expect(raw).not.toContain(pii);
      }
    });
  });

  describe('R31 R37 gate, lock_timeout y throttles', () => {
    it('gate saturado => 503 DELIVERIES_BUSY con Retry-After y `private, no-store` (lectura y escritura)', async () => {
      await app.close();
      const gate = new DbGate(1, 0, 5_000, deliveriesBusy);
      ({ app } = await buildApp(keys, staffRows, { repo, riders, port, gate }));
      let free!: () => void;
      const held = gate.run(() => new Promise<void>((resolve) => (free = resolve)));
      const auth = await admin();
      const d = repo.seedDelivery({ orderId: order().id });
      for (const res of [
        await get(URL, auth),
        await get(`${URL}/${d.id}`, auth),
        await post(URL, auth, { orderId: order().id }),
        await post(`${URL}/${d.id}/cancel`, auth, { expectedVersion: 1, reason: 'motivo uno' }),
      ]) {
        expect(res.status).toBe(503);
        expect(json(res).code).toBe('DELIVERIES_BUSY');
        expect(res.headers['retry-after']).toBe('2');
        expect(res.headers['cache-control']).toBe('private, no-store');
      }
      free();
      await held;
      expect(repo.deliveries.get(d.id)?.status).toBe('pending');
    });

    it('lock_timeout (55P03) de la transacción => 503 DELIVERIES_BUSY reintentable', async () => {
      const auth = await admin();
      const d = repo.seedDelivery({ orderId: order().id });
      repo.failWith = { code: '55P03' };
      const res = await post(`${URL}/${d.id}/cancel`, auth, {
        expectedVersion: 1,
        reason: 'motivo uno',
      });
      expect([res.status, json(res).code, res.headers['retry-after']]).toEqual([
        503,
        'DELIVERIES_BUSY',
        '2',
      ]);
      expect(json(res).message).not.toMatch(/55P03|lock/i);
    });

    it('comando: 30/min por actor => 429 RATE_LIMITED con Retry-After; las lecturas tienen contador propio', async () => {
      const auth = await managerAt(A);
      let last = 0;
      for (let i = 0; i < 31; i += 1) {
        const res = await post(`${URL}/${MISSING}/cancel`, auth, {}, `10.9.0.${i % 200}`);
        last = res.status;
        if (i < 30) expect(res.status).toBe(400);
        else {
          expect(json(res).code).toBe('RATE_LIMITED');
          expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
          expect(res.headers['cache-control']).toBe('private, no-store');
        }
      }
      expect(last).toBe(429);
      expect((await get(URL, auth)).status).toBe(200);
    });

    it('lectura: 60/min por actor => 429', async () => {
      const auth = await managerAt(A);
      let last = 0;
      for (let i = 0; i < 61; i += 1) last = (await get(URL, auth, `10.8.0.${i % 200}`)).status;
      expect(last).toBe(429);
    });
  });

  it('fail-closed: con el puerto «sin entregas» (known=false) la asignación responde 503 y no cambia nada', async () => {
    const auth = await admin();
    const c = await make(auth);
    port.known = false;
    const res = await post(`${URL}/${c.id}/assign-own-rider`, auth, {
      riderId: rider().id,
      expectedVersion: c.version,
    });
    expect([res.status, json(res).code]).toEqual([503, 'DELIVERIES_BUSY']);
    expect(repo.deliveries.get(c.id)?.status).toBe('pending');
  });
});

describe('Binding real de los puertos de F28 (R27 R32 R33 R39)', () => {
  let keys: TestKeys;
  beforeAll(async () => {
    keys = await createTestKeys();
  });

  it('R27 RIDER_ACTIVE_DELIVERIES_PORT NO es NoActiveDeliveriesAdapter y `known === true` (FALLA si sigue siendo «sin entregas»)', async () => {
    const { app, moduleRef, db } = await buildApp(keys, new Map(), { real: true });
    try {
      const { RIDER_ACTIVE_DELIVERIES_PORT, NoActiveDeliveriesAdapter } =
        await import('../src/riders/ports/rider-active-deliveries.port.js');
      const { RiderActiveDeliveriesAdapter } =
        await import('../src/riders/ports/rider-active-deliveries.adapter.js');
      const port = moduleRef.get<{
        findBusy: (q: unknown) => Promise<{ known: boolean; busyIds: Set<string> }>;
      }>(RIDER_ACTIVE_DELIVERIES_PORT, { strict: false });
      expect(port).not.toBeInstanceOf(NoActiveDeliveriesAdapter);
      expect(port).toBeInstanceOf(RiderActiveDeliveriesAdapter);
      db.$queryRaw.mockResolvedValueOnce([{ rider_id: 'c0000000-0000-4000-8000-0000000000aa' }]);
      const res = await port.findBusy({ riderIds: ['c0000000-0000-4000-8000-0000000000aa'] });
      expect(res.known).toBe(true);
      expect([...res.busyIds]).toEqual(['c0000000-0000-4000-8000-0000000000aa']);
    } finally {
      await app.close();
    }
  });

  it('R32 ORDER_FULFILLMENT_PORT NO es NoDeliveryFulfillment (FALLA si sigue enlazado el doble de F22)', async () => {
    const { app, moduleRef, db } = await buildApp(keys, new Map(), { real: true });
    try {
      const { ORDER_FULFILLMENT_PORT, NoDeliveryFulfillment } =
        await import('../src/orders/ports/order-fulfillment.port.js');
      const { DeliveriesFulfillmentAdapter } =
        await import('../src/orders/ports/deliveries-fulfillment.adapter.js');
      const port = moduleRef.get<{
        inspect: (o: unknown) => Promise<{ activeDelivery: boolean; pendingActions: string[] }>;
      }>(ORDER_FULFILLMENT_PORT, { strict: false });
      expect(port).not.toBeInstanceOf(NoDeliveryFulfillment);
      expect(port).toBeInstanceOf(DeliveriesFulfillmentAdapter);
      db.$queryRaw.mockResolvedValueOnce([{ status: 'assigned' }]);
      expect(
        await port.inspect({
          orderId: 'c0000000-0000-4000-8000-0000000000aa',
          branchId: 'b',
          fulfillmentType: 'DELIVERY',
          deliveryProvider: 'OWN',
          status: 'ready',
        }),
      ).toEqual({ activeDelivery: true, pendingActions: [] });
    } finally {
      await app.close();
    }
  });

  it('R33 `dispatch` habilitada para OWN con deliveries.assign (matriz real; PEDIDOSYA sigue bloqueada)', async () => {
    const { availableActionsFor } = await import('../src/orders/admin/order-transition.matrix.js');
    const find = (provider: 'OWN' | 'PEDIDOSYA', canDo: () => boolean) =>
      availableActionsFor(
        { status: 'ready', fulfillmentType: 'DELIVERY', deliveryProvider: provider },
        canDo,
      ).find((a) => a.action === 'dispatch');
    expect(find('OWN', () => true)).toMatchObject({ enabled: true, disabledReason: null });
    expect(find('PEDIDOSYA', () => true)).toMatchObject({
      enabled: false,
      disabledReason: 'PROVIDER_BLOCKED_EXTERNAL',
    });
  });
});
