import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  bid,
  bpid,
  fakeProduct,
  FakeBranchProductsRepo,
} from './support/fake-branch-products-repo.js';
import { branchDelegate, FakeStoreCatalogRepo } from './support/fake-store-catalog-repo.js';
import { CAT, seedCategories } from './support/products-harness.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const A = bid(1);
const B = bid(2);
const INACTIVE = bid(3);
const P1 = bpid(1);
const P2 = bpid(2); // categoría oculta
const P3 = bpid(3); // inactivo
const MISSING = bpid(99);
const ALL_PERMS = ['catalog.read', 'catalog.update', 'catalog.manage_availability'];

function fakeDb(categories: ReturnType<typeof seedCategories>) {
  const db = {
    category: { findMany: vi.fn(() => Promise.resolve(categories.map((c) => ({ ...c })))) },
    customer: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
    staffUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: unknown) => unknown)(db)
        : Promise.all(arg as unknown[]),
    ),
    $disconnect: () => Promise.resolve(),
  };
  return db;
}

interface Assignment {
  branchId: string | null;
  permissions: string[];
  branchActive?: boolean;
}

function staffRow(assignments: Assignment[]) {
  return {
    id: STAFF_ID,
    fullName: 'Ana Admin',
    active: true,
    assignments: assignments.map((a, i) => ({
      active: true,
      branchId: a.branchId,
      branch: a.branchId
        ? { id: a.branchId, name: `Sucursal ${i}`, code: `s-${i}`, active: a.branchActive ?? true }
        : null,
      role: {
        code: `rol-${i}`,
        permissions: a.permissions.map((code) => ({ permission: { code } })),
      },
    })),
  };
}

