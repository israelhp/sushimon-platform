import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { ridersBusy } from '../src/riders/riders-errors.js';
import { FakeBusyPort, FakeRidersRepo } from './support/fake-riders-repo.js';
import { ROLE_PERMISSIONS } from './support/staff-context.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

/**
 * F27 (spec 028 §13, nivel E): motoristas del backoffice con supertest sobre la app REAL (guards, pipes, filtro, throttles y
 * middleware) y un repositorio en memoria. El SQL se prueba contra PostgreSQL en `test/riders.int-spec.ts`.
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
const PHONE = '+50255501122';
const NAME = 'NOMBRE-SECRETO-E2E';
const PLATE = 'PLACA9X7';
const WRITE = ['riders.read', 'riders.create', 'riders.update'];

interface Assignment {
  branchId: string | null;
  permissions: string[];
}
type Body = Record<string, unknown>;
const json = (res: request.Response) =>
  res.body as Body & { code?: string; current?: number; message?: string; details?: string[] };

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

describe('Motoristas propios del backoffice (e2e, F27)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let repo: FakeRidersRepo;
  let port: FakeBusyPort;
  let staffRows: Map<string, ReturnType<typeof staffRow>>;
  let logged: string[];
  let transactionSpy: ReturnType<typeof vi.fn>;
  let A: string;
  let B: string;
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
    const { RidersRepository } = await import('../src/riders/riders.repository.js');
    const { RIDER_ACTIVE_DELIVERIES_PORT } =
      await import('../src/riders/ports/rider-active-deliveries.port.js');
    const { RIDERS_DB_GATE } = await import('../src/riders/riders-errors.js');
    transactionSpy = vi.fn();
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
      $transaction: transactionSpy,
      $disconnect: () => Promise.resolve(),
    };
    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(JWKS_RESOLVER)
      .useValue(keys.jwks)
      .overrideProvider(RidersRepository)
      .useValue(repo)
      .overrideProvider(RIDER_ACTIVE_DELIVERIES_PORT)
      .useValue(port);
    if (gate) builder = builder.overrideProvider(RIDERS_DB_GATE).useValue(gate);
    const moduleRef = await builder.compile();
    const instance = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(instance, { corsOrigins: ['http://localhost:3000'], trustProxyHops: 1 });
    await instance.init();
    return instance;
  }

  const actorIds = new Map<string, string>();
  /** Registra un empleado y devuelve su cabecera `Authorization`. */
  const actor = async (assignments: Assignment[], claims: Record<string, unknown> = AAL2) => {
    const id = randomUUID();
    staffRows.set(id, staffRow(id, assignments));
    const auth = `Bearer ${await keys.sign({ sub: id, ...claims })}`;
    actorIds.set(auth, id);
    return auth;
  };
  const admin = (claims?: Record<string, unknown>) =>
    actor([{ branchId: null, permissions: ROLE_PERMISSIONS['admin'] as string[] }], claims);
  const writerAt = (b: string) => actor([{ branchId: b, permissions: WRITE }]);
  const ip = (n = 1) => `10.0.0.${n}`;
  const get = (path: string, auth: string, addr = ip()) =>
    http().get(path).set('Authorization', auth).set('X-Forwarded-For', addr);
  const send = (method: 'post' | 'patch', path: string, auth: string, body: Body, addr = ip()) =>
    http()[method](path).set('Authorization', auth).set('X-Forwarded-For', addr).send(body);
  const create = (auth: string, over: Body = {}) =>
    send('post', '/v1/admin/riders', auth, {
      branchId: A,
      fullName: NAME,
      phone: PHONE,
      licensePlate: PLATE,
      ...over,
    });
  const seedRider = (over: Record<string, unknown> = {}) =>
    repo.seed({ branchId: A, fullName: NAME, ...over });

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
    repo = new FakeRidersRepo();
    port = new FakeBusyPort();
    A = repo.addBranch('Centro');
    B = repo.addBranch('Zona 10');
    app = await createApp();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('R07 autenticación, MFA y permisos', () => {
    const routes: [string, (auth?: string) => request.Test][] = [
      ['GET list', (a) => (a ? get('/v1/admin/riders', a) : http().get('/v1/admin/riders'))],
      [
        'GET detail',
        (a) =>
          a ? get(`/v1/admin/riders/${MISSING}`, a) : http().get(`/v1/admin/riders/${MISSING}`),
      ],
      [
        'POST',
        (a) => {
          const r = http().post('/v1/admin/riders');
          return (a ? r.set('Authorization', a) : r).send({
            branchId: A,
            fullName: 'Luis',
            phone: PHONE,
          });
        },
      ],
      [
        'PATCH',
        (a) => {
          const r = http().patch(`/v1/admin/riders/${MISSING}`);
          return (a ? r.set('Authorization', a) : r).send({ expectedVersion: 1, fullName: 'Luis' });
        },
      ],
      [
        'PATCH status',
        (a) => {
          const r = http().patch(`/v1/admin/riders/${MISSING}/status`);
          return (a ? r.set('Authorization', a) : r).send({ active: false });
        },
      ],
      [
        'PATCH availability',
        (a) => {
          const r = http().patch(`/v1/admin/riders/${MISSING}/availability`);
          return (a ? r.set('Authorization', a) : r).send({ availability: 'AVAILABLE' });
        },
      ],
    ];
    it.each(routes)(
      '%s: sin token 401; cliente 403; aal1 => 403 MFA_REQUIRED; JWT inválido 401; todos `private, no-store`',
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

    it('sin el permiso de la operación => 403 genérico (riders.assign no sirve)', async () => {
      const r = seedRider();
      const assignOnly = await actor([{ branchId: A, permissions: ['riders.assign'] }]);
      const readOnly = await actor([{ branchId: A, permissions: ['riders.read'] }]);
      for (const res of [
        await get('/v1/admin/riders', assignOnly),
        await get(`/v1/admin/riders/${r.id}`, assignOnly),
        await create(readOnly),
        await send('patch', `/v1/admin/riders/${r.id}`, readOnly, {
          expectedVersion: 1,
          fullName: 'Otro',
        }),
        await send('patch', `/v1/admin/riders/${r.id}/status`, readOnly, { active: false }),
        await send('patch', `/v1/admin/riders/${r.id}/availability`, readOnly, {
          availability: 'AVAILABLE',
        }),
      ]) {
        expect(res.status).toBe(403);
        expect(json(res).code).toBeUndefined();
      }
      expect(repo.riders.get(r.id)).toMatchObject({ version: 1, active: true });
    });

    it('R09 manager (solo read/assign): lista y ve su sucursal, no la ajena; escribe => 403', async () => {
      const mine = seedRider({ branchId: A });
      const theirs = seedRider({ branchId: B, fullName: 'Ajeno' });
      const manager = await actor([
        { branchId: A, permissions: ROLE_PERMISSIONS['manager'] as string[] },
      ]);
      const list = await get('/v1/admin/riders', manager);
      expect(list.status).toBe(200);
      expect((list.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([mine.id]);
      expect((await get(`/v1/admin/riders/${mine.id}`, manager)).status).toBe(200);
      expect((await get(`/v1/admin/riders/${theirs.id}`, manager)).status).toBe(404);
      expect((await create(manager)).status).toBe(403);
      expect(
        (await send('patch', `/v1/admin/riders/${mine.id}/status`, manager, { active: false }))
          .status,
      ).toBe(403);
    });
  });

  describe('R02 R14 validaciones', () => {
    it.each([
      ['teléfono con letra', { phone: '+50255501122x' }],
      ['teléfono sin +502', { phone: '55501122' }],
      ['teléfono de 7 dígitos', { phone: '+5025550112' }],
      ['teléfono con espacio', { phone: '+502 55501122' }],
      ['vehículo fuera del conjunto', { vehicleType: 'TRUCK' }],
      ['placa inválida', { licensePlate: 'AB' }],
      ['nombre de 1 carácter', { fullName: 'A' }],
      ['nombre de 81 caracteres', { fullName: 'x'.repeat(81) }],
      ['sucursal no UUID', { branchId: 'no-uuid' }],
      ['campo desconocido', { active: false }],
      ['columna interna', { version: 9 }],
      ['name_key', { nameKey: 'x' }],
      ['id', { id: randomUUID() }],
    ])('alta: %s => 400', async (_n, over) => {
      const res = await create(await admin(), over);
      expect(res.status).toBe(400);
      expect(repo.riders.size).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain('5550');
    });

    it.each([
      ['sin expectedVersion', { fullName: 'Luis' }],
      ['sin campos editables', { expectedVersion: 1 }],
      ['con active', { expectedVersion: 1, active: false }],
      ['con availability', { expectedVersion: 1, availability: 'AVAILABLE' }],
      ['campo desconocido', { expectedVersion: 1, fullName: 'Luis', foo: 1 }],
      ['version 0', { expectedVersion: 0, fullName: 'Luis' }],
      ['teléfono inválido', { expectedVersion: 1, phone: '123' }],
      ['vehículo inválido', { expectedVersion: 1, vehicleType: 'X' }],
    ])('PATCH: %s => 400', async (_n, body) => {
      const r = seedRider();
      const res = await send('patch', `/v1/admin/riders/${r.id}`, await admin(), body);
      expect(res.status).toBe(400);
      expect(repo.riders.get(r.id)?.version).toBe(1);
    });

    it('status y availability: forma estricta; BUSY => 400', async () => {
      const r = seedRider();
      const auth = await admin();
      const path = `/v1/admin/riders/${r.id}`;
      expect((await send('patch', `${path}/status`, auth, {})).status).toBe(400);
      expect((await send('patch', `${path}/status`, auth, { active: 'no' })).status).toBe(400);
      expect((await send('patch', `${path}/status`, auth, { active: true, x: 1 })).status).toBe(
        400,
      );
      expect(
        (await send('patch', `${path}/status`, auth, { active: true, reason: 'x'.repeat(201) }))
          .status,
      ).toBe(400);
      expect(
        (await send('patch', `${path}/availability`, auth, { availability: 'BUSY' })).status,
      ).toBe(400);
      expect((await send('patch', `${path}/availability`, auth, {})).status).toBe(400);
      expect(
        (await send('patch', `/v1/admin/riders/no-uuid/status`, auth, { active: true })).status,
      ).toBe(400);
      expect((await get('/v1/admin/riders/no-uuid', auth)).status).toBe(400);
      expect(repo.riders.get(r.id)).toMatchObject({ version: 1, active: true });
    });

    it.each([
      'pageSize=101',
      'pageSize=0',
      'page=0',
      'page=10001',
      'sort=phone',
      'order=up',
      'availability=OTHER',
      'active=maybe',
      'branchId=x',
      `q=${'a'.repeat(81)}`,
      'foo=1',
    ])('listado: ?%s => 400', async (qs) => {
      expect((await get(`/v1/admin/riders?${qs}`, await admin())).status).toBe(400);
    });
  });

  describe('R03 R04 R06 alta', () => {
    it('201 con active=true, UNAVAILABLE, version=1 y auditoría rider.created sin PII', async () => {
      const auth = await admin();
      const res = await create(auth, {
        fullName: '  Luis   Pérez ',
        licensePlate: 'p-123 abc',
        vehicleType: 'CAR',
      });
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toMatchObject({
        branchId: A,
        branchName: 'Centro',
        fullName: 'Luis Pérez',
        phone: PHONE,
        licensePlate: 'P123ABC',
        vehicleType: 'CAR',
        active: true,
        availability: 'UNAVAILABLE',
        version: 1,
        busy: false,
        busyKnown: false,
        operationalState: 'UNAVAILABLE',
      });
      expect(repo.audits).toHaveLength(1);
      expect(repo.audits[0]).toMatchObject({
        action: 'rider.created',
        entityType: 'rider',
        branchId: A,
        actorId: actorIds.get(auth),
        newValues: { branchId: A, vehicleType: 'CAR', active: true, availability: 'UNAVAILABLE' },
      });
      const dump = JSON.stringify(repo.audits);
      for (const pii of ['Luis', 'Pérez', PHONE, 'P123ABC', '5550'])
        expect(dump).not.toContain(pii);
    });

    it('teléfono repetido (activo, inactivo, otra sucursal) => 409 sin revelar al registro', async () => {
      const auth = await admin();
      const first = await create(auth);
      expect(first.status).toBe(201);
      await send('patch', `/v1/admin/riders/${(first.body as { id: string }).id}/status`, auth, {
        active: false,
      });
      for (const branchId of [A, B]) {
        const res = await create(auth, { branchId, fullName: 'Otro' });
        expect(res.status).toBe(409);
        expect(json(res).code).toBe('RIDER_PHONE_TAKEN');
        expect(JSON.stringify(res.body)).not.toContain((first.body as { id: string }).id);
      }
      expect(repo.riders.size).toBe(1);
    });

    it('sucursal fuera del alcance => 403 RIDER_ACTION_FORBIDDEN; inactiva/inexistente (global) => 422', async () => {
      const res = await create(await writerAt(B));
      expect(res.status).toBe(403);
      expect(json(res).code).toBe('RIDER_ACTION_FORBIDDEN');
      const dead = repo.addBranch('Cerrada', false);
      const closed = await create(await admin(), { branchId: dead });
      expect(closed.status).toBe(422);
      expect(json(closed).code).toBe('BRANCH_NOT_AVAILABLE');
      expect((await create(await admin(), { branchId: MISSING })).status).toBe(422);
      expect(repo.riders.size).toBe(0);
    });
  });

  describe('R10 R11 R12 listado y detalle', () => {
    beforeEach(() => {
      seedRider({
        fullName: 'Álvaro Gómez',
        phone: '+50255500001',
        licensePlate: 'AAA111',
        availability: 'AVAILABLE',
      });
      seedRider({ fullName: 'Beatriz Díaz', phone: '+50255500002', branchId: B });
      seedRider({ fullName: 'Carlos Ruiz', phone: '+50255500003', active: false });
    });
    const items = (res: request.Response) =>
      (res.body as { items: { fullName: string }[] }).items.map((i) => i.fullName);

    it('enmascarado, sin placa ni teléfono completo, con `private, no-store` y paginación', async () => {
      const res = await get('/v1/admin/riders?pageSize=2', await admin());
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect(items(res)).toEqual(['Álvaro Gómez', 'Beatriz Díaz']);
      const raw = JSON.stringify(res.body);
      expect(raw).toContain('+502****0001');
      expect(raw).not.toContain('+50255500001');
      expect(raw).not.toContain('AAA111');
      expect((res.body as { items: Body[] }).items[0]).not.toHaveProperty('phone');
      expect((res.body as { items: Body[] }).items[0]).not.toHaveProperty('licensePlate');
      const p2 = await get('/v1/admin/riders?pageSize=2&page=2', await admin());
      expect(items(p2)).toEqual(['Carlos Ruiz']);
      expect(items(await get('/v1/admin/riders?page=5', await admin()))).toEqual([]);
    });

    it('q con %, _ y \\ es texto literal (no comodín): no encuentra nada', async () => {
      const auth = await admin();
      for (const q of ['%', '_', '\\', 'a%', '_lvaro', '%25%25']) {
        const res = await get(`/v1/admin/riders?q=${encodeURIComponent(q)}`, auth);
        expect(res.status).toBe(200);
        expect(items(res)).toEqual([]);
      }
    });

    it('filtros q (con acentos), branchId, active, availability y orden', async () => {
      const auth = await admin();
      expect(items(await get('/v1/admin/riders?q=ALVARO', auth))).toEqual(['Álvaro Gómez']);
      expect(items(await get(`/v1/admin/riders?q=${encodeURIComponent('díaz')}`, auth))).toEqual([
        'Beatriz Díaz',
      ]);
      expect(items(await get('/v1/admin/riders?q=5550', auth))).toEqual([]);
      expect(items(await get(`/v1/admin/riders?branchId=${B}`, auth))).toEqual(['Beatriz Díaz']);
      expect(items(await get('/v1/admin/riders?active=false', auth))).toEqual(['Carlos Ruiz']);
      expect(items(await get('/v1/admin/riders?availability=AVAILABLE', auth))).toEqual([
        'Álvaro Gómez',
      ]);
      expect(items(await get('/v1/admin/riders?availability=UNAVAILABLE', auth))).toEqual([
        'Beatriz Díaz',
        'Carlos Ruiz',
      ]);
      expect(items(await get('/v1/admin/riders?sort=fullName&order=desc', auth))).toEqual([
        'Carlos Ruiz',
        'Beatriz Díaz',
        'Álvaro Gómez',
      ]);
    });

    it('R24 sin F28: busy=false, busyKnown=false, nunca BUSY; filtro BUSY vacío', async () => {
      const auth = await admin();
      const res = await get('/v1/admin/riders', auth);
      for (const it of (res.body as { items: Body[] }).items) {
        expect(it).toMatchObject({ busy: false, busyKnown: false });
        expect(it['operationalState']).not.toBe('BUSY');
      }
      expect(items(await get('/v1/admin/riders?availability=BUSY', auth))).toEqual([]);
    });

    it('R25 con el puerto doble known=true: BUSY y filtros AVAILABLE/BUSY correctos', async () => {
      const ready = [...repo.riders.values()].find((r) => r.availability === 'AVAILABLE');
      port.known = true;
      port.busyIds.add(ready?.id ?? '');
      const auth = await admin();
      const list = await get('/v1/admin/riders', auth);
      expect(
        (list.body as { items: Body[] }).items.find((i) => i['id'] === ready?.id),
      ).toMatchObject({
        busy: true,
        busyKnown: true,
        operationalState: 'BUSY',
      });
      expect(items(await get('/v1/admin/riders?availability=BUSY', auth))).toEqual([
        'Álvaro Gómez',
      ]);
      expect(items(await get('/v1/admin/riders?availability=AVAILABLE', auth))).toEqual([]);
    });

    it('R11 alcance acotado: nunca filas ajenas; branchId ajeno => página vacía', async () => {
      const auth = await writerAt(A);
      expect(items(await get('/v1/admin/riders', auth))).toEqual(['Álvaro Gómez', 'Carlos Ruiz']);
      const other = await get(`/v1/admin/riders?branchId=${B}`, auth);
      expect(other.status).toBe(200);
      expect(other.body).toMatchObject({ items: [], total: 0 });
      expect(items(await get(`/v1/admin/riders?branchId=${MISSING}`, auth))).toEqual([]);
    });

    it('detalle con teléfono completo y placa; R08 404 idéntico para ajeno e inexistente', async () => {
      const mine = [...repo.riders.values()].find((r) => r.licensePlate === 'AAA111');
      const theirs = [...repo.riders.values()].find((r) => r.branchId === B);
      const auth = await writerAt(A);
      const ok = await get(`/v1/admin/riders/${mine?.id}`, auth);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        phone: '+50255500001',
        licensePlate: 'AAA111',
        phoneMasked: '+502****0001',
      });
      expect(ok.headers['cache-control']).toBe('private, no-store');
      const foreign = await get(`/v1/admin/riders/${theirs?.id}`, auth);
      const missing = await get(`/v1/admin/riders/${MISSING}`, auth);
      expect(foreign.status).toBe(404);
      const strip = (r: request.Response) => {
        const rest = { ...(r.body as Body) };
        delete rest['requestId'];
        return rest;
      };
      expect(strip(foreign)).toEqual(strip(missing));
      expect(json(foreign).code).toBe('RIDER_NOT_FOUND');
    });
  });

  describe('R13 R15 R16 edición', () => {
    it('versión correcta => 200 y version+1; versión vieja => 409 con current; sin cambios => 200 intacto', async () => {
      const r = seedRider({ phone: '+50255500001' });
      const auth = await admin();
      const ok = await send('patch', `/v1/admin/riders/${r.id}`, auth, {
        expectedVersion: 1,
        fullName: 'Luis Alberto',
        vehicleType: 'CAR',
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ version: 2, fullName: 'Luis Alberto', vehicleType: 'CAR' });
      expect(repo.audits.at(-1)).toMatchObject({
        action: 'rider.updated',
        newValues: { changedFields: ['fullName', 'vehicleType'] },
      });
      expect(JSON.stringify(repo.audits)).not.toContain('Alberto');
      const stale = await send('patch', `/v1/admin/riders/${r.id}`, auth, {
        expectedVersion: 1,
        fullName: 'Otro',
      });
      expect(stale.status).toBe(409);
      expect(json(stale).code).toBe('RIDER_VERSION_CONFLICT');
      expect(json(stale).current).toBe(2);
      expect(repo.riders.get(r.id)?.fullName).toBe('Luis Alberto');
      const audits = repo.audits.length;
      const same = await send('patch', `/v1/admin/riders/${r.id}`, auth, {
        expectedVersion: 2,
        fullName: 'Luis Alberto',
      });
      expect(same.status).toBe(200);
      expect((same.body as { version: number }).version).toBe(2);
      expect(repo.audits).toHaveLength(audits);
    });

    it('null borra vehículo y placa; teléfono repetido => 409 RIDER_PHONE_TAKEN', async () => {
      const r = seedRider({ phone: '+50255500001', vehicleType: 'CAR', licensePlate: 'ABC123' });
      seedRider({ phone: '+50255500002' });
      const auth = await admin();
      const res = await send('patch', `/v1/admin/riders/${r.id}`, auth, {
        expectedVersion: 1,
        vehicleType: null,
        licensePlate: null,
      });
      expect(res.body).toMatchObject({ vehicleType: null, licensePlate: null, version: 2 });
      const dup = await send('patch', `/v1/admin/riders/${r.id}`, auth, {
        expectedVersion: 2,
        phone: '+50255500002',
      });
      expect(dup.status).toBe(409);
      expect(json(dup).code).toBe('RIDER_PHONE_TAKEN');
    });

    it('rider ajeno => 404 uniforme; ve pero sin update en su sucursal => 403', async () => {
      const r = seedRider({ branchId: B });
      expect(
        (
          await send('patch', `/v1/admin/riders/${r.id}`, await writerAt(A), {
            expectedVersion: 1,
            fullName: 'Luis',
          })
        ).status,
      ).toBe(404);
      const reader = await actor([
        { branchId: B, permissions: ['riders.read'] },
        { branchId: A, permissions: ['riders.update'] },
      ]);
      const res = await send('patch', `/v1/admin/riders/${r.id}`, reader, {
        expectedVersion: 1,
        fullName: 'Luis',
      });
      expect(res.status).toBe(403);
      expect(json(res).code).toBe('RIDER_ACTION_FORBIDDEN');
    });
  });

  describe('R17 R18 R19 traslado', () => {
    it('autorizado: mismo id, UNAVAILABLE, branch_changed con origen y destino; no se crea otra fila', async () => {
      const r = seedRider({ availability: 'AVAILABLE' });
      const auth = await actor([{ branchId: null, permissions: WRITE }]);
      const res = await send('patch', `/v1/admin/riders/${r.id}`, auth, {
        expectedVersion: 1,
        branchId: B,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: r.id,
        branchId: B,
        branchName: 'Zona 10',
        availability: 'UNAVAILABLE',
        version: 2,
      });
      expect(repo.riders.size).toBe(1);
      expect(repo.audits).toHaveLength(1);
      expect(repo.audits[0]).toMatchObject({
        action: 'rider.branch_changed',
        branchId: B,
        oldValues: { branchId: A },
        newValues: { branchId: B, availability: 'UNAVAILABLE' },
      });
    });

    it('sin update en el destino (o en el origen) => 403; destino inactivo => 422', async () => {
      const r = seedRider();
      const onlyA = await writerAt(A);
      const res = await send('patch', `/v1/admin/riders/${r.id}`, onlyA, {
        expectedVersion: 1,
        branchId: B,
      });
      expect(res.status).toBe(403);
      expect(json(res).code).toBe('RIDER_ACTION_FORBIDDEN');
      const dead = repo.addBranch('Cerrada', false);
      const closed = await send('patch', `/v1/admin/riders/${r.id}`, await admin(), {
        expectedVersion: 1,
        branchId: dead,
      });
      expect(closed.status).toBe(422);
      expect(json(closed).code).toBe('BRANCH_NOT_AVAILABLE');
      expect(repo.riders.get(r.id)).toMatchObject({ branchId: A, version: 1 });
    });

    it('con entrega activa (doble known=true) => 409 RIDER_HAS_ACTIVE_DELIVERY sin cambios', async () => {
      const r = seedRider();
      port.known = true;
      port.busyIds.add(r.id);
      const res = await send('patch', `/v1/admin/riders/${r.id}`, await admin(), {
        expectedVersion: 1,
        branchId: B,
      });
      expect(res.status).toBe(409);
      expect(json(res).code).toBe('RIDER_HAS_ACTIVE_DELIVERY');
      expect(repo.riders.get(r.id)).toMatchObject({ branchId: A, version: 1 });
      expect(repo.audits).toHaveLength(0);
    });
  });

  describe('R20 R21 R22 R23 estado y disponibilidad', () => {
    it('reason con un teléfono: se acepta pero NO aparece en la respuesta ni en la auditoría', async () => {
      const r = seedRider({ availability: 'AVAILABLE' });
      const leak = '+50255509876';
      const res = await send('patch', `/v1/admin/riders/${r.id}/status`, await admin(), {
        active: false,
        reason: `llamar al ${leak}`,
      });
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(leak);
      expect(repo.audits).toHaveLength(1);
      expect(JSON.stringify(repo.audits)).not.toContain(leak);
      expect(JSON.stringify(repo.audits)).not.toContain('llamar');
      expect(repo.audits[0]?.newValues).toMatchObject({ hasReason: true });
    });

    it('desactivar fuerza UNAVAILABLE; reactivar no lo deja disponible; repetir => 200 sin auditar', async () => {
      const r = seedRider({ availability: 'AVAILABLE' });
      const auth = await admin();
      const path = `/v1/admin/riders/${r.id}/status`;
      const off = await send('patch', path, auth, { active: false, reason: 'baja voluntaria' });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({
        active: false,
        availability: 'UNAVAILABLE',
        operationalState: 'INACTIVE',
      });
      expect(repo.audits[0]).toMatchObject({
        action: 'rider.deactivated',
        newValues: { active: false, hasReason: true, reasonLength: 'baja voluntaria'.length },
      });
      expect(repo.audits[0]?.reason ?? null).toBeNull(); // el texto libre NO se persiste
      const again = await send('patch', path, auth, { active: false });
      expect(again.status).toBe(200);
      expect(repo.audits).toHaveLength(1);
      const on = await send('patch', path, auth, { active: true });
      expect(on.body).toMatchObject({ active: true, availability: 'UNAVAILABLE' });
      expect(repo.audits.at(-1)?.action).toBe('rider.activated');
    });

    it('desactivar y UNAVAILABLE con entrega activa => 409; sin entrega => 200', async () => {
      const r = seedRider({ availability: 'AVAILABLE' });
      const auth = await admin();
      port.known = true;
      port.busyIds.add(r.id);
      for (const [p, b] of [
        ['status', { active: false }],
        ['availability', { availability: 'UNAVAILABLE' }],
      ] as const) {
        const res = await send('patch', `/v1/admin/riders/${r.id}/${p}`, auth, b);
        expect(res.status).toBe(409);
        expect(json(res).code).toBe('RIDER_HAS_ACTIVE_DELIVERY');
      }
      expect(repo.riders.get(r.id)).toMatchObject({ active: true, availability: 'AVAILABLE' });
      port.busyIds.clear();
      expect(
        (await send('patch', `/v1/admin/riders/${r.id}/status`, auth, { active: false })).status,
      ).toBe(200);
    });

    it('availability: AVAILABLE/UNAVAILABLE idempotente; inactivo => 409 RIDER_INACTIVE', async () => {
      const r = seedRider();
      const auth = await admin();
      const path = `/v1/admin/riders/${r.id}/availability`;
      const on = await send('patch', path, auth, { availability: 'AVAILABLE' });
      expect(on.body).toMatchObject({
        availability: 'AVAILABLE',
        operationalState: 'AVAILABLE',
        version: 2,
      });
      expect(repo.audits[0]).toMatchObject({
        action: 'rider.availability_changed',
        oldValues: { availability: 'UNAVAILABLE' },
        newValues: { availability: 'AVAILABLE' },
      });
      const same = await send('patch', path, auth, { availability: 'AVAILABLE' });
      expect((same.body as { version: number }).version).toBe(2);
      expect(repo.audits).toHaveLength(1);
      await send('patch', `/v1/admin/riders/${r.id}/status`, auth, { active: false });
      const inactive = await send('patch', path, auth, { availability: 'AVAILABLE' });
      expect(inactive.status).toBe(409);
      expect(json(inactive).code).toBe('RIDER_INACTIVE');
      expect((await send('patch', path, auth, { availability: 'UNAVAILABLE' })).status).toBe(200);
    });

    it('rider ajeno => 404 uniforme en status y availability', async () => {
      const r = seedRider({ branchId: B });
      const auth = await writerAt(A);
      for (const [p, b] of [
        ['status', { active: false }],
        ['availability', { availability: 'AVAILABLE' }],
      ] as const) {
        const res = await send('patch', `/v1/admin/riders/${r.id}/${p}`, auth, b);
        expect(res.status).toBe(404);
        expect(json(res).code).toBe('RIDER_NOT_FOUND');
      }
    });
  });

  describe('R26 R27 R28 elegibilidad (servicio exportado)', () => {
    it('inactivo, no disponible, sucursal ajena, ocupado (doble) y reparto propio deshabilitado/habilitado', async () => {
      const { RiderEligibilityService } =
        await import('../src/riders/rider-eligibility.service.js');
      const svc = app.get(RiderEligibilityService);
      const ready = seedRider({ availability: 'AVAILABLE' });
      const off = await svc.evaluate({ riderId: ready.id, branchId: A });
      expect(off.reasons).toEqual(['OWN_DELIVERY_DISABLED']); // sin fila de ajustes = false (F09)
      repo.ownDelivery.set(A, true);
      expect((await svc.evaluate({ riderId: ready.id, branchId: A })).eligible).toBe(true);
      expect((await svc.evaluate({ riderId: ready.id, branchId: B })).reasons).toEqual([
        'WRONG_BRANCH',
        'OWN_DELIVERY_DISABLED',
      ]);
      const inactive = seedRider({ active: false });
      expect((await svc.evaluate({ riderId: inactive.id, branchId: A })).reasons).toEqual([
        'INACTIVE',
      ]);
      const unavailable = seedRider();
      expect((await svc.evaluate({ riderId: unavailable.id, branchId: A })).reasons).toEqual([
        'UNAVAILABLE',
      ]);
      port.known = true;
      port.busyIds.add(ready.id);
      expect((await svc.evaluate({ riderId: ready.id, branchId: A })).reasons).toEqual(['BUSY']);
      expect((await svc.evaluate({ riderId: MISSING, branchId: A })).reasons).toEqual([
        'NOT_FOUND',
      ]);
      // R27: tener motoristas no cambia la bandera de F09
      expect(repo.ownDelivery.get(B)).toBeUndefined();
    });
  });

  describe('R29 R30 R31 auditoría, logs, gate y throttles', () => {
    it('R29 un fallo de auditoría revierte todo (nada se guarda)', async () => {
      repo.failAudit = true;
      const res = await create(await admin());
      expect(res.status).toBe(500);
      expect(repo.riders.size).toBe(0);
      const r = seedRider();
      const res2 = await send('patch', `/v1/admin/riders/${r.id}/status`, await admin(), {
        active: false,
      });
      expect(res2.status).toBe(500);
      expect(repo.riders.get(r.id)?.active).toBe(true);
    });

    it('R30 logs y errores sin teléfono, placa ni nombre (400, 409 y 500)', async () => {
      const auth = await admin();
      await create(auth, { phone: '+50255501122x' }); // 400
      await create(auth); // 201
      await create(auth, { fullName: NAME }); // 409
      repo.failAudit = true;
      await create(auth, { phone: '+50255509998' }); // 500
      const raw = logged.join('\n');
      for (const pii of [PHONE, '5550', PLATE, NAME]) expect(raw).not.toContain(pii);
    });

    it('R31 gate saturado => 503 RIDERS_BUSY con Retry-After y `private, no-store` (lectura y escritura)', async () => {
      await app.close();
      const gate = new DbGate(1, 0, 5_000, ridersBusy);
      app = await createApp(gate);
      let free!: () => void;
      const held = gate.run(() => new Promise<void>((resolve) => (free = resolve)));
      const auth = await admin();
      const r = seedRider();
      for (const res of [
        await get('/v1/admin/riders', auth),
        await get(`/v1/admin/riders/${r.id}`, auth),
        await create(auth),
        await send('patch', `/v1/admin/riders/${r.id}/status`, auth, { active: false }),
      ]) {
        expect(res.status).toBe(503);
        expect(json(res).code).toBe('RIDERS_BUSY');
        expect(res.headers['retry-after']).toBe('2');
        expect(res.headers['cache-control']).toBe('private, no-store');
      }
      free();
      await held;
      expect(repo.riders.get(r.id)?.active).toBe(true);
    });

    it('comando: 30/min por actor => 429 RATE_LIMITED con Retry-After; las lecturas tienen contador propio', async () => {
      const auth = await writerAt(A);
      const r = seedRider();
      let last = 0;
      for (let i = 0; i < 31; i += 1) {
        const res = await send(
          'patch',
          `/v1/admin/riders/${r.id}/status`,
          auth,
          {},
          `10.9.0.${i % 200}`,
        );
        last = res.status;
        if (i < 30) expect(res.status).toBe(400);
        else {
          expect(json(res).code).toBe('RATE_LIMITED');
          expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
          expect(res.headers['cache-control']).toBe('private, no-store');
        }
      }
      expect(last).toBe(429);
      expect((await get('/v1/admin/riders', auth)).status).toBe(200);
    });

    it('lectura: 60/min por actor => 429', async () => {
      const auth = await writerAt(A);
      let last = 0;
      for (let i = 0; i < 61; i += 1)
        last = (await get('/v1/admin/riders', auth, `10.8.0.${i % 200}`)).status;
      expect(last).toBe(429);
    });
  });

  it('F27 no crea pagos ni entregas: solo opera sobre riders y auditoría', async () => {
    const auth = await admin();
    const created = await create(auth);
    const id = (created.body as { id: string }).id;
    await send('patch', `/v1/admin/riders/${id}/availability`, auth, { availability: 'AVAILABLE' });
    await send('patch', `/v1/admin/riders/${id}`, auth, { expectedVersion: 2, branchId: B });
    await send('patch', `/v1/admin/riders/${id}/status`, auth, { active: false });
    expect(new Set(repo.calls)).toEqual(
      new Set(['insert', 'audit', 'read', 'read:lock', 'setAvailability', 'update', 'setActive']),
    );
    // sin acceso transaccional real: ninguna sentencia fuera del repositorio de motoristas (sin payments/deliveries)
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(repo.riders.size).toBe(1);
  });
});
