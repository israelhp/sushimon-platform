import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  FakeModifiersRepo,
  G,
  groupRow,
  mid,
  OPT,
  optionRow,
  P,
} from './support/fake-modifiers-repo.js';
import { FakeProductsRepo } from './support/fake-products-repo.js';
import { CAT, pid, productRow, seedCategories } from './support/products-harness.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const ALL_PERMS = ['catalog.read', 'catalog.create', 'catalog.update'];
const MISSING = mid(999);

function fakeDb(categories: ReturnType<typeof seedCategories>) {
  const db = {
    category: {
      findMany: vi.fn(() => Promise.resolve(categories.map((c) => ({ ...c })))),
    },
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

function staffRow(assignments: { branchId: string | null; permissions: string[] }[]) {
  return {
    id: STAFF_ID,
    fullName: 'Ana Admin',
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

async function createApp(
  keys: TestKeys,
  db: ReturnType<typeof fakeDb>,
  products: FakeProductsRepo,
  mods: FakeModifiersRepo,
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
  const { ProductsRepository } = await import('../src/products/products.repository.js');
  const { ModifiersRepository } = await import('../src/modifiers/modifiers.repository.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .overrideProvider(ProductsRepository)
    .useValue(products)
    .overrideProvider(ModifiersRepository)
    .useValue(mods)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

interface Body {
  [k: string]: unknown;
}

describe('Modificadores (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  let mods: FakeModifiersRepo;
  let products: FakeProductsRepo;
  const http = () => request(app.getHttpServer());
  const bearer = async (claims?: Parameters<TestKeys['sign']>[0]) =>
    `Bearer ${await keys.sign(claims)}`;
  const asStaff = async (
    over: { permissions?: string[]; branchId?: string | null } = {},
    claims: Record<string, unknown> = AAL2,
  ) => {
    db.staffUser.findUnique.mockResolvedValue(
      staffRow([{ branchId: over.branchId ?? null, permissions: over.permissions ?? ALL_PERMS }]),
    );
    return bearer(claims);
  };

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    keys = await createTestKeys();
  });

  beforeEach(async () => {
    const categories = seedCategories();
    db = fakeDb(categories);
    products = new FakeProductsRepo();
    products.seed(
      productRow(pid(1), {
        name: 'Roll California',
        slug: 'roll-california',
        categoryId: CAT.frios,
      }),
    );
    products.seed(
      productRow(pid(2), { name: 'Roll Vegano', slug: 'roll-vegano', categoryId: CAT.frios }),
    );
    mods = new FakeModifiersRepo();
    mods.seedGroup(groupRow(G.salsas, { name: 'Salsas', minSelect: 1, maxSelect: 2 }), [
      optionRow(OPT(1), G.salsas, { name: 'Soya', extraPrice: '1.50', sortOrder: 0 }),
      optionRow(OPT(2), G.salsas, { name: 'Picante', sortOrder: 1 }),
      optionRow(OPT(3), G.salsas, { name: 'Vieja', sortOrder: 2, active: false }),
    ]);
    mods.seedGroup(groupRow(G.extras, { name: 'Extras', active: false }), [
      optionRow(OPT(4), G.extras),
    ]);
    mods.seedGroup(groupRow(G.vacio, { name: 'Vacio' }), []);
    mods.seedProduct(P.roll, [G.salsas]);
    mods.seedProduct(P.sin, []);
    // la ficha pública usa los ids de producto de `products`: asociamos pid(1) a salsas y extras (inactivo)
    mods.seedProduct(pid(1), [G.extras, G.salsas, G.vacio]);
    mods.seedProduct(pid(2), []);
    app = await createApp(keys, db, products, mods);
  });
  afterEach(async () => {
    await app.close();
  });

  const OPS: [string, string, string][] = [
    ['get', '/v1/admin/modifier-groups', 'listAdminModifierGroups'],
    ['post', '/v1/admin/modifier-groups', 'createAdminModifierGroup'],
    ['get', `/v1/admin/modifier-groups/${G.salsas}`, 'getAdminModifierGroup'],
    ['patch', `/v1/admin/modifier-groups/${G.salsas}`, 'updateAdminModifierGroup'],
    ['post', `/v1/admin/modifier-groups/${G.salsas}/modifiers`, 'createAdminModifier'],
    ['put', `/v1/admin/modifier-groups/${G.salsas}/modifiers/reorder`, 'reorderAdminModifiers'],
    ['patch', `/v1/admin/modifiers/${OPT(1)}`, 'updateAdminModifier'],
    ['get', `/v1/admin/products/${P.roll}/modifiers`, 'getAdminProductModifiers'],
    ['put', `/v1/admin/products/${P.roll}/modifier-groups`, 'replaceAdminProductModifierGroups'],
  ];
  const call = (method: string, url: string, auth?: string, body: object = {}) => {
    const r = (http() as unknown as Record<string, (u: string) => request.Test>)[method]!(url);
    if (auth) void r.set('Authorization', auth);
    return method === 'get' ? r : r.send(body);
  };

  describe('autenticación y autorización', () => {
    it.each(OPS)('sin JWT => 401 (%s %s %s)', async (method, url) => {
      await call(method, url).expect(401);
    });

    it.each(OPS)('cliente (no personal) => 403 (%s %s %s)', async (method, url) => {
      await call(method, url, await bearer()).expect(403);
    });

    it.each(OPS)(
      'personal con sesión aal1 => 403 sin tocar el catálogo (%s %s %s)',
      async (method, url) => {
        const auth = await asStaff({}, { aal: 'aal1' });
        await call(method, url, auth).expect(403);
        expect(mods.calls).toEqual([]);
      },
    );

    it('permisos por operación: solo lectura no escribe; sin catalog.read no lee', async () => {
      const readOnly = await asStaff({ permissions: ['catalog.read'] });
      await http().get('/v1/admin/modifier-groups').set('Authorization', readOnly).expect(200);
      await http()
        .post('/v1/admin/modifier-groups')
        .set('Authorization', readOnly)
        .send({ name: 'X' })
        .expect(403);
      await http()
        .patch(`/v1/admin/modifiers/${OPT(1)}`)
        .set('Authorization', readOnly)
        .send({ active: false })
        .expect(403);
      const noRead = await asStaff({ permissions: ['catalog.update'] });
      await http().get('/v1/admin/modifier-groups').set('Authorization', noRead).expect(403);
    });

    it('alcance por sucursal: lectura OK, escrituras 403 antes de leer (aunque el recurso no exista)', async () => {
      const scoped = await asStaff({ branchId: 'b1b1b1b1-0000-4000-8000-000000000001' });
      await http().get('/v1/admin/modifier-groups').set('Authorization', scoped).expect(200);
      mods.calls.length = 0;
      await http()
        .post('/v1/admin/modifier-groups')
        .set('Authorization', scoped)
        .send({ name: 'X' })
        .expect(403);
      await http()
        .patch(`/v1/admin/modifier-groups/${MISSING}`)
        .set('Authorization', scoped)
        .send({ name: 'X' })
        .expect(403);
      await http()
        .put(`/v1/admin/products/${MISSING}/modifier-groups`)
        .set('Authorization', scoped)
        .send({ groupIds: [] })
        .expect(403);
      expect(mods.calls).toEqual([]);
    });

    it('alcance global: todo funciona; las respuestas admin son no-store', async () => {
      const res = await http()
        .get('/v1/admin/modifier-groups')
        .set('Authorization', await asStaff())
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('lecturas', () => {
    it('lista paginada con conteos, filtros y validaciones 400', async () => {
      const auth = await asStaff();
      const res = await http()
        .get('/v1/admin/modifier-groups?pageSize=2&page=1')
        .set('Authorization', auth)
        .expect(200);
      const body = res.body as { items: Body[]; total: number; pageSize: number };
      expect(body).toMatchObject({ total: 3, pageSize: 2 });
      expect(body.items).toHaveLength(2);
      const salsas = (
        (await http().get('/v1/admin/modifier-groups?q=sals').set('Authorization', auth)).body as {
          items: Body[];
        }
      ).items[0];
      expect(salsas).toMatchObject({
        id: G.salsas,
        optionCount: 3,
        activeOptionCount: 2,
        productCount: 2,
        required: true,
      });
      expect(salsas).not.toHaveProperty('options');
      const inactive = await http()
        .get('/v1/admin/modifier-groups?active=false')
        .set('Authorization', auth)
        .expect(200);
      expect((inactive.body as { total: number }).total).toBe(1);
      for (const q of [
        'pageSize=101',
        'page=0',
        'active=quiza',
        `q=${'a'.repeat(81)}`,
        'extra=1',
      ]) {
        await http().get(`/v1/admin/modifier-groups?${q}`).set('Authorization', auth).expect(400);
      }
      expect(mods.count('findGroupPage')).toBeGreaterThan(0);
    });

    it('detalle con opciones y 404/400', async () => {
      const auth = await asStaff();
      const res = await http()
        .get(`/v1/admin/modifier-groups/${G.salsas}`)
        .set('Authorization', auth)
        .expect(200);
      expect((res.body as { options: Body[] }).options.map((o) => o['name'])).toEqual([
        'Soya',
        'Picante',
        'Vieja',
      ]);
      const nf = await http()
        .get(`/v1/admin/modifier-groups/${MISSING}`)
        .set('Authorization', auth)
        .expect(404);
      expect(nf.body).toMatchObject({ code: 'MODIFIER_GROUP_NOT_FOUND' });
      await http().get('/v1/admin/modifier-groups/no-uuid').set('Authorization', auth).expect(400);
    });

    it('grupos de un producto (2 consultas) y 404 PRODUCT_NOT_FOUND', async () => {
      const auth = await asStaff();
      mods.calls.length = 0;
      const res = await http()
        .get(`/v1/admin/products/${P.roll}/modifiers`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({ productId: P.roll });
      expect((res.body as { groups: Body[] }).groups).toHaveLength(1);
      expect(mods.calls).toEqual(['findProductGroupSummaries', 'findOptionsByGroupIds']);
      const nf = await http()
        .get(`/v1/admin/products/${MISSING}/modifiers`)
        .set('Authorization', auth)
        .expect(404);
      expect(nf.body).toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    });
  });

  describe('escrituras', () => {
    it('POST grupo: 201 con opciones; 409 nombre repetido; 422 límites; 400 forma', async () => {
      const auth = await asStaff();
      const created = await http()
        .post('/v1/admin/modifier-groups')
        .set('Authorization', auth)
        .send({ name: 'Bebidas', minSelect: 1, options: [{ name: 'Té', extraPrice: '2.50' }] })
        .expect(201);
      expect(created.body).toMatchObject({ name: 'Bebidas', required: true, optionCount: 1 });
      expect(mods.audit.map((a) => a['action'])).toEqual([
        'modifier_group.created',
        'modifier.created',
      ]);
      const dup = await http()
        .post('/v1/admin/modifier-groups')
        .set('Authorization', auth)
        .send({ name: 'SALSAS' })
        .expect(409);
      expect(dup.body).toMatchObject({ code: 'MODIFIER_GROUP_NAME_TAKEN' });
      const lim = await http()
        .post('/v1/admin/modifier-groups')
        .set('Authorization', auth)
        .send({ name: 'L', minSelect: 3, maxSelect: 2 })
        .expect(422);
      expect(lim.body).toMatchObject({ code: 'MODIFIER_LIMITS_INVALID' });
      const unreachable = await http()
        .post('/v1/admin/modifier-groups')
        .set('Authorization', auth)
        .send({ name: 'M', minSelect: 1 })
        .expect(422);
      expect(unreachable.body).toMatchObject({ code: 'MODIFIER_LIMITS_INVALID' });
      const many = await http()
        .post('/v1/admin/modifier-groups')
        .set('Authorization', auth)
        .send({ name: 'N', options: Array.from({ length: 31 }, (_, i) => ({ name: `o${i}` })) })
        .expect(422);
      expect(many.body).toMatchObject({ code: 'MODIFIER_LIMIT_REACHED' });
      for (const bad of [
        {},
        { name: '' },
        { name: 'x', minSelect: 1.5 },
        { name: 'x', desconocido: 1 },
        { name: 'x', options: [{ name: 'a', extraPrice: 5 }] },
        { name: 'x', options: [{ name: 'a', extraPrice: '10000.00' }] },
        { name: 'x', options: Array.from({ length: 101 }, (_, i) => ({ name: `o${i}` })) },
      ]) {
        await http()
          .post('/v1/admin/modifier-groups')
          .set('Authorization', auth)
          .send(bad)
          .expect(400);
      }
    });

    it('PATCH grupo: 200, sin cambios no audita, 400 vacío, 404, 409, 422', async () => {
      const auth = await asStaff();
      const url = `/v1/admin/modifier-groups/${G.salsas}`;
      await http().patch(url).set('Authorization', auth).send({ name: 'Salsas' }).expect(200);
      expect(mods.audit).toEqual([]);
      const res = await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ name: 'Salsas 2', active: false })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Salsas 2', active: false });
      expect(mods.audit.map((a) => a['action'])).toEqual([
        'modifier_group.updated',
        'modifier_group.deactivated',
      ]);
      await http().patch(url).set('Authorization', auth).send({}).expect(400);
      await http().patch(url).set('Authorization', auth).send({ otro: 1 }).expect(400);
      await http()
        .patch(`/v1/admin/modifier-groups/${MISSING}`)
        .set('Authorization', auth)
        .send({ name: 'z' })
        .expect(404);
      await http().patch(url).set('Authorization', auth).send({ name: 'extras' }).expect(409);
      const lim = await http()
        .patch(url)
        .set('Authorization', auth)
        .send({ maxSelect: 21 })
        .expect(422);
      expect(lim.body).toMatchObject({ code: 'MODIFIER_LIMITS_INVALID' });
    });

    it('POST opción: 201, 404, 409, 422 tope 30, 400 precio', async () => {
      const auth = await asStaff();
      const url = `/v1/admin/modifier-groups/${G.salsas}/modifiers`;
      const ok = await http()
        .post(url)
        .set('Authorization', auth)
        .send({ name: 'Ajo', extraPrice: '0.10' })
        .expect(201);
      expect(ok.body).toMatchObject({ name: 'Ajo', extraPrice: '0.10', sortOrder: 3 });
      await http()
        .post(`/v1/admin/modifier-groups/${MISSING}/modifiers`)
        .set('Authorization', auth)
        .send({ name: 'Ajo' })
        .expect(404);
      const dup = await http()
        .post(url)
        .set('Authorization', auth)
        .send({ name: 'soya' })
        .expect(409);
      expect(dup.body).toMatchObject({ code: 'MODIFIER_NAME_TAKEN' });
      await http()
        .post(url)
        .set('Authorization', auth)
        .send({ name: 'A', extraPrice: '1.5' })
        .expect(400);
      for (let i = 0; i < 26; i += 1)
        await http()
          .post(url)
          .set('Authorization', auth)
          .send({ name: `n${i}` })
          .expect(201);
      const full = await http()
        .post(url)
        .set('Authorization', auth)
        .send({ name: 'tope' })
        .expect(422);
      expect(full.body).toMatchObject({ code: 'MODIFIER_LIMIT_REACHED' });
    });

    it('PUT reorder: 200, idempotente, 422 mismatch, 400 UUID/tamaño', async () => {
      const auth = await asStaff();
      const url = `/v1/admin/modifier-groups/${G.salsas}/modifiers/reorder`;
      const res = await http()
        .put(url)
        .set('Authorization', auth)
        .send({ orderedIds: [OPT(3), OPT(1), OPT(2)] })
        .expect(200);
      expect((res.body as { items: Body[] }).items.map((i) => i['id'])).toEqual([
        OPT(3),
        OPT(1),
        OPT(2),
      ]);
      expect(mods.audit.map((a) => a['action'])).toEqual(['modifier.reordered']);
      await http()
        .put(url)
        .set('Authorization', auth)
        .send({ orderedIds: [OPT(3), OPT(1), OPT(2)] })
        .expect(200);
      expect(mods.audit).toHaveLength(1);
      const bad = await http()
        .put(url)
        .set('Authorization', auth)
        .send({ orderedIds: [OPT(1)] })
        .expect(422);
      expect(bad.body).toMatchObject({ code: 'MODIFIER_REORDER_MISMATCH' });
      await http()
        .put(url)
        .set('Authorization', auth)
        .send({ orderedIds: ['x'] })
        .expect(400);
      await http()
        .put(url)
        .set('Authorization', auth)
        .send({ orderedIds: Array.from({ length: 31 }, () => OPT(1)) })
        .expect(400);
      await http()
        .put(`/v1/admin/modifier-groups/${MISSING}/modifiers/reorder`)
        .set('Authorization', auth)
        .send({ orderedIds: [] })
        .expect(404);
    });

    it('PATCH opción: 200, 404 MODIFIER_NOT_FOUND, 409, 422 UNSATISFIABLE, 400', async () => {
      const auth = await asStaff();
      const upd = await http()
        .patch(`/v1/admin/modifiers/${OPT(1)}`)
        .set('Authorization', auth)
        .send({ extraPrice: '3.00' })
        .expect(200);
      expect(upd.body).toMatchObject({ extraPrice: '3.00' });
      const nf = await http()
        .patch(`/v1/admin/modifiers/${MISSING}`)
        .set('Authorization', auth)
        .send({ active: false })
        .expect(404);
      expect(nf.body).toMatchObject({ code: 'MODIFIER_NOT_FOUND' });
      await http()
        .patch(`/v1/admin/modifiers/${OPT(1)}`)
        .set('Authorization', auth)
        .send({ name: 'PICANTE' })
        .expect(409);
      await http()
        .patch(`/v1/admin/modifier-groups/${G.salsas}`)
        .set('Authorization', auth)
        .send({ minSelect: 2 })
        .expect(200);
      const unsat = await http()
        .patch(`/v1/admin/modifiers/${OPT(1)}`)
        .set('Authorization', auth)
        .send({ active: false })
        .expect(422);
      expect(unsat.body).toMatchObject({ code: 'MODIFIER_GROUP_UNSATISFIABLE' });
      await http()
        .patch(`/v1/admin/modifiers/${OPT(1)}`)
        .set('Authorization', auth)
        .send({})
        .expect(400);
      await http()
        .patch(`/v1/admin/modifiers/${OPT(1)}`)
        .set('Authorization', auth)
        .send({ extraPrice: 3 })
        .expect(400);
    });

    it('PUT grupos del producto: 200, 422 inválidos/tope, 404, 400', async () => {
      const auth = await asStaff();
      const url = `/v1/admin/products/${P.roll}/modifier-groups`;
      const ok = await http()
        .put(url)
        .set('Authorization', auth)
        .send({ groupIds: [G.vacio, G.salsas] })
        .expect(200);
      expect((ok.body as { groups: Body[] }).groups.map((g) => g['id'])).toEqual([
        G.vacio,
        G.salsas,
      ]);
      expect(mods.audit.map((a) => a['action'])).toEqual(['product.modifier_groups_replaced']);
      const inactive = await http()
        .put(url)
        .set('Authorization', auth)
        .send({ groupIds: [G.extras] })
        .expect(422);
      expect(inactive.body).toMatchObject({ code: 'MODIFIER_GROUP_INVALID' });
      expect((inactive.body as { violations: Body[] }).violations[0]).toMatchObject({
        path: 'groupIds[0]',
      });
      const many = await http()
        .put(url)
        .set('Authorization', auth)
        .send({ groupIds: Array.from({ length: 11 }, (_, i) => mid(300 + i)) })
        .expect(422);
      expect(many.body).toMatchObject({ code: 'MODIFIER_LIMIT_REACHED' });
      await http()
        .put(`/v1/admin/products/${MISSING}/modifier-groups`)
        .set('Authorization', auth)
        .send({ groupIds: [] })
        .expect(404);
      await http()
        .put(url)
        .set('Authorization', auth)
        .send({ groupIds: ['x'] })
        .expect(400);
      await http()
        .put(url)
        .set('Authorization', auth)
        .send({ groupIds: Array.from({ length: 51 }, () => G.salsas) })
        .expect(400);
    });

    it('bloqueo no disponible / timeout => 503 MODIFIERS_BUSY (code público, mensaje fijo)', async () => {
      const auth = await asStaff();
      for (const err of [{ code: 'P2028' }, { code: '55P03', message: 'detalle interno SQL' }]) {
        mods.failTransactionWith = err;
        const res = await http()
          .patch(`/v1/admin/modifier-groups/${G.salsas}`)
          .set('Authorization', auth)
          .send({ name: 'Otra' })
          .expect(503);
        expect(res.body).toMatchObject({ code: 'MODIFIERS_BUSY' });
        expect(JSON.stringify(res.body)).not.toContain('detalle interno');
      }
    });

    it('un error de BD desconocido => 500 genérico sin detalles', async () => {
      const auth = await asStaff();
      mods.failTransactionWith = new Error('relation "app.modifiers" does not exist');
      const res = await http()
        .post('/v1/admin/modifier-groups')
        .set('Authorization', auth)
        .send({ name: 'Zeta' })
        .expect(500);
      expect(JSON.stringify(res.body)).not.toContain('relation');
      expect(res.body).not.toHaveProperty('code');
    });
  });

  describe('ficha pública con modificadores', () => {
    it('solo grupos ofrecibles y opciones activas, en orden de asociación; cache pública; una consulta', async () => {
      mods.calls.length = 0;
      const res = await http().get('/v1/store/products/roll-california').expect(200);
      expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
      // extras (inactivo) y vacio (sin opciones) se omiten
      expect((res.body as { modifierGroups: unknown[] }).modifierGroups).toEqual([
        {
          id: G.salsas,
          name: 'Salsas',
          minSelect: 1,
          maxSelect: 2,
          required: true,
          options: [
            { id: OPT(1), name: 'Soya', extraPrice: '1.50' },
            { id: OPT(2), name: 'Picante', extraPrice: '0.00' },
          ],
        },
      ]);
      expect(mods.calls).toEqual(['findOffer']);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Vieja');
      expect(text).not.toContain('"active"');
    });

    it('sin grupos ofrecibles => modifierGroups [] y el producto sigue visible', async () => {
      const none = await http().get('/v1/store/products/roll-vegano').expect(200);
      expect((none.body as { modifierGroups: unknown[] }).modifierGroups).toEqual([]);
      mods.patchOption(OPT(1), { active: false });
      mods.patchOption(OPT(2), { active: false });
      const res = await http().get('/v1/store/products/roll-california').expect(200);
      expect((res.body as { modifierGroups: unknown[] }).modifierGroups).toEqual([]);
      expect(res.body).toMatchObject({ slug: 'roll-california' });
    });

    it('la lista pública no incluye modifierGroups ni consulta modificadores', async () => {
      mods.calls.length = 0;
      const res = await http().get('/v1/store/products').expect(200);
      expect(JSON.stringify(res.body)).not.toContain('modifierGroups');
      expect(mods.calls).toEqual([]);
    });
  });
});
