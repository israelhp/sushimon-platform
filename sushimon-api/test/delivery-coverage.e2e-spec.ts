import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FakeCoverageRepo, MUN_MIXCO, MUN_MISSING, MUN_VN } from './support/fake-coverage-repo.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const INACTIVE = '33333333-3333-4333-8333-333333333333';
const MISSING = '44444444-4444-4444-8444-444444444444';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const READ_MANAGE = ['branches.read', 'branches.manage_delivery_zones'];

interface AssignmentFake {
  branchId: string | null;
  permissions: string[];
}

function staffRow(assignments: AssignmentFake[], active = true) {
  return {
    id: STAFF_ID,
    fullName: 'Ana Admin',
    active,
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

function fakeDb(repo: FakeCoverageRepo) {
  const db = {
    branch: {
      findUnique: vi.fn((a: { where: { id: string } }) =>
        Promise.resolve(repo.branches.get(a.where.id) ?? null),
      ),
    },
    customer: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
    staffUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db))),
    $disconnect: () => Promise.resolve(),
  };
  return db;
}

async function createApp(
  keys: TestKeys,
  db: ReturnType<typeof fakeDb>,
  repo: FakeCoverageRepo,
  env: Record<string, string> = {},
) {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
    RATE_LIMIT_MAX: '1000',
  });
  delete process.env['PEDIDOSYA_COVERAGE_ADAPTER'];
  delete process.env['PEDIDOSYA_MOCK_SCENARIO'];
  Object.assign(process.env, env);
  vi.resetModules();
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
  const { DeliveryCoverageRepository } =
    await import('../src/delivery-coverage/delivery-coverage.repository.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .overrideProvider(DeliveryCoverageRepository)
    .useValue(repo)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

describe('Zonas propias, settings y cobertura (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let repo: FakeCoverageRepo;
  let db: ReturnType<typeof fakeDb>;
  const http = () => request(app.getHttpServer());
  const bearer = async (claims?: Parameters<TestKeys['sign']>[0]) =>
    `Bearer ${await keys.sign(claims)}`;
  const asStaffWith = async (
    assignments: AssignmentFake[],
    claims: Record<string, unknown> = AAL2,
    active = true,
  ) => {
    db.staffUser.findUnique.mockResolvedValue(staffRow(assignments, active));
    return bearer(claims);
  };
  const asStaff = (
    over: { permissions?: string[]; branchId?: string | null } = {},
    claims: Record<string, unknown> = AAL2,
  ) =>
    asStaffWith(
      [{ branchId: over.branchId ?? null, permissions: over.permissions ?? READ_MANAGE }],
      claims,
    );
  const call = (method: string, url: string, auth?: string, body?: unknown) => {
    const r = (http() as unknown as Record<string, (u: string) => request.Test>)[method]!(url);
    if (auth) void r.set('Authorization', auth);
    return body === undefined ? r : r.send(body as object);
  };
  const zoneBody = (over: Record<string, unknown> = {}) => ({
    branchId: A,
    municipalityId: MUN_MIXCO,
    zoneLabel: 'Zona 4',
    baseFee: '15',
    ...over,
  });

  beforeAll(async () => {
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    repo = new FakeCoverageRepo().addBranch(A).addBranch(B).addBranch(INACTIVE, false);
    db = fakeDb(repo);
    app = await createApp(keys, db, repo);
  });
  afterEach(async () => {
    await app.close();
    delete process.env['PEDIDOSYA_COVERAGE_ADAPTER'];
    delete process.env['PEDIDOSYA_MOCK_SCENARIO'];
  });

  describe('autenticación y autorización admin', () => {
    const zoneId = '55555555-5555-4555-8555-555555555555';
    const routes: [string, string, unknown?][] = [
      ['get', '/v1/admin/delivery-zones'],
      ['post', '/v1/admin/delivery-zones', zoneBody()],
      ['get', `/v1/admin/delivery-zones/${zoneId}`],
      ['patch', `/v1/admin/delivery-zones/${zoneId}`, { expectedVersion: 1, baseFee: '1' }],
      ['patch', `/v1/admin/delivery-zones/${zoneId}/status`, { active: false }],
      ['get', `/v1/admin/branches/${A}/delivery-settings`],
      ['patch', `/v1/admin/branches/${A}/delivery-settings`, { pedidosyaEnabled: false }],
    ];

    it('sin JWT, JWT inválido o clave ajena => 401 con no-store', async () => {
      for (const [method, url, body] of routes) {
        for (const auth of [
          undefined,
          'Bearer x.y.z',
          `Bearer ${await keys.signWithForeignKey()}`,
        ]) {
          const res = await call(method, url, auth, body).expect(401);
          expect(res.headers['cache-control']).toBe('no-store');
        }
      }
    });

    it('cliente (no personal) => 403 con no-store en todas las rutas', async () => {
      const auth = await bearer(AAL2);
      for (const [method, url, body] of routes) {
        const res = await call(method, url, auth, body).expect(403);
        expect((res.body as { message: string }).message).toBe('Acceso denegado');
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });

    it('empleado desactivado => 403', async () => {
      const auth = await asStaffWith([{ branchId: null, permissions: READ_MANAGE }], AAL2, false);
      for (const [method, url, body] of routes) await call(method, url, auth, body).expect(403);
    });

    it('sesión aal1 => 403 MFA_REQUIRED sin tocar datos', async () => {
      const auth = await asStaff({}, {});
      for (const [method, url, body] of routes) {
        const res = await call(method, url, auth, body).expect(403);
        expect((res.body as { message: string }).message).toBe('MFA_REQUIRED');
      }
      expect(repo.zones.size + repo.settings.size + repo.audit.length).toBe(0);
    });

    it('sin permisos de sucursales => 403; solo lectura no escribe; manage sin read tampoco lee', async () => {
      const none = await asStaff({ permissions: ['dashboard.read'] });
      for (const [method, url, body] of routes) await call(method, url, none, body).expect(403);
      const readOnly = await asStaff({ permissions: ['branches.read'] });
      await call('get', '/v1/admin/delivery-zones', readOnly).expect(200);
      await call('get', `/v1/admin/branches/${A}/delivery-settings`, readOnly).expect(200);
      for (const [method, url, body] of routes.filter(([m]) => m !== 'get')) {
        await call(method, url, readOnly, body).expect(403);
      }
      const manageOnly = await asStaff({ permissions: ['branches.manage_delivery_zones'] });
      await call('get', '/v1/admin/delivery-zones', manageOnly).expect(403);
      expect(repo.audit).toHaveLength(0);
    });

    it('personal de OTRA sucursal => 404 idéntico a inexistente, en lectura y escritura', async () => {
      const zone = repo.addZone({ branchId: A, municipalityId: MUN_MIXCO });
      const auth = await asStaff({ branchId: B });
      const cases: [string, string, unknown?][] = [
        ['get', `/v1/admin/delivery-zones/${zone.id}`],
        ['patch', `/v1/admin/delivery-zones/${zone.id}`, { expectedVersion: 1, baseFee: '1' }],
        ['patch', `/v1/admin/delivery-zones/${zone.id}/status`, { active: false }],
        ['post', '/v1/admin/delivery-zones', zoneBody()],
        ['get', `/v1/admin/delivery-zones?branchId=${A}`],
        ['get', `/v1/admin/branches/${A}/delivery-settings`],
        ['patch', `/v1/admin/branches/${A}/delivery-settings`, { pedidosyaEnabled: false }],
      ];
      const missing: [string, string, unknown?][] = [
        ['get', `/v1/admin/delivery-zones/${MISSING}`],
        ['patch', `/v1/admin/delivery-zones/${MISSING}`, { expectedVersion: 1, baseFee: '1' }],
        ['patch', `/v1/admin/delivery-zones/${MISSING}/status`, { active: false }],
        ['post', '/v1/admin/delivery-zones', zoneBody({ branchId: MISSING })],
        ['get', `/v1/admin/delivery-zones?branchId=${MISSING}`],
        ['get', `/v1/admin/branches/${MISSING}/delivery-settings`],
        ['patch', `/v1/admin/branches/${MISSING}/delivery-settings`, { pedidosyaEnabled: false }],
      ];
      for (const [i, [method, url, body]] of cases.entries()) {
        const other = await call(method, url, auth, body).expect(404);
        const [mMethod, mUrl, mBody] = missing[i]!;
        const gone = await call(mMethod, mUrl, auth, mBody).expect(404);
        expect(other.body).toEqual({
          ...(gone.body as object),
          requestId: (other.body as { requestId: string }).requestId,
        });
        expect(other.headers['cache-control']).toBe('no-store');
      }
      expect(repo.audit).toHaveLength(0);
      expect(repo.zones.get(zone.id)?.active).toBe(true);
    });

    it('listado sin branchId solo devuelve las sucursales del alcance', async () => {
      repo.addZone({ branchId: A, municipalityId: MUN_MIXCO });
      repo.addZone({ branchId: B, municipalityId: MUN_MIXCO });
      const auth = await asStaff({ branchId: B });
      const res = await call('get', '/v1/admin/delivery-zones', auth).expect(200);
      expect((res.body as { items: { branchId: string }[] }).items.map((z) => z.branchId)).toEqual([
        B,
      ]);
    });
  });

  describe('zonas: flujo y validaciones', () => {
    it('crea (201), lee, edita con version, desactiva y lista: contrato, tarifa string y no-store', async () => {
      const auth = await asStaff();
      const created = await call('post', '/v1/admin/delivery-zones', auth, zoneBody()).expect(201);
      expect(created.headers['cache-control']).toBe('no-store');
      expect(created.body).toMatchObject({
        branchId: A,
        municipalityId: MUN_MIXCO,
        municipalityName: 'Mixco',
        departmentName: 'Guatemala',
        zoneLabel: 'Zona 4',
        baseFee: '15.00',
        currency: 'GTQ',
        active: true,
        version: 1,
      });
      const id = (created.body as { id: string }).id;
      const got = await call('get', `/v1/admin/delivery-zones/${id}`, auth).expect(200);
      expect(got.body).toEqual(created.body);
      const upd = await call('patch', `/v1/admin/delivery-zones/${id}`, auth, {
        expectedVersion: 1,
        baseFee: '16.5',
      }).expect(200);
      expect(upd.body).toMatchObject({ baseFee: '16.50', version: 2 });
      const off = await call('patch', `/v1/admin/delivery-zones/${id}/status`, auth, {
        active: false,
        reason: 'Temporal',
      }).expect(200);
      expect(off.body).toMatchObject({ active: false, version: 3 });
      const list = await call(
        'get',
        '/v1/admin/delivery-zones?active=false&pageSize=5',
        auth,
      ).expect(200);
      expect(list.body).toMatchObject({ page: 1, pageSize: 5, total: 1 });
      expect(repo.audit.map((a) => a.action)).toEqual([
        'delivery_zone.created',
        'delivery_zone.updated',
        'delivery_zone.status_changed',
      ]);
      // La tarifa viaja siempre como string, nunca como número.
      expect(typeof (list.body as { items: { baseFee: unknown }[] }).items[0]?.baseFee).toBe(
        'string',
      );
    });

    it('baseFee como número JSON, 3 decimales, negativo o fuera de rango => 400 sin escribir', async () => {
      const auth = await asStaff();
      for (const baseFee of [15, 15.5, '15.001', '-1', '100000', '1e2', null, '', true]) {
        await call('post', '/v1/admin/delivery-zones', auth, zoneBody({ baseFee })).expect(400);
      }
      expect(repo.zones.size).toBe(0);
      expect(repo.audit).toHaveLength(0);
    });

    it('propiedades desconocidas o inmutables (branchId/municipalityId/active en PATCH, version, id) => 400', async () => {
      const auth = await asStaff();
      const z = repo.addZone({ branchId: A, municipalityId: MUN_MIXCO });
      for (const extra of [
        { branchId: B },
        { municipalityId: MUN_VN },
        { active: false },
        { version: 9 },
        { id: MISSING },
        { createdAt: '2020-01-01T00:00:00Z' },
      ]) {
        await call('patch', `/v1/admin/delivery-zones/${z.id}`, auth, {
          expectedVersion: 1,
          baseFee: '1',
          ...extra,
        }).expect(400);
      }
      await call('post', '/v1/admin/delivery-zones', auth, zoneBody({ version: 3 })).expect(400);
      expect(repo.zones.get(z.id)).toMatchObject({ version: 1, baseFee: '15.00' });
    });

    it('PATCH: expectedVersion ausente, como string o 0, y sin zoneLabel/baseFee => 400', async () => {
      const auth = await asStaff();
      const z = repo.addZone({ branchId: A, municipalityId: MUN_MIXCO });
      const url = `/v1/admin/delivery-zones/${z.id}`;
      for (const body of [
        { baseFee: '1' },
        { expectedVersion: '1', baseFee: '1' },
        { expectedVersion: 0, baseFee: '1' },
        { expectedVersion: 1.5, baseFee: '1' },
        { expectedVersion: 1 },
      ]) {
        await call('patch', url, auth, body).expect(400);
      }
    });

    it('UUID inválidos en ruta, cuerpo y consulta => 400; paginación fuera de rango => 400', async () => {
      const auth = await asStaff();
      await call('get', '/v1/admin/delivery-zones/no-uuid', auth).expect(400);
      await call('patch', '/v1/admin/delivery-zones/x/status', auth, { active: true }).expect(400);
      await call('get', '/v1/admin/branches/x/delivery-settings', auth).expect(400);
      await call('post', '/v1/admin/delivery-zones', auth, zoneBody({ branchId: 'x' })).expect(400);
      for (const q of [
        'branchId=x',
        'page=0',
        'pageSize=101',
        'page=10001',
        'sort=hack',
        'active=quizas',
        'q=' + 'a'.repeat(61),
      ]) {
        await call('get', `/v1/admin/delivery-zones?${q}`, auth).expect(400);
      }
    });

    it('zoneLabel demasiado larga o con caracteres de control => 400; en blanco = cobertura general', async () => {
      const auth = await asStaff();
      await call(
        'post',
        '/v1/admin/delivery-zones',
        auth,
        zoneBody({ zoneLabel: 'z'.repeat(61) }),
      ).expect(400);
      await call(
        'post',
        '/v1/admin/delivery-zones',
        auth,
        zoneBody({ zoneLabel: 'Zona\u0000' }),
      ).expect(400);
      const general = await call(
        'post',
        '/v1/admin/delivery-zones',
        auth,
        zoneBody({ zoneLabel: '   ' }),
      ).expect(201);
      expect((general.body as { zoneLabel: unknown }).zoneLabel).toBeNull();
    });

    it('duplicados => 409 con code y violations; conflicto de versión => 409; municipio inexistente => 422', async () => {
      const auth = await asStaff();
      const first = await call('post', '/v1/admin/delivery-zones', auth, zoneBody()).expect(201);
      const dup = await call(
        'post',
        '/v1/admin/delivery-zones',
        auth,
        zoneBody({ zoneLabel: ' zóna  4' }),
      ).expect(409);
      expect(dup.body).toMatchObject({
        statusCode: 409,
        error: 'CONFLICT',
        code: 'DELIVERY_ZONE_DUPLICATE',
        violations: [
          { path: `deliveryZones/${(first.body as { id: string }).id}`, code: 'DUPLICATE_ZONE' },
        ],
      });
      const id = (first.body as { id: string }).id;
      await call('patch', `/v1/admin/delivery-zones/${id}`, auth, {
        expectedVersion: 1,
        baseFee: '2',
      }).expect(200);
      const stale = await call('patch', `/v1/admin/delivery-zones/${id}`, auth, {
        expectedVersion: 1,
        baseFee: '3',
      }).expect(409);
      expect(stale.body).toMatchObject({ code: 'DELIVERY_ZONE_VERSION_CONFLICT' });
      expect(stale.headers['cache-control']).toBe('no-store');
      const noMun = await call(
        'post',
        '/v1/admin/delivery-zones',
        auth,
        zoneBody({ municipalityId: MUN_MISSING }),
      ).expect(422);
      expect(noMun.body).toMatchObject({
        code: 'MUNICIPALITY_NOT_FOUND',
        violations: [{ path: 'municipalityId' }],
      });
    });

    it('carrera de duplicados (23505): 409, nunca 500', async () => {
      const auth = await asStaff();
      repo.beforeInsert = () => {
        repo.beforeInsert = null;
        repo.commitConcurrently({
          branchId: A,
          municipalityId: MUN_MIXCO,
          zoneLabel: 'Zona 4',
          zoneKey: 'zona 4',
        });
      };
      const res = await call('post', '/v1/admin/delivery-zones', auth, zoneBody()).expect(409);
      expect(res.body).toMatchObject({ code: 'DELIVERY_ZONE_DUPLICATE' });
    });

    it('error de BD inesperado => 500 genérico sin code ni detalle interno', async () => {
      const auth = await asStaff();
      repo.failNextWriteWith = new Error('relation "app.delivery_zones" password=secret');
      const res = await call('post', '/v1/admin/delivery-zones', auth, zoneBody()).expect(500);
      expect(res.text).not.toMatch(/secret|app\.delivery_zones/);
      expect(res.body).not.toHaveProperty('code');
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('delivery settings', () => {
    it('GET sin fila = defaults; PATCH crea; PATCH vacío o con campos extra => 400', async () => {
      const auth = await asStaff();
      const url = `/v1/admin/branches/${A}/delivery-settings`;
      const def = await call('get', url, auth).expect(200);
      expect(def.body).toEqual({
        branchId: A,
        ownDeliveryZonesEnabled: false,
        pedidosyaEnabled: true,
        pedidosyaIntegrationStatus: 'BLOCKED_EXTERNAL',
        isDefault: true,
        updatedAt: null,
      });
      const saved = await call('patch', url, auth, { ownDeliveryZonesEnabled: true }).expect(200);
      expect(saved.body).toMatchObject({ ownDeliveryZonesEnabled: true, isDefault: false });
      for (const body of [
        {},
        { pedidosyaEnabled: 'si' },
        { pedidosyaIntegrationStatus: 'LIVE' },
        { isDefault: false },
      ]) {
        await call('patch', url, auth, body).expect(400);
      }
      expect(repo.audit.map((a) => a.action)).toEqual(['branch_delivery_settings.updated']);
    });

    it('sucursal inactiva se consulta y se edita', async () => {
      const auth = await asStaff();
      await call('get', `/v1/admin/branches/${INACTIVE}/delivery-settings`, auth).expect(200);
      await call('patch', `/v1/admin/branches/${INACTIVE}/delivery-settings`, auth, {
        pedidosyaEnabled: false,
      }).expect(200);
    });
  });

  describe('POST /v1/delivery-coverage/check (público)', () => {
    const check = (body: unknown) =>
      http()
        .post('/v1/delivery-coverage/check')
        .send(body as object);
    const valid = { branchId: A, municipalityId: MUN_MIXCO };

    it('sin autenticación: no-store, estado por defecto E (PEDIDOSYA UNKNOWN/BLOCKED_EXTERNAL, PENDING)', async () => {
      const res = await check(valid).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        branchId: A,
        municipalityId: MUN_MIXCO,
        zone: null,
        providers: {
          PEDIDOSYA: {
            enabled: true,
            coverageStatus: 'UNKNOWN',
            integrationStatus: 'BLOCKED_EXTERNAL',
            quoteStatus: 'NOT_AVAILABLE',
          },
          OWN: { enabled: false, coverageStatus: 'UNAVAILABLE', baseFee: null, currency: 'GTQ' },
        },
        eligibility: {
          status: 'PENDING',
          confirmedProviders: [],
          pendingProviders: ['PEDIDOSYA'],
          simulated: false,
        },
      });
      expect(JSON.stringify(res.body)).not.toContain('covered');
    });

    it('zonas propias reales: tarifa del servidor, prioridad y zona normalizada; no crea ni cambia nada', async () => {
      repo.setSettings(A, { ownDeliveryZonesEnabled: true });
      repo.addZone({ branchId: A, municipalityId: MUN_MIXCO, baseFee: '25.00' });
      const z4 = repo.addZone({
        branchId: A,
        municipalityId: MUN_MIXCO,
        zoneLabel: 'Zona 4',
        zoneKey: 'zona 4',
        baseFee: '12.00',
      });
      const before = JSON.stringify([...repo.zones.values()]);
      const res = await check({ ...valid, zone: '  zóna 4 ' }).expect(200);
      expect(res.body).toMatchObject({
        zone: 'zóna 4',
        providers: {
          OWN: {
            enabled: true,
            coverageStatus: 'AVAILABLE',
            deliveryZoneId: z4.id,
            baseFee: '12.00',
            matchedBy: 'ZONE',
          },
        },
        eligibility: {
          status: 'CONFIRMED',
          confirmedProviders: ['OWN'],
          pendingProviders: ['PEDIDOSYA'],
        },
      });
      expect(JSON.stringify([...repo.zones.values()])).toBe(before);
      expect(repo.audit).toHaveLength(0);
    });

    it('no acepta costos ni propiedades extra del cliente (fee, deliveryFee, total, baseFee, covered) => 400', async () => {
      for (const extra of [
        { fee: 1 },
        { deliveryFee: '0.00' },
        { total: 0 },
        { baseFee: '0' },
        { covered: true },
        { providers: {} },
      ]) {
        const res = await check({ ...valid, ...extra }).expect(400);
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });

    it('UUID inválidos, zone no string o demasiado larga/control, cuerpo vacío => 400', async () => {
      for (const body of [
        {},
        { branchId: 'x', municipalityId: MUN_MIXCO },
        { branchId: A, municipalityId: 'x' },
        { ...valid, zone: 5 },
        { ...valid, zone: 'z'.repeat(201) },
        { ...valid, zone: 'z'.repeat(61) },
        { ...valid, zone: 'Zona\u0000' },
      ]) {
        await check(body).expect(400);
      }
    });

    it('sucursal inexistente o inactiva => 422 BRANCH_NOT_AVAILABLE idéntico; municipio inexistente => 422', async () => {
      const missing = await check({ ...valid, branchId: MISSING }).expect(422);
      const inactive = await check({ ...valid, branchId: INACTIVE }).expect(422);
      expect(missing.body).toMatchObject({
        code: 'BRANCH_NOT_AVAILABLE',
        violations: [{ path: 'branchId' }],
      });
      expect({ ...missing.body, requestId: 'x' }).toEqual({ ...inactive.body, requestId: 'x' });
      const mun = await check({ ...valid, municipalityId: MUN_MISSING }).expect(422);
      expect(mun.body).toMatchObject({
        code: 'MUNICIPALITY_NOT_FOUND',
        violations: [{ path: 'municipalityId' }],
      });
      expect(mun.headers['cache-control']).toBe('no-store');
    });

    it('PedidosYa deshabilitado => enabled=false, PROVIDER_DISABLED y sin pendientes', async () => {
      repo.setSettings(A, { pedidosyaEnabled: false });
      const res = await check(valid).expect(200);
      expect(res.body).toMatchObject({
        providers: { PEDIDOSYA: { enabled: false, reason: 'PROVIDER_DISABLED' } },
        eligibility: { status: 'NONE', pendingProviders: [] },
      });
    });
  });

  describe('selección del adaptador por configuración', () => {
    it('mock en desarrollo: escenario available => integrationStatus MOCK, simulated=true, CONFIRMED', async () => {
      await app.close();
      app = await createApp(keys, db, repo, {
        PEDIDOSYA_COVERAGE_ADAPTER: 'mock',
        PEDIDOSYA_MOCK_SCENARIO: 'available',
      });
      const res = await http()
        .post('/v1/delivery-coverage/check')
        .send({ branchId: A, municipalityId: MUN_MIXCO })
        .expect(200);
      expect(res.body).toMatchObject({
        providers: { PEDIDOSYA: { coverageStatus: 'AVAILABLE', integrationStatus: 'MOCK' } },
        eligibility: { status: 'CONFIRMED', confirmedProviders: ['PEDIDOSYA'], simulated: true },
      });
      const auth = await asStaff();
      const settings = await call('get', `/v1/admin/branches/${A}/delivery-settings`, auth).expect(
        200,
      );
      expect(
        (settings.body as { pedidosyaIntegrationStatus: string }).pedidosyaIntegrationStatus,
      ).toBe('MOCK');
    });
  });
});