async function createApp(
  keys: TestKeys,
  db: ReturnType<typeof fakeDb>,
  repo: FakeBranchProductsRepo,
) {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:54341',
    HEALTH_READY_TOKEN: 'token-e2e-123456789',
    RATE_LIMIT_MAX: '1000',
  });
  vi.resetModules();
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { PrismaService } = await import('../src/database/prisma.service.js');
  const { JWKS_RESOLVER } = await import('../src/auth/jwt-verifier.service.js');
  const { BranchProductsRepository } =
    await import('../src/branch-products/branch-products.repository.js');
  const { StoreCatalogRepository } = await import('../src/store/store-catalog.repository.js');
  const { PromotionsRepository } = await import('../src/promotions/promotions.repository.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .overrideProvider(BranchProductsRepository)
    .useValue(repo)
    .overrideProvider(PromotionsRepository)
    .useValue({ findCandidates: () => Promise.resolve([]) })
    .overrideProvider(StoreCatalogRepository)
    .useValue(new FakeStoreCatalogRepo(repo))
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

type Body = Record<string, unknown>;
interface Row {
  productId: string;
  branchId: string;
  price: string;
  available: boolean;
  offered: boolean;
}
interface Json {
  code: string;
  total: number;
  offered: boolean;
  violations: { path: string }[];
  items: Row[];
}
const json = (res: request.Response) => res.body as Json;

describe('Precio y disponibilidad por sucursal (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  let repo: FakeBranchProductsRepo;
  const http = () => request(app.getHttpServer());
  const bearer = async (claims?: Parameters<TestKeys['sign']>[0]) =>
    `Bearer ${await keys.sign(claims)}`;
  const asStaff = async (assignments: Assignment[], claims: Record<string, unknown> = AAL2) => {
    db.staffUser.findUnique.mockResolvedValue(staffRow(assignments));
    return bearer(claims);
  };
  const admin = () => asStaff([{ branchId: null, permissions: ALL_PERMS }]);

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    keys = await createTestKeys();
  });

  beforeEach(async () => {
    db = fakeDb(seedCategories());
    repo = new FakeBranchProductsRepo();
    Object.assign(db, { branch: branchDelegate(repo) });
    repo.seedBranch(A, { name: 'Zona 10' });
    repo.seedBranch(B, { name: 'Antigua' });
    repo.seedBranch(INACTIVE, { active: false, name: 'Cerrada' });
    repo.seedProduct(fakeProduct(1, { name: 'Roll California', slug: 'roll-california' }));
    repo.seedProduct(
      fakeProduct(2, { name: 'Té caliente', slug: 'te-caliente', categoryId: CAT.calientes }),
    );
    repo.seedProduct(fakeProduct(3, { name: 'Viejo', slug: 'viejo', active: false }));
    app = await createApp(keys, db, repo);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('autenticación y autorización', () => {
    const OPS: [string, string, Body?][] = [
      ['get', `/v1/admin/branches/${A}/products`],
      ['get', `/v1/admin/products/${P1}/branches`],
      ['put', `/v1/admin/branches/${A}/products/${P1}/pricing`, { priceOverride: '10.00' }],
      ['patch', `/v1/admin/products/${P1}/availability`, { branchId: A, available: false }],
    ];
    const call = (method: string, url: string, auth?: string, body?: Body) => {
      const r = (http() as unknown as Record<string, (u: string) => request.Test>)[method]!(url);
      if (auth) r.set('Authorization', auth);
      return body ? r.send(body) : r;
    };

    it.each(OPS)('sin JWT => 401 (%s %s)', async (method, url, body) => {
      await call(method, url, undefined, body).expect(401);
    });

    it.each(OPS)('cliente (no personal) => 403 (%s %s)', async (method, url, body) => {
      await call(method, url, await bearer(), body).expect(403);
    });

    it.each(OPS)(
      'personal con sesión aal1 => 403 sin escribir (%s %s)',
      async (method, url, body) => {
        const auth = await asStaff([{ branchId: null, permissions: ALL_PERMS }], { aal: 'aal1' });
        await call(method, url, auth, body).expect(403);
        expect(repo.rows.size).toBe(0);
      },
    );

    it('cada operación exige SU permiso', async () => {
      const readOnly = await asStaff([{ branchId: null, permissions: ['catalog.read'] }]);
      await call('put', OPS[2]![1], readOnly, OPS[2]![2]).expect(403);
      await call('patch', OPS[3]![1], readOnly, OPS[3]![2]).expect(403);
      await call('get', OPS[0]![1], readOnly).expect(200);
      const noRead = await asStaff([{ branchId: null, permissions: ['catalog.update'] }]);
      await call('get', OPS[0]![1], noRead).expect(403);
      await call('get', OPS[1]![1], noRead).expect(403);
    });

    it('manager (catalog.manage_availability sin catalog.update) puede agotar pero NO fijar precio', async () => {
      const manager = await asStaff([
        { branchId: A, permissions: ['catalog.read', 'catalog.manage_availability'] },
      ]);
      await call('patch', OPS[3]![1], manager, { branchId: A, available: false }).expect(200);
      expect(repo.rowOf(A, P1)?.available).toBe(false);
      await call('put', OPS[2]![1], manager, { priceOverride: '10.00' }).expect(403);
      expect(repo.rowOf(A, P1)?.priceOverride).toBeNull();
    });

    it('IDOR: empleado de la sucursal A no ve ni modifica B (404 BRANCH_NOT_FOUND, igual a inexistente)', async () => {
      const staffA = await asStaff([{ branchId: A, permissions: ALL_PERMS }]);
      const list = await call('get', `/v1/admin/branches/${B}/products`, staffA).expect(404);
      const missing = await call(
        'get',
        `/v1/admin/branches/${bid(99)}/products`,
        await admin(),
      ).expect(404);
      expect(json(list).code).toBe('BRANCH_NOT_FOUND');
      expect({ ...list.body, requestId: 0 }).toEqual({ ...missing.body, requestId: 0 });
      const staffA2 = await asStaff([{ branchId: A, permissions: ALL_PERMS }]);
      const put = await call('put', `/v1/admin/branches/${B}/products/${P1}/pricing`, staffA2, {
        priceOverride: '1.00',
      }).expect(404);
      expect(json(put).code).toBe('BRANCH_NOT_FOUND');
      const patch = await call('patch', `/v1/admin/products/${P1}/availability`, staffA2, {
        branchId: B,
        available: false,
      }).expect(404);
      expect(json(patch).code).toBe('BRANCH_NOT_FOUND');
      expect(repo.rows.size).toBe(0);
      expect(repo.audit).toHaveLength(0);
    });

    it('sucursal INACTIVA: alcance global puede configurarla; el empleado acotado no (grants solo con sucursales activas)', async () => {
      const global = await admin();
      await call('put', `/v1/admin/branches/${INACTIVE}/products/${P1}/pricing`, global, {
        priceOverride: '12.00',
      }).expect(200);
      await call('patch', `/v1/admin/products/${P1}/availability`, global, {
        branchId: INACTIVE,
        available: false,
      }).expect(200);
      expect(repo.rowOf(INACTIVE, P1)).toMatchObject({ priceOverride: '12.00', available: false });
      // acotado: asignado a A (activa) y a INACTIVE (inactiva => sin grants sobre ella)
      const scoped = await asStaff([
        { branchId: A, permissions: ALL_PERMS },
        { branchId: INACTIVE, permissions: ALL_PERMS, branchActive: false },
      ]);
      for (const res of [
        await call('put', `/v1/admin/branches/${INACTIVE}/products/${P3}/pricing`, scoped, {
          priceOverride: '1.00',
        }).expect(404),
        await call('patch', `/v1/admin/products/${P3}/availability`, scoped, {
          branchId: INACTIVE,
          available: false,
        }).expect(404),
        await call('get', `/v1/admin/branches/${INACTIVE}/products`, scoped).expect(404),
      ]) {
        expect(json(res).code).toBe('BRANCH_NOT_FOUND');
      }
      expect(repo.rowOf(INACTIVE, P3)).toBeUndefined();
    });

    it('orden de errores: 400 (forma) > 404 sucursal > 404 producto > 422 (regla)', async () => {
      const scoped = await asStaff([{ branchId: A, permissions: ALL_PERMS }]);
      const put = (b: string, p: string, body: Body, auth: string) =>
        call('put', `/v1/admin/branches/${b}/products/${p}/pricing`, auth, body);
      await put(B, MISSING, { priceOverride: 85 }, scoped).expect(400);
      expect(json(await put(B, MISSING, { priceOverride: '0.00' }, scoped).expect(404)).code).toBe(
        'BRANCH_NOT_FOUND',
      );
      const global = await admin();
      expect(json(await put(A, MISSING, { priceOverride: '0.00' }, global).expect(404)).code).toBe(
        'PRODUCT_NOT_FOUND',
      );
      expect(json(await put(A, P1, { priceOverride: '0.00' }, global).expect(422)).code).toBe(
        'BRANCH_PRICE_INVALID',
      );
    });

    it('la matriz por producto solo incluye sucursales del alcance', async () => {
      repo.seedRow(B, P1, { priceOverride: '77.00' });
      const staffA = await asStaff([{ branchId: A, permissions: ALL_PERMS }]);
      const res = await call('get', `/v1/admin/products/${P1}/branches`, staffA).expect(200);
      expect((json(res).items as { branchId: string }[]).map((i) => i.branchId)).toEqual([A]);
      expect(JSON.stringify(res.body)).not.toContain('77.00');
      const all = await call('get', `/v1/admin/products/${P1}/branches`, await admin()).expect(200);
      expect((json(all).items as { branchId: string }[]).map((i) => i.branchId)).toEqual([
        B,
        INACTIVE,
        A,
      ]); // Antigua, Cerrada, Zona 10
    });
  });

  describe('GET /v1/admin/branches/:id/products', () => {
    it('lista paginada con filtros, no-store y estado completo', async () => {
      repo.seedRow(A, P1, { priceOverride: '45.00' });
      const res = await http()
        .get(`/v1/admin/branches/${A}/products?pageSize=2&page=1`)
        .set('Authorization', await admin())
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ branchId: A, page: 1, pageSize: 2, total: 3 });
      expect(json(res).items[0]).toMatchObject({
        productId: P1,
        basePrice: '50.00',
        priceOverride: '45.00',
        effectivePrice: '45.00',
        offered: true,
        publiclyVisible: true,
        category: { id: CAT.frios },
      });
      const filtered = await http()
        .get(`/v1/admin/branches/${A}/products?hasOverride=true&available=true&q=california`)
        .set('Authorization', await admin())
        .expect(200);
      expect(json(filtered).total).toBe(1);
    });

    it('400: UUID inválido, pageSize > 100, page > 200, q > 80, booleano inválido', async () => {
      const auth = await admin();
      for (const url of [
        '/v1/admin/branches/x/products',
        `/v1/admin/branches/${A}/products?pageSize=101`,
        `/v1/admin/branches/${A}/products?page=201`,
        `/v1/admin/branches/${A}/products?q=${'x'.repeat(81)}`,
        `/v1/admin/branches/${A}/products?available=quizas`,
        `/v1/admin/branches/${A}/products?categoryId=no`,
      ]) {
        await http().get(url).set('Authorization', auth).expect(400);
      }
    });

    it('sucursal inactiva se puede consultar con alcance global', async () => {
      await http()
        .get(`/v1/admin/branches/${INACTIVE}/products`)
        .set('Authorization', await admin())
        .expect(200);
    });
  });

  describe('GET /v1/admin/products/:id/branches', () => {
    it('devuelve una fila por sucursal con override y disponibilidad', async () => {
      repo.seedRow(A, P1, { priceOverride: '45.00', available: false });
      const res = await http()
        .get(`/v1/admin/products/${P1}/branches`)
        .set('Authorization', await admin())
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ productId: P1, basePrice: '50.00', publiclyVisible: true });
      const rowA = (json(res).items as { branchId: string }[]).find((i) => i.branchId === A);
      expect(rowA).toMatchObject({
        priceOverride: '45.00',
        available: false,
        offered: false,
        branchName: 'Zona 10',
        branchActive: true,
      });
    });

    it('404 PRODUCT_NOT_FOUND y 400 UUID inválido', async () => {
      const auth = await admin();
      const nf = await http()
        .get(`/v1/admin/products/${MISSING}/branches`)
        .set('Authorization', auth)
        .expect(404);
      expect(json(nf).code).toBe('PRODUCT_NOT_FOUND');
      await http().get('/v1/admin/products/x/branches').set('Authorization', auth).expect(400);
    });
  });

  describe('PUT /v1/admin/branches/:id/products/:productId/pricing', () => {
    const url = (b = A, p = P1) => `/v1/admin/branches/${b}/products/${p}/pricing`;

    it('fija y elimina el override; auditoría sin PII; no-store', async () => {
      const auth = await admin();
      const set = await http()
        .put(url())
        .set('Authorization', auth)
        .send({ priceOverride: '45.50' })
        .expect(200);
      expect(set.headers['cache-control']).toBe('no-store');
      expect(set.body).toMatchObject({
        branchId: A,
        productId: P1,
        priceOverride: '45.50',
        effectivePrice: '45.50',
        basePrice: '50.00',
      });
      expect(repo.audit).toHaveLength(1);
      expect(repo.audit[0]).toMatchObject({ action: 'branch_product.price_set', branchId: A });
      expect(JSON.stringify(repo.audit)).not.toMatch(/Ana Admin|email|@/);
      const clear = await http()
        .put(url())
        .set('Authorization', auth)
        .send({ priceOverride: null })
        .expect(200);
      expect(clear.body).toMatchObject({
        priceOverride: null,
        effectivePrice: '50.00',
        updatedAt: null,
      });
      expect(repo.rowOf(A, P1)).toBeUndefined();
      expect(repo.audit.map((a) => a.action)).toEqual([
        'branch_product.price_set',
        'branch_product.price_cleared',
      ]);
    });

    it('idempotente: repetir no escribe ni audita de nuevo', async () => {
      const auth = await admin();
      await http()
        .put(url())
        .set('Authorization', auth)
        .send({ priceOverride: '45.50' })
        .expect(200);
      await http()
        .put(url())
        .set('Authorization', auth)
        .send({ priceOverride: '45.50' })
        .expect(200);
      expect(repo.audit).toHaveLength(1);
      expect(repo.count('upsertPrice')).toBe(1);
    });

    it('400: precio número, sin decimales, > 999999.99, negativo, ausente o campo extra', async () => {
      const auth = await admin();
      for (const body of [
        { priceOverride: 85 },
        { priceOverride: '85' },
        { priceOverride: '1000000.00' },
        { priceOverride: '-1.00' },
        {},
        { priceOverride: '10.00', extra: 1 },
      ]) {
        await http().put(url()).set('Authorization', auth).send(body).expect(400);
      }
      await http()
        .put(url('x'))
        .set('Authorization', auth)
        .send({ priceOverride: null })
        .expect(400);
      expect(repo.rows.size).toBe(0);
    });

    it('"0.00" => 422 BRANCH_PRICE_INVALID con violations[0]?.path', async () => {
      const res = await http()
        .put(url())
        .set('Authorization', await admin())
        .send({ priceOverride: '0.00' })
        .expect(422);
      expect(json(res).code).toBe('BRANCH_PRICE_INVALID');
      expect(json(res).violations[0]?.path).toBe('priceOverride');
    });

    it('404: producto inexistente PRODUCT_NOT_FOUND; sucursal inexistente BRANCH_NOT_FOUND', async () => {
      const auth = await admin();
      const p = await http()
        .put(url(A, MISSING))
        .set('Authorization', auth)
        .send({ priceOverride: '1.00' })
        .expect(404);
      expect(json(p).code).toBe('PRODUCT_NOT_FOUND');
      const b = await http()
        .put(url(bid(99)))
        .set('Authorization', auth)
        .send({ priceOverride: '1.00' })
        .expect(404);
      expect(json(b).code).toBe('BRANCH_NOT_FOUND');
    });

    it('producto inactivo u oculto admite precio', async () => {
      const auth = await admin();
      await http()
        .put(url(A, P3))
        .set('Authorization', auth)
        .send({ priceOverride: '5.00' })
        .expect(200);
      const hidden = await http()
        .put(url(A, P2))
        .set('Authorization', auth)
        .send({ priceOverride: '5.00' })
        .expect(200);
      expect(json(hidden).offered).toBe(false);
    });

    it('timeout de la transacción => 503 BRANCH_PRODUCTS_BUSY con code público', async () => {
      repo.failTransactionWith = { code: 'P2028' };
      const res = await http()
        .put(url())
        .set('Authorization', await admin())
        .send({ priceOverride: '1.00' })
        .expect(503);
      expect(json(res).code).toBe('BRANCH_PRODUCTS_BUSY');
    });

    it('error interno inesperado => 500 sin code ni detalles', async () => {
      repo.failTransactionWith = new Error('secreto interno');
      const res = await http()
        .put(url())
        .set('Authorization', await admin())
        .send({ priceOverride: '1.00' })
        .expect(500);
      expect(json(res).code).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('secreto');
    });
  });

  describe('PATCH /v1/admin/products/:id/availability', () => {
    const url = (p = P1) => `/v1/admin/products/${p}/availability`;

    it('agota y rehabilita; el menú público lo refleja solo en esa sucursal', async () => {
      const auth = await admin();
      const off = await http()
        .patch(url())
        .set('Authorization', auth)
        .send({ branchId: A, available: false })
        .expect(200);
      expect(off.body).toMatchObject({ available: false, offered: false });
      expect(repo.audit[0]).toMatchObject({ action: 'branch_product.availability_changed' });
      const menuA = await http().get(`/v1/store/menu?branchId=${A}`).expect(200);
      const menuB = await http().get(`/v1/store/menu?branchId=${B}`).expect(200);
      expect(json(menuA).items[0]?.available).toBe(false);
      expect(json(menuB).items[0]?.available).toBe(true);
      await http()
        .patch(url())
        .set('Authorization', auth)
        .send({ branchId: A, available: true })
        .expect(200);
      expect(repo.rowOf(A, P1)).toBeUndefined();
    });

    it('idempotente', async () => {
      const auth = await admin();
      await http()
        .patch(url())
        .set('Authorization', auth)
        .send({ branchId: A, available: true })
        .expect(200);
      expect(repo.audit).toHaveLength(0);
      expect(repo.count('upsertAvailability')).toBe(0);
    });

    it('400: sin branchId, available no booleano, UUID inválido, campo extra', async () => {
      const auth = await admin();
      for (const body of [
        { available: false },
        { branchId: A },
        { branchId: A, available: 'no' },
        { branchId: 'x', available: false },
        { branchId: A, available: false, x: 1 },
      ]) {
        await http().patch(url()).set('Authorization', auth).send(body).expect(400);
      }
      await http()
        .patch('/v1/admin/products/x/availability')
        .set('Authorization', auth)
        .send({ branchId: A, available: false })
        .expect(400);
    });

    it('404 PRODUCT_NOT_FOUND y 503 BRANCH_PRODUCTS_BUSY', async () => {
      const auth = await admin();
      const nf = await http()
        .patch(url(MISSING))
        .set('Authorization', auth)
        .send({ branchId: A, available: false })
        .expect(404);
      expect(json(nf).code).toBe('PRODUCT_NOT_FOUND');
      repo.failTransactionWith = { code: '55P03' };
      const busy = await http()
        .patch(url())
        .set('Authorization', auth)
        .send({ branchId: A, available: false })
        .expect(503);
      expect(json(busy).code).toBe('BRANCH_PRODUCTS_BUSY');
    });
  });
});
