import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1); // raíz
const B = id(2); // hija de A
const C = id(3); // hija de B (nivel 3)
const D = id(4); // hija de A, inactiva
const E = id(5); // raíz
const MISSING = id(99);
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const ALL_PERMS = ['catalog.read', 'catalog.create', 'catalog.update'];

interface Row {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const row = (rid: string, parentId: string | null, name: string, over: Partial<Row> = {}): Row => ({
  id: rid,
  parentId,
  slug: name.toLowerCase().replace(/ /g, '-'),
  name,
  description: null,
  sortOrder: 0,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

/** Doble de PrismaService en memoria: solo lo que usa el módulo de categorías. */
function fakeDb(seed: Row[]) {
  const categories = new Map(seed.map((r) => [r.id, { ...r }]));
  const audit: Record<string, unknown>[] = [];
  const events: string[] = [];
  let counter = 100;
  const category = {
    findMany: vi.fn((a: { select?: Record<string, boolean> }) => {
      events.push('read');
      const all = [...categories.values()].sort(
        (x, y) =>
          x.sortOrder - y.sortOrder || x.name.localeCompare(y.name) || x.id.localeCompare(y.id),
      );
      return Promise.resolve(
        all.map((r) =>
          a.select
            ? Object.fromEntries(Object.keys(a.select).map((k) => [k, r[k as keyof Row]]))
            : { ...r },
        ),
      );
    }),
    create: vi.fn((a: { data: Partial<Row> & { slug: string; name: string } }) => {
      events.push('insert');
      if ([...categories.values()].some((r) => r.slug === a.data.slug)) {
        return Promise.reject(
          Object.assign(new Error('Unique'), { code: 'P2002', meta: { target: ['slug'] } }),
        );
      }
      counter += 1;
      const created = row(id(counter), a.data.parentId ?? null, a.data.name, a.data);
      categories.set(created.id, created);
      return Promise.resolve({ ...created });
    }),
    update: vi.fn((a: { where: { id: string }; data: Partial<Row> }) => {
      events.push('update');
      const next = { ...(categories.get(a.where.id) as Row), ...a.data };
      categories.set(next.id, next);
      return Promise.resolve({ ...next });
    }),
  };
  const db = {
    categories,
    audit,
    events,
    category,
    auditEvent: {
      create: vi.fn((a: { data: Record<string, unknown> }) => {
        audit.push(a.data);
        return Promise.resolve({});
      }),
    },
    customer: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
    staffUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: vi.fn((strings: TemplateStringsArray) => {
      events.push(`raw:${strings.join('?')}`);
      return Promise.resolve(0);
    }),
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

async function createApp(keys: TestKeys, db: ReturnType<typeof fakeDb>) {
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

describe('Categorías (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
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
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    db = fakeDb([
      row(A, null, 'Rolls', { sortOrder: 0, description: 'Los rolls' }),
      row(B, A, 'Frios', { sortOrder: 0 }),
      row(C, B, 'Veganos', { sortOrder: 0 }),
      row(D, A, 'Calientes', { sortOrder: 1, active: false }),
      row(E, null, 'Bebidas', { sortOrder: 1 }),
    ]);
    app = await createApp(keys, db);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('público GET /v1/store/categories', () => {
    it('sin autenticación: árbol anidado solo con visibles, campos mínimos y caché pública', async () => {
      const res = await http().get('/v1/store/categories').expect(200);
      expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
      expect(res.body).toEqual({
        items: [
          {
            id: A,
            slug: 'rolls',
            name: 'Rolls',
            description: 'Los rolls',
            children: [
              {
                id: B,
                slug: 'frios',
                name: 'Frios',
                description: null,
                children: [
                  { id: C, slug: 'veganos', name: 'Veganos', description: null, children: [] },
                ],
              },
            ],
          },
          { id: E, slug: 'bebidas', name: 'Bebidas', description: null, children: [] },
        ],
      });
      expect(db.category.findMany).toHaveBeenCalledTimes(1);
    });

    it('una inactiva oculta su subárbol aunque los hijos estén activos', async () => {
      db.categories.get(B)!.active = false;
      const res = await http().get('/v1/store/categories').expect(200);
      const body = res.body as { items: { id: string; children: unknown[] }[] };
      expect(body.items.map((i) => i.id)).toEqual([A, E]);
      expect(body.items[0]?.children).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(C);
    });

    it('lista vacía cuando no hay categorías visibles', async () => {
      db.categories.clear();
      const res = await http().get('/v1/store/categories').expect(200);
      expect(res.body).toEqual({ items: [] });
    });

    it('no expone sortOrder, active ni fechas', async () => {
      const res = await http().get('/v1/store/categories').expect(200);
      const text = JSON.stringify(res.body);
      for (const forbidden of ['sortOrder', 'active', 'createdAt', 'updatedAt', 'parentId']) {
        expect(text).not.toContain(forbidden);
      }
    });
  });

  describe('autenticación y autorización admin', () => {
    it('sin JWT o con JWT inválido => 401 en las cinco rutas admin', async () => {
      await http().get('/v1/admin/categories').expect(401);
      await http().post('/v1/admin/categories').send({ name: 'X' }).expect(401);
      await http().patch(`/v1/admin/categories/${A}`).send({ name: 'X' }).expect(401);
      await http().put('/v1/admin/categories/reorder').send({}).expect(401);
      await http()
        .get('/v1/admin/categories')
        .set('Authorization', `Bearer ${await keys.signWithForeignKey()}`)
        .expect(401);
    });

    it('cliente (no personal) => 403 genérico', async () => {
      const res = await http()
        .get('/v1/admin/categories')
        .set('Authorization', await bearer(AAL2))
        .expect(403);
      expect((res.body as { message: string }).message).toBe('Acceso denegado');
    });

    it('personal con permiso pero sesión aal1 => 403 MFA_REQUIRED sin tocar la base', async () => {
      const auth = await asStaff({}, {});
      const res = await http().get('/v1/admin/categories').set('Authorization', auth).expect(403);
      expect((res.body as { message: string }).message).toBe('MFA_REQUIRED');
      await http()
        .post('/v1/admin/categories')
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      expect(db.category.findMany).not.toHaveBeenCalled();
      expect(db.category.create).not.toHaveBeenCalled();
    });

    it('aal2 sin permisos de catálogo => 403 en todas las operaciones', async () => {
      const auth = await asStaff({ permissions: ['dashboard.read'] });
      await http().get('/v1/admin/categories').set('Authorization', auth).expect(403);
      await http()
        .post('/v1/admin/categories')
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      await http()
        .patch(`/v1/admin/categories/${A}`)
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      await http()
        .put('/v1/admin/categories/reorder')
        .set('Authorization', auth)
        .send({ parentId: null, orderedIds: [E, A] })
        .expect(403);
      expect(db.category.create).not.toHaveBeenCalled();
      expect(db.category.update).not.toHaveBeenCalled();
    });

    it('permisos separados: catalog.read no escribe; create no edita; update no crea', async () => {
      const readOnly = await asStaff({ permissions: ['catalog.read'] });
      await http().get('/v1/admin/categories').set('Authorization', readOnly).expect(200);
      await http()
        .post('/v1/admin/categories')
        .set('Authorization', readOnly)
        .send({ name: 'X' })
        .expect(403);
      const onlyCreate = await asStaff({ permissions: ['catalog.create'] });
      await http().get('/v1/admin/categories').set('Authorization', onlyCreate).expect(403);
      await http()
        .patch(`/v1/admin/categories/${A}`)
        .set('Authorization', onlyCreate)
        .send({ name: 'X' })
        .expect(403);
      const onlyUpdate = await asStaff({ permissions: ['catalog.update'] });
      await http()
        .post('/v1/admin/categories')
        .set('Authorization', onlyUpdate)
        .send({ name: 'X' })
        .expect(403);
    });

    it('alcance por sucursal: la lectura funciona; POST/PATCH/reorder => 403 y no se escribe', async () => {
      const auth = await asStaff({ branchId: id(500) });
      await http().get('/v1/admin/categories').set('Authorization', auth).expect(200);
      const denied = await http()
        .post('/v1/admin/categories')
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      expect((denied.body as { message: string }).message).toBe('Acceso denegado');
      await http()
        .patch(`/v1/admin/categories/${A}`)
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      // 403 antes que 404: no se filtra la existencia a quien no está autorizado.
      await http()
        .patch(`/v1/admin/categories/${MISSING}`)
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      await http()
        .put('/v1/admin/categories/reorder')
        .set('Authorization', auth)
        .send({ parentId: MISSING, orderedIds: [] })
        .expect(403);
      expect(db.category.create).not.toHaveBeenCalled();
      expect(db.category.update).not.toHaveBeenCalled();
      expect(db.audit).toHaveLength(0);
    });
  });

  describe('GET /v1/admin/categories', () => {
    it('lista plana depth-first con depth y effectivelyVisible, no-store', async () => {
      const res = await http()
        .get('/v1/admin/categories')
        .set('Authorization', await asStaff())
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.body as {
        items: { id: string; depth: number; effectivelyVisible: boolean; active: boolean }[];
        total: number;
      };
      expect(body.total).toBe(5);
      expect(body.items.map((i) => [i.id, i.depth, i.effectivelyVisible, i.active])).toEqual([
        [A, 1, true, true],
        [B, 2, true, true],
        [C, 3, true, true],
        [D, 2, false, false],
        [E, 1, true, true],
      ]);
    });

    it('filtros active, parentId y q; parámetros inválidos => 400', async () => {
      const auth = await asStaff();
      const inactive = await http()
        .get('/v1/admin/categories?active=false')
        .set('Authorization', auth)
        .expect(200);
      expect((inactive.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([D]);
      const children = await http()
        .get(`/v1/admin/categories?parentId=${A}`)
        .set('Authorization', auth)
        .expect(200);
      expect((children.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([B, D]);
      const found = await http()
        .get('/v1/admin/categories?q=VEGAN')
        .set('Authorization', auth)
        .expect(200);
      expect((found.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([C]);
      await http().get('/v1/admin/categories?active=quizas').set('Authorization', auth).expect(400);
      await http().get('/v1/admin/categories?parentId=x').set('Authorization', auth).expect(400);
      await http()
        .get('/v1/admin/categories?q=' + 'a'.repeat(81))
        .set('Authorization', auth)
        .expect(400);
    });
  });

  describe('POST /v1/admin/categories', () => {
    it('crea con slug autogenerado, al final de sus hermanos, audita y no-store', async () => {
      const res = await http()
        .post('/v1/admin/categories')
        .set('Authorization', await asStaff())
        .send({ name: '  Rolls   Fríos ', parentId: E, description: 'Frescos' })
        .expect(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        slug: 'rolls-frios',
        name: 'Rolls Fríos',
        parentId: E,
        sortOrder: 0,
        depth: 2,
        active: true,
        effectivelyVisible: true,
        description: 'Frescos',
      });
      expect(db.audit).toHaveLength(1);
      expect(db.audit[0]).toMatchObject({ action: 'category.created', actorId: STAFF_ID });
      // El bloqueo de jerarquía va PRIMERO, antes de leer para validar.
      expect(db.events.slice(0, 3)).toEqual([
        "raw:SET LOCAL lock_timeout = '3s'",
        'raw:SELECT pg_advisory_xact_lock(1100110)',
        'read',
      ]);
    });

    it('slug repetido autogenerado se desambigua; explícito repetido => 409 con code', async () => {
      const auth = await asStaff();
      const first = await http()
        .post('/v1/admin/categories')
        .set('Authorization', auth)
        .send({ name: 'Rolls' })
        .expect(201);
      expect((first.body as { slug: string }).slug).toBe('rolls-2');
      const dup = await http()
        .post('/v1/admin/categories')
        .set('Authorization', auth)
        .send({ name: 'Otra', slug: 'rolls' })
        .expect(409);
      expect((dup.body as { code: string }).code).toBe('CATEGORY_SLUG_TAKEN');
      expect(db.audit).toHaveLength(1);
    });

    it('padre inexistente/inactivo => 422 CATEGORY_PARENT_INVALID; nivel 4 => 422 CATEGORY_DEPTH_EXCEEDED', async () => {
      const auth = await asStaff();
      for (const [parentId, code] of [
        [MISSING, 'CATEGORY_PARENT_INVALID'],
        [D, 'CATEGORY_PARENT_INVALID'],
        [C, 'CATEGORY_DEPTH_EXCEEDED'],
      ] as const) {
        const res = await http()
          .post('/v1/admin/categories')
          .set('Authorization', auth)
          .send({ name: 'X', parentId })
          .expect(422);
        expect((res.body as { code: string }).code).toBe(code);
      }
      expect(db.category.create).not.toHaveBeenCalled();
    });

    it('validación: nombre vacío/largo, slug no kebab, uuid, campos desconocidos y tipos => 400', async () => {
      const auth = await asStaff();
      const bodies: unknown[] = [
        {},
        { name: '' },
        { name: '   ' },
        { name: 'x'.repeat(81) },
        { name: 'X', slug: 'Con Espacios' },
        { name: 'X', slug: 'a--b' },
        { name: 'X', parentId: 'no-uuid' },
        { name: 'X', description: 'x'.repeat(501) },
        { name: 'X', active: 'si' },
        { name: 'X', sortOrder: 3 },
        { name: 'X', id: A },
        { name: 'X', createdAt: '2020-01-01' },
        { name: 5 },
      ];
      for (const body of bodies) {
        await http()
          .post('/v1/admin/categories')
          .set('Authorization', auth)
          .send(body as object)
          .expect(400);
      }
      expect(db.category.create).not.toHaveBeenCalled();
    });

    it('tope de 500 => 422 CATEGORY_LIMIT_REACHED', async () => {
      for (let i = 0; i < 495; i += 1) {
        db.categories.set(id(1000 + i), row(id(1000 + i), null, `Extra ${i}`));
      }
      const res = await http()
        .post('/v1/admin/categories')
        .set('Authorization', await asStaff())
        .send({ name: 'Una más' })
        .expect(422);
      expect((res.body as { code: string }).code).toBe('CATEGORY_LIMIT_REACHED');
    });
  });

  describe('PATCH /v1/admin/categories/:id', () => {
    const patch = async (target: string, body: object, status: number) =>
      http()
        .patch(`/v1/admin/categories/${target}`)
        .set('Authorization', await asStaff())
        .send(body)
        .expect(status);

    it('edita nombre y slug y audita el diff', async () => {
      const res = await patch(B, { name: 'Fríos', slug: 'frios-2' }, 200);
      expect(res.body).toMatchObject({ id: B, name: 'Fríos', slug: 'frios-2' });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(db.audit[0]).toMatchObject({
        action: 'category.updated',
        oldValues: { name: 'Frios', slug: 'frios' },
        newValues: { name: 'Fríos', slug: 'frios-2' },
      });
    });

    it('sin cambios reales => 200 sin escritura ni auditoría', async () => {
      await patch(B, { name: 'Frios', active: true, parentId: A }, 200);
      expect(db.category.update).not.toHaveBeenCalled();
      expect(db.audit).toHaveLength(0);
    });

    it('desactivar un padre no toca a los hijos y audita category.deactivated', async () => {
      const res = await patch(A, { active: false }, 200);
      expect(res.body).toMatchObject({ active: false, effectivelyVisible: false });
      expect(db.categories.get(B)?.active).toBe(true);
      expect(db.audit.map((a) => a['action'])).toEqual(['category.deactivated']);
      const pub = await http().get('/v1/store/categories').expect(200);
      expect((pub.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([E]);
    });

    it('ciclo: padre = ella misma o descendiente => 422 CATEGORY_CYCLE', async () => {
      for (const parentId of [A, B, C]) {
        const res = await patch(A, { parentId }, 422);
        expect((res.body as { code: string }).code).toBe('CATEGORY_CYCLE');
      }
      expect(db.category.update).not.toHaveBeenCalled();
    });

    it('profundidad: mover un subárbol que pasaría de 3 niveles => 422 CATEGORY_DEPTH_EXCEEDED', async () => {
      const res = await patch(A, { parentId: E }, 422);
      expect((res.body as { code: string }).code).toBe('CATEGORY_DEPTH_EXCEEDED');
    });

    it('destino inactivo/inexistente => 422 CATEGORY_PARENT_INVALID', async () => {
      for (const parentId of [D, MISSING]) {
        const res = await patch(E, { parentId }, 422);
        expect((res.body as { code: string }).code).toBe('CATEGORY_PARENT_INVALID');
      }
    });

    it('slug de otra categoría => 409 CATEGORY_SLUG_TAKEN', async () => {
      const res = await patch(B, { slug: 'bebidas' }, 409);
      expect((res.body as { code: string }).code).toBe('CATEGORY_SLUG_TAKEN');
    });

    it('mover a la raíz y description null', async () => {
      const res = await patch(C, { parentId: null, description: null }, 200);
      expect(res.body).toMatchObject({ parentId: null, depth: 1, sortOrder: 2 });
    });

    it('inexistente => 404; id no uuid => 400; cuerpo vacío o campos desconocidos => 400', async () => {
      await patch(MISSING, { name: 'X' }, 404);
      await patch('no-uuid', { name: 'X' }, 400);
      await patch(A, {}, 400);
      await patch(A, { sortOrder: 3 }, 400);
      await patch(A, { name: 'X', foo: 1 }, 400);
      await patch(A, { name: null }, 400);
      await patch(A, { active: 'no' }, 400);
    });
  });

  describe('PUT /v1/admin/categories/reorder', () => {
    const reorder = async (body: object, status: number) =>
      http()
        .put('/v1/admin/categories/reorder')
        .set('Authorization', await asStaff())
        .send(body)
        .expect(status);

    it('reordena las raíces, responde 200 con los hermanos ordenados y audita', async () => {
      const res = await reorder({ parentId: null, orderedIds: [E, A] }, 200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.body as { items: { id: string; sortOrder: number }[]; total: number };
      expect(body.items.map((i) => [i.id, i.sortOrder])).toEqual([
        [E, 0],
        [A, 1],
      ]);
      expect(body.total).toBe(2);
      expect(db.audit.map((a) => a['action'])).toEqual(['category.reordered']);
      const pub = await http().get('/v1/store/categories').expect(200);
      expect((pub.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([E, A]);
    });

    it('reordena hijos de un padre incluyendo inactivas', async () => {
      const res = await reorder({ parentId: A, orderedIds: [D, B] }, 200);
      expect((res.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([D, B]);
    });

    it('idempotente: repetir el mismo orden => 200 sin escritura ni nueva auditoría', async () => {
      await reorder({ parentId: null, orderedIds: [E, A] }, 200);
      const writes = db.category.update.mock.calls.length;
      await reorder({ parentId: null, orderedIds: [E, A] }, 200);
      expect(db.category.update.mock.calls.length).toBe(writes);
      expect(db.audit).toHaveLength(1);
    });

    it('conjunto distinto (faltante, ajeno, duplicado) => 422 CATEGORY_REORDER_MISMATCH', async () => {
      for (const orderedIds of [[A], [A, E, B], [A, A], [A, MISSING]]) {
        const res = await reorder({ parentId: null, orderedIds }, 422);
        expect((res.body as { code: string }).code).toBe('CATEGORY_REORDER_MISMATCH');
      }
      expect(db.category.update).not.toHaveBeenCalled();
    });

    it('parentId inexistente => 404; forma inválida => 400', async () => {
      await reorder({ parentId: MISSING, orderedIds: [] }, 404);
      await reorder({}, 400);
      await reorder({ parentId: null }, 400);
      await reorder({ orderedIds: [A] }, 400);
      await reorder({ parentId: 'x', orderedIds: [] }, 400);
      await reorder({ parentId: null, orderedIds: ['x'] }, 400);
      await reorder({ parentId: null, orderedIds: 'A' }, 400);
      await reorder({ parentId: null, orderedIds: [A, E], extra: 1 }, 400);
    });
  });

  describe('seguridad y robustez adicionales', () => {
    it('aal1 => 403 MFA_REQUIRED también en PATCH y PUT reorder, sin tocar la base', async () => {
      const auth = await asStaff({}, {});
      for (const res of [
        await http()
          .patch(`/v1/admin/categories/${A}`)
          .set('Authorization', auth)
          .send({ name: 'X' })
          .expect(403),
        await http()
          .put('/v1/admin/categories/reorder')
          .set('Authorization', auth)
          .send({ parentId: null, orderedIds: [A, E] })
          .expect(403),
      ]) {
        expect((res.body as { message: string }).message).toBe('MFA_REQUIRED');
      }
      expect(db.category.findMany).not.toHaveBeenCalled();
      expect(db.category.update).not.toHaveBeenCalled();
    });

    it('solo por sucursal: POST/PATCH/PUT con :id inexistente => 403 (no 404) y sin abrir transacción', async () => {
      const auth = await asStaff({ branchId: id(500) });
      await http()
        .post('/v1/admin/categories')
        .set('Authorization', auth)
        .send({ name: 'X', parentId: MISSING })
        .expect(403);
      await http()
        .patch(`/v1/admin/categories/${MISSING}`)
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      await http()
        .put('/v1/admin/categories/reorder')
        .set('Authorization', auth)
        .send({ parentId: MISSING, orderedIds: [] })
        .expect(403);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('Cache-Control público solo en 200: un fallo interno no lo lleva', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      db.category.findMany.mockRejectedValueOnce(new Error('boom'));
      const res = await http().get('/v1/store/categories').expect(500);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toContain('boom');
    });

    it('orderedIds con 501 elementos => 400', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => id(2000 + i));
      await http()
        .put('/v1/admin/categories/reorder')
        .set('Authorization', await asStaff())
        .send({ parentId: null, orderedIds: ids })
        .expect(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('reorder de 500 hermanos: una escritura por fila que cambia y una sola auditoría', async () => {
      db.categories.clear();
      const ids = Array.from({ length: 500 }, (_, i) => id(3000 + i));
      ids.forEach((rid, i) => db.categories.set(rid, row(rid, null, `N${i}`, { sortOrder: i })));
      const res = await http()
        .put('/v1/admin/categories/reorder')
        .set('Authorization', await asStaff())
        .send({ parentId: null, orderedIds: [...ids].reverse() })
        .expect(200);
      expect((res.body as { total: number }).total).toBe(500);
      expect(db.audit).toHaveLength(1);
      expect(db.category.update.mock.calls.length).toBeLessThanOrEqual(500);
    });

    it('slug con salto de línea, mayúsculas o espacios => 400 (POST y PATCH)', async () => {
      const auth = await asStaff();
      for (const slug of ['abc\n', 'abc\ndef', 'Rolls', 'a b', '\nabc']) {
        await http()
          .post('/v1/admin/categories')
          .set('Authorization', auth)
          .send({ name: 'X', slug })
          .expect(400);
        await http()
          .patch(`/v1/admin/categories/${B}`)
          .set('Authorization', auth)
          .send({ slug })
          .expect(400);
      }
      expect(db.category.create).not.toHaveBeenCalled();
    });

    it('cuerpo con __proto__ o campos extra => 400 sin escribir', async () => {
      const auth = await asStaff();
      for (const raw of [
        '{"name":"X","__proto__":{"active":false}}',
        '{"name":"X","parentId":null,"__proto__":{"x":1}}',
        '{"name":"X","isAdmin":true}',
      ]) {
        await http()
          .post('/v1/admin/categories')
          .set('Authorization', auth)
          .set('Content-Type', 'application/json')
          .send(raw)
          .expect(400);
      }
      expect(db.category.create).not.toHaveBeenCalled();
    });

    it('una clave `constructor` en el cuerpo no contamina prototipos ni se persiste', async () => {
      await http()
        .post('/v1/admin/categories')
        .set('Authorization', await asStaff())
        .set('Content-Type', 'application/json')
        .send('{"name":"Segura","constructor":{"prototype":{"polluted":true}}}')
        .expect(201);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      const data = db.category.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(Object.keys(data.data).sort()).toEqual(
        ['active', 'description', 'name', 'parentId', 'slug', 'sortOrder'].sort(),
      );
    });

    it('timeout de transacción (P2028) o lock_timeout (55P03) => 503 CATEGORIES_BUSY con mensaje fijo', async () => {
      const auth = await asStaff();
      for (const error of [
        Object.assign(new Error('Transaction API error: secret-host'), { code: 'P2028' }),
        { cause: { code: '55P03' }, message: 'canceling statement due to lock timeout host=db' },
      ]) {
        db.$transaction.mockRejectedValueOnce(error);
        const res = await http()
          .post('/v1/admin/categories')
          .set('Authorization', auth)
          .send({ name: 'X' })
          .expect(503);
        const body = res.body as { code: string; message: string };
        expect(body.code).toBe('CATEGORIES_BUSY');
        expect(JSON.stringify(body)).not.toMatch(/secret-host|host=db/);
      }
    });

    it('las escrituras fijan lock_timeout antes del advisory lock', async () => {
      await http()
        .post('/v1/admin/categories')
        .set('Authorization', await asStaff())
        .send({ name: 'Nueva' })
        .expect(201);
      expect(db.events.slice(0, 3)).toEqual([
        "raw:SET LOCAL lock_timeout = '3s'",
        'raw:SELECT pg_advisory_xact_lock(1100110)',
        'read',
      ]);
    });
  });

  it('no existe DELETE de categorías', async () => {
    await http()
      .delete(`/v1/admin/categories/${A}`)
      .set('Authorization', await asStaff())
      .expect(404);
  });
});
