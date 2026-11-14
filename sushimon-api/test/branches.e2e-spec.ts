import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const MISSING = '44444444-4444-4444-8444-444444444444';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const PUBLIC_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

interface Row {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  createdAt: Date;
}

const row = (id: string, code: string, over: Partial<Row> = {}): Row => ({
  id,
  code,
  name: `Sucursal ${code}`,
  address: 'Dirección',
  phone: null,
  latitude: null,
  longitude: null,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

/** Doble de PrismaService en memoria: soporta solo lo que usa el módulo de sucursales. */
function fakeDb(seed: Row[]) {
  const branches = new Map(seed.map((r) => [r.id, { ...r }]));
  const audit: Record<string, unknown>[] = [];
  const matches = (r: Row, where: Record<string, unknown> = {}): boolean => {
    const idCond = where['id'] as string | { in: string[] } | undefined;
    if (typeof idCond === 'string' && r.id !== idCond) return false;
    if (idCond && typeof idCond === 'object' && !idCond.in.includes(r.id)) return false;
    if (where['active'] !== undefined && r.active !== where['active']) return false;
    const or = where['OR'] as { name?: { contains: string }; code?: { contains: string } }[];
    if (or) {
      const hit = or.some((c) => {
        const needle = (c.name ?? c.code)?.contains.toLowerCase() ?? '';
        return (c.name ? r.name : r.code).toLowerCase().includes(needle);
      });
      if (!hit) return false;
    }
    return true;
  };
  const project = (r: Row, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k as keyof Row]])) : r;
  const sortRows = (rows: Row[], orderBy: Record<string, 'asc' | 'desc'>[] = []) =>
    [...rows].sort((x, y) => {
      for (const o of orderBy) {
        const [k, dir] = Object.entries(o)[0] as [keyof Row, 'asc' | 'desc'];
        const [l, r] = [String(x[k]), String(y[k])];
        if (l !== r) return (l < r ? -1 : 1) * (dir === 'asc' ? 1 : -1);
      }
      return 0;
    });
  const branch = {
    findMany: vi.fn((a: Record<string, never>) => {
      const all = sortRows(
        [...branches.values()].filter((r) => matches(r, a['where'])),
        a['orderBy'],
      );
      const skip = (a['skip'] as number | undefined) ?? 0;
      const take = (a['take'] as number | undefined) ?? all.length;
      return Promise.resolve(all.slice(skip, skip + take).map((r) => project(r, a['select'])));
    }),
    count: vi.fn((a: Record<string, never>) =>
      Promise.resolve([...branches.values()].filter((r) => matches(r, a['where'])).length),
    ),
    findFirst: vi.fn((a: Record<string, never>) => {
      const r = [...branches.values()].find((x) => matches(x, a['where']));
      return Promise.resolve(r ? project(r, a['select']) : null);
    }),
    findUnique: vi.fn((a: { where: { id: string }; select?: Record<string, boolean> }) => {
      const r = branches.get(a.where.id);
      return Promise.resolve(r ? project(r, a.select) : null);
    }),
    create: vi.fn((a: { data: Partial<Row> & { code: string } }) => {
      if ([...branches.values()].some((r) => r.code === a.data.code)) {
        return Promise.reject(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
      }
      const created = row(
        `aaaaaaaa-aaaa-4aaa-8aaa-${String(branches.size).padStart(12, '0')}`,
        a.data.code,
        a.data,
      );
      branches.set(created.id, created);
      return Promise.resolve({ ...created });
    }),
    update: vi.fn((a: { where: { id: string }; data: Partial<Row> }) => {
      const next = { ...(branches.get(a.where.id) as Row), ...a.data };
      branches.set(next.id, next);
      return Promise.resolve({ ...next });
    }),
  };
  const auditEvent = {
    create: vi.fn((a: { data: Record<string, unknown> }) => {
      audit.push(a.data);
      return Promise.resolve({});
    }),
  };
  const db = {
    branches,
    audit,
    branch,
    auditEvent,
    customer: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    staffUser: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: vi.fn((_sql: unknown, id: string) =>
      Promise.resolve(branches.has(id) ? [{ id }] : []),
    ),
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: unknown) => unknown)(db)
        : Promise.all(arg as unknown[]),
    ),
    $disconnect: () => Promise.resolve(),
  };
  return db;
}

interface StaffAssignmentFake {
  branchId: string | null;
  permissions: string[];
}

const BRANCH_PERMISSIONS = ['branches.read', 'branches.create', 'branches.update'];

function staffRow(assignments: StaffAssignmentFake[]) {
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

describe('Sucursales (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let db: ReturnType<typeof fakeDb>;
  const http = () => request(app.getHttpServer());
  const bearer = async (claims?: Parameters<TestKeys['sign']>[0]) =>
    `Bearer ${await keys.sign(claims)}`;
  const asStaffWith = async (
    assignments: StaffAssignmentFake[],
    claims: Record<string, unknown> = AAL2,
  ) => {
    db.staffUser.findUnique.mockResolvedValue(staffRow(assignments));
    return bearer(claims);
  };
  const asStaff = (
    over: { permissions?: string[]; branchId?: string | null } = {},
    claims: Record<string, unknown> = AAL2,
  ) =>
    asStaffWith(
      [{ branchId: over.branchId ?? null, permissions: over.permissions ?? BRANCH_PERMISSIONS }],
      claims,
    );

  beforeAll(async () => {
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    db = fakeDb([
      row(A, 'zona-10', {
        name: 'Zona 10',
        phone: '+502 2222-3333',
        latitude: 14.6,
        longitude: -90.5,
      }),
      row(B, 'zona-14', { name: 'Zona 14' }),
      row(C, 'oakland', { name: 'Oakland', active: false }),
    ]);
    app = await createApp(keys, db);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('públicos', () => {
    it('listan solo sucursales activas, sin autenticación y con caché compartida', async () => {
      const res = await http().get('/v1/branches').expect(200);
      const items = (res.body as { items: Record<string, unknown>[] }).items;
      expect(items.map((i) => i['code'])).toEqual(['zona-10', 'zona-14']);
      expect(items[0]).toEqual({
        id: A,
        code: 'zona-10',
        name: 'Zona 10',
        address: 'Dirección',
        phone: '+502 2222-3333',
        latitude: 14.6,
        longitude: -90.5,
      });
      expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
    });

    it('detalle público de una activa; no expone campos administrativos', async () => {
      const res = await http().get(`/v1/branches/${A}`).expect(200);
      expect(res.body).not.toHaveProperty('active');
      expect(res.body).not.toHaveProperty('createdAt');
      expect(res.headers['cache-control']).toBe(PUBLIC_CACHE);
    });

    it('inactiva o inexistente → 404 (sin caché pública); uuid inválido → 400', async () => {
      for (const id of [C, MISSING]) {
        const res = await http().get(`/v1/branches/${id}`).expect(404);
        expect(res.headers['cache-control']).toBeUndefined();
      }
      await http().get('/v1/branches/no-es-uuid').expect(400);
    });
  });

  describe('autenticación y autorización admin', () => {
    it('sin JWT → 401; JWT inválido → 401', async () => {
      await http().get('/v1/admin/branches').expect(401);
      await http().post('/v1/admin/branches').send({}).expect(401);
      await http()
        .get('/v1/admin/branches')
        .set('Authorization', `Bearer ${await keys.signWithForeignKey()}`)
        .expect(401);
      await http().get('/v1/admin/branches').set('Authorization', 'Bearer x.y.z').expect(401);
    });

    it('cliente (no personal) → 403', async () => {
      const res = await http()
        .get('/v1/admin/branches')
        .set('Authorization', await bearer(AAL2))
        .expect(403);
      expect((res.body as { message: string }).message).toBe('Acceso denegado');
    });

    it('personal con permiso pero sesión aal1 → 403 MFA_REQUIRED', async () => {
      const res = await http()
        .get('/v1/admin/branches')
        .set('Authorization', await asStaff({}, {}))
        .expect(403);
      expect((res.body as { message: string }).message).toBe('MFA_REQUIRED');
      expect(db.branch.findMany).not.toHaveBeenCalled();
    });

    it('aal2 sin permisos de sucursales → 403 en todas las operaciones', async () => {
      const auth = await asStaff({ permissions: ['dashboard.read'] });
      await http().get('/v1/admin/branches').set('Authorization', auth).expect(403);
      await http().get(`/v1/admin/branches/${A}`).set('Authorization', auth).expect(403);
      await http()
        .post('/v1/admin/branches')
        .set('Authorization', auth)
        .send({ code: 'nueva', name: 'N', address: 'D' })
        .expect(403);
      await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      await http()
        .patch(`/v1/admin/branches/${A}/status`)
        .set('Authorization', auth)
        .send({ active: true })
        .expect(403);
      expect(db.branch.create).not.toHaveBeenCalled();
      expect(db.branch.update).not.toHaveBeenCalled();
    });
  });

  describe('listado y detalle admin', () => {
    it('aal2 con permiso y alcance global: lista activas e inactivas, no-store, sin caché pública', async () => {
      const res = await http()
        .get('/v1/admin/branches')
        .set('Authorization', await asStaff())
        .expect(200);
      const body = res.body as { items: { code: string; active: boolean }[]; total: number };
      expect(body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
      expect(body.items.map((i) => i.code)).toEqual(['oakland', 'zona-10', 'zona-14']);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['cache-control']).not.toContain('public');
    });

    it('filtros: active, q y paginación se resuelven en la consulta', async () => {
      const auth = await asStaff();
      const inactive = await http()
        .get('/v1/admin/branches?active=false')
        .set('Authorization', auth)
        .expect(200);
      expect((inactive.body as { items: { code: string }[] }).items.map((i) => i.code)).toEqual([
        'oakland',
      ]);
      const q = await http()
        .get('/v1/admin/branches?q=ZONA')
        .set('Authorization', auth)
        .expect(200);
      expect((q.body as { total: number }).total).toBe(2);
      const page = await http()
        .get('/v1/admin/branches?pageSize=1&page=2&sort=code')
        .set('Authorization', auth)
        .expect(200);
      expect(page.body).toMatchObject({ page: 2, pageSize: 1, total: 3 });
      expect((page.body as { items: unknown[] }).items).toHaveLength(1);
    });

    it('parámetros de consulta inválidos → 400', async () => {
      const auth = await asStaff();
      for (const qs of ['pageSize=101', 'page=0', 'sort=hack', 'order=up', 'active=quizas']) {
        await http().get(`/v1/admin/branches?${qs}`).set('Authorization', auth).expect(400);
      }
    });

    it('personal de una sucursal: listado filtrado a su alcance; detalle de otra → 404', async () => {
      const auth = await asStaff({ branchId: A });
      const list = await http().get('/v1/admin/branches').set('Authorization', auth).expect(200);
      expect(list.body as { items: { id: string }[]; total: number }).toMatchObject({
        total: 1,
        items: [{ id: A }],
      });
      await http().get(`/v1/admin/branches/${A}`).set('Authorization', auth).expect(200);
      const other = await http()
        .get(`/v1/admin/branches/${B}`)
        .set('Authorization', auth)
        .expect(404);
      const missing = await http()
        .get(`/v1/admin/branches/${MISSING}`)
        .set('Authorization', auth)
        .expect(404);
      // Misma respuesta para fuera de alcance e inexistente.
      expect((other.body as { message: string }).message).toBe(
        (missing.body as { message: string }).message,
      );
    });

    it('uuid inválido → 400', async () => {
      await http()
        .get('/v1/admin/branches/xyz')
        .set('Authorization', await asStaff())
        .expect(400);
    });
  });

  describe('POST /v1/admin/branches', () => {
    it('crea (201), normaliza el código y audita en la misma transacción', async () => {
      const res = await http()
        .post('/v1/admin/branches')
        .set('Authorization', await asStaff())
        .send({
          code: '  Miraflores ',
          name: ' Sushi   Mon Miraflores',
          address: 'Calzada Roosevelt',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        code: 'miraflores',
        name: 'Sushi Mon Miraflores',
        phone: null,
        latitude: null,
        active: true,
      });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(db.audit).toEqual([
        expect.objectContaining({
          action: 'branch.created',
          entityType: 'branch',
          actorId: STAFF_ID,
        }),
      ]);
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('personal sin alcance global → 403 y no crea', async () => {
      await http()
        .post('/v1/admin/branches')
        .set('Authorization', await asStaff({ branchId: A }))
        .send({ code: 'nueva', name: 'N', address: 'D' })
        .expect(403);
      expect(db.branch.create).not.toHaveBeenCalled();
    });

    it('código duplicado (incluso con otra capitalización) → 409', async () => {
      const res = await http()
        .post('/v1/admin/branches')
        .set('Authorization', await asStaff())
        .send({ code: 'ZONA-10', name: 'Otra', address: 'D' })
        .expect(409);
      expect((res.body as { error: string }).error).toBe('CONFLICT');
      expect(db.audit).toHaveLength(0);
    });

    it.each([
      { code: '', name: 'N', address: 'D' },
      { code: 'mal código', name: 'N', address: 'D' },
      { code: 'ok', name: '   ', address: 'D' },
      { code: 'ok', name: 'N', address: '' },
      { code: 'ok', name: 'N', address: 'D', phone: '123' },
      { code: 'ok', name: 'N', address: 'D', latitude: 91, longitude: 0 },
      { code: 'ok', name: 'N', address: 'D', latitude: 10 },
      { code: 'ok', name: 'N', address: 'D', extra: 1 },
      { code: 'ok', name: 'N' },
    ])('datos inválidos → 400 %j', async (body) => {
      await http()
        .post('/v1/admin/branches')
        .set('Authorization', await asStaff())
        .send(body)
        .expect(400);
      expect(db.branch.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /v1/admin/branches/{id}', () => {
    it('actualiza datos permitidos y audita el diff', async () => {
      const res = await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', await asStaff())
        .send({ name: 'Zona 10 Centro', phone: null })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Zona 10 Centro', phone: null, code: 'zona-10' });
      expect(db.audit[0]).toMatchObject({
        action: 'branch.updated',
        oldValues: { name: 'Zona 10', phone: '+502 2222-3333' },
        newValues: { name: 'Zona 10 Centro', phone: null },
      });
    });

    it.each([
      { code: 'otro' },
      { active: false },
      { createdAt: '2020-01-01T00:00:00Z' },
      { id: A },
    ])('campo protegido o desconocido → 400 %j', async (body) => {
      await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', await asStaff())
        .send({ name: 'X', ...body })
        .expect(400);
      expect(db.branch.update).not.toHaveBeenCalled();
    });

    it('cuerpo vacío, nombre vacío o null en campos obligatorios → 400', async () => {
      const auth = await asStaff();
      for (const body of [{}, { name: '  ' }, { name: null }, { address: null }]) {
        await http()
          .patch(`/v1/admin/branches/${A}`)
          .set('Authorization', auth)
          .send(body)
          .expect(400);
      }
    });

    it('sin cambios reales: 200 con la actual, sin escribir ni auditar', async () => {
      const res = await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', await asStaff())
        .send({ name: 'Zona 10' })
        .expect(200);
      expect(res.body).toMatchObject({ id: A, name: 'Zona 10' });
      expect(db.branch.update).not.toHaveBeenCalled();
      expect(db.audit).toHaveLength(0);
    });

    it('coordenadas: par incompleto tras el merge → 400; ambas null las borra', async () => {
      const auth = await asStaff();
      await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', auth)
        .send({ latitude: null })
        .expect(400);
      await http()
        .patch(`/v1/admin/branches/${B}`)
        .set('Authorization', auth)
        .send({ latitude: 10 })
        .expect(400);
      await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', auth)
        .send({ latitude: 95 })
        .expect(400);
      const ok = await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', auth)
        .send({ latitude: null, longitude: null })
        .expect(200);
      expect(ok.body).toMatchObject({ latitude: null, longitude: null });
    });

    it('fuera de alcance o inexistente → 404 sin escribir', async () => {
      const auth = await asStaff({ branchId: A });
      await http()
        .patch(`/v1/admin/branches/${B}`)
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(404);
      const auth2 = await asStaff();
      await http()
        .patch(`/v1/admin/branches/${MISSING}`)
        .set('Authorization', auth2)
        .send({ name: 'X' })
        .expect(404);
      expect(db.branch.update).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /v1/admin/branches/{id}/status', () => {
    it('desactiva con motivo y audita; la pública deja de verla', async () => {
      const auth = await asStaff();
      const res = await http()
        .patch(`/v1/admin/branches/${A}/status`)
        .set('Authorization', auth)
        .send({ active: false, reason: 'Remodelación' })
        .expect(200);
      expect(res.body).toMatchObject({ id: A, active: false });
      expect(db.audit[0]).toMatchObject({
        action: 'branch.deactivated',
        reason: 'Remodelación',
        oldValues: { active: true },
        newValues: { active: false },
      });
      await http().get(`/v1/branches/${A}`).expect(404);
    });

    it('desactivar sin motivo → 400; estado inválido → 400', async () => {
      const auth = await asStaff();
      await http()
        .patch(`/v1/admin/branches/${A}/status`)
        .set('Authorization', auth)
        .send({ active: false })
        .expect(400);
      await http()
        .patch(`/v1/admin/branches/${A}/status`)
        .set('Authorization', auth)
        .send({ active: 'no' })
        .expect(400);
      await http()
        .patch(`/v1/admin/branches/${A}/status`)
        .set('Authorization', auth)
        .send({})
        .expect(400);
      expect(db.branch.update).not.toHaveBeenCalled();
    });

    it('activa una inactiva; repetir es idempotente (sin segunda escritura ni auditoría)', async () => {
      const auth = await asStaff();
      await http()
        .patch(`/v1/admin/branches/${C}/status`)
        .set('Authorization', auth)
        .send({ active: true })
        .expect(200);
      await http()
        .patch(`/v1/admin/branches/${C}/status`)
        .set('Authorization', auth)
        .send({ active: true })
        .expect(200);
      expect(db.branch.update).toHaveBeenCalledTimes(1);
      expect(db.audit).toHaveLength(1);
      expect(db.audit[0]).toMatchObject({ action: 'branch.activated' });
    });

    it('fuera de alcance o inexistente → 404', async () => {
      await http()
        .patch(`/v1/admin/branches/${B}/status`)
        .set('Authorization', await asStaff({ branchId: A }))
        .send({ active: true })
        .expect(404);
      await http()
        .patch(`/v1/admin/branches/${MISSING}/status`)
        .set('Authorization', await asStaff())
        .send({ active: true })
        .expect(404);
    });
  });

  describe('permiso específico por operación', () => {
    it('solo branches.read: lee, pero no crea ni edita (403)', async () => {
      const auth = await asStaff({ permissions: ['branches.read'] });
      await http().get('/v1/admin/branches').set('Authorization', auth).expect(200);
      await http().get(`/v1/admin/branches/${A}`).set('Authorization', auth).expect(200);
      await http()
        .post('/v1/admin/branches')
        .set('Authorization', auth)
        .send({ code: 'nueva', name: 'N', address: 'D' })
        .expect(403);
      await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(403);
      await http()
        .patch(`/v1/admin/branches/${A}/status`)
        .set('Authorization', auth)
        .send({ active: true })
        .expect(403);
      expect(db.branch.create).not.toHaveBeenCalled();
      expect(db.branch.update).not.toHaveBeenCalled();
    });

    it('solo branches.update: edita pero no lee ni crea', async () => {
      const auth = await asStaff({ permissions: ['branches.update'] });
      await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', auth)
        .send({ name: 'Nuevo' })
        .expect(200);
      await http().get('/v1/admin/branches').set('Authorization', auth).expect(403);
      await http()
        .post('/v1/admin/branches')
        .set('Authorization', auth)
        .send({ code: 'nueva', name: 'N', address: 'D' })
        .expect(403);
    });

    it('branches.create con alcance de UNA sucursal no basta para el alta (exige global)', async () => {
      const auth = await asStaff({ permissions: ['branches.create'], branchId: A });
      await http()
        .post('/v1/admin/branches')
        .set('Authorization', auth)
        .send({ code: 'nueva', name: 'N', address: 'D' })
        .expect(403);
      expect(db.branch.create).not.toHaveBeenCalled();
    });
  });

  describe('alcance calculado por permiso y solo con asignaciones que lo tienen', () => {
    // Rol 1: `branches` solo en A. Rol 2: SIN `branches`, pero con alcance global (branch NULL).
    const mixed = (): StaffAssignmentFake[] => [
      { branchId: A, permissions: BRANCH_PERMISSIONS },
      { branchId: null, permissions: ['dashboard.read'] },
    ];

    it('POST → 403 (el alcance global de otro rol no habilita el alta)', async () => {
      await http()
        .post('/v1/admin/branches')
        .set('Authorization', await asStaffWith(mixed()))
        .send({ code: 'nueva', name: 'N', address: 'D' })
        .expect(403);
      expect(db.branch.create).not.toHaveBeenCalled();
    });

    it('PATCH y status sobre B → 404; sobre A → 200', async () => {
      const auth = await asStaffWith(mixed());
      await http()
        .patch(`/v1/admin/branches/${B}`)
        .set('Authorization', auth)
        .send({ name: 'X' })
        .expect(404);
      await http()
        .patch(`/v1/admin/branches/${B}/status`)
        .set('Authorization', auth)
        .send({ active: true })
        .expect(404);
      await http().get(`/v1/admin/branches/${B}`).set('Authorization', auth).expect(404);
      await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', auth)
        .send({ name: 'Nuevo' })
        .expect(200);
    });

    it('listado solo con A', async () => {
      const res = await http()
        .get('/v1/admin/branches')
        .set('Authorization', await asStaffWith(mixed()))
        .expect(200);
      expect(res.body).toMatchObject({ total: 1, items: [{ id: A }] });
    });

    it('una asignación global CON el permiso sí da alcance total y permite crear', async () => {
      const auth = await asStaffWith([
        { branchId: A, permissions: BRANCH_PERMISSIONS },
        { branchId: null, permissions: BRANCH_PERMISSIONS },
      ]);
      await http()
        .post('/v1/admin/branches')
        .set('Authorization', auth)
        .send({ code: 'nueva', name: 'N', address: 'D' })
        .expect(201);
      await http().get(`/v1/admin/branches/${B}`).set('Authorization', auth).expect(200);
    });

    it('consulta el alcance una sola vez por solicitud', async () => {
      await http()
        .get('/v1/admin/branches')
        .set('Authorization', await asStaff())
        .expect(200);
      expect(db.staffUser.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('robustez de entrada y caché del backoffice', () => {
    it('page enorme no produce 500: 200 vacío en el máximo y 400 por encima', async () => {
      const auth = await asStaff();
      const big = await http()
        .get('/v1/admin/branches?page=1000000&pageSize=100')
        .set('Authorization', auth)
        .expect(200);
      expect(big.body).toMatchObject({ items: [], total: 3, page: 1000000 });
      await http().get('/v1/admin/branches?page=1000001').set('Authorization', auth).expect(400);
      await http()
        .get('/v1/admin/branches?page=99999999999999999999')
        .set('Authorization', auth)
        .expect(400);
    });

    it('parámetros de consulta repetidos → 400', async () => {
      const auth = await asStaff();
      for (const qs of [
        'page=1&page=2',
        'q=a&q=b',
        'active=true&active=false',
        'sort=name&sort=code',
      ]) {
        await http().get(`/v1/admin/branches?${qs}`).set('Authorization', auth).expect(400);
      }
    });

    it('__proto__ en el cuerpo → 400 y no contamina el prototipo', async () => {
      const auth = await asStaff();
      await http()
        .post('/v1/admin/branches')
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send('{"code":"ok","name":"N","address":"D","__proto__":{"admin":true}}')
        .expect(400);
      await http()
        .patch(`/v1/admin/branches/${A}`)
        .set('Authorization', auth)
        .set('Content-Type', 'application/json')
        .send('{"__proto__":{"active":false}}')
        .expect(400);
      expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
      expect(db.branch.create).not.toHaveBeenCalled();
    });

    it('no-store en TODAS las respuestas de /v1/admin: 200, 400, 401, 403 y 404', async () => {
      const auth = await asStaff();
      const cases = [
        await http().get('/v1/admin/branches').set('Authorization', auth).expect(200),
        await http().get('/v1/admin/branches?page=0').set('Authorization', auth).expect(400),
        await http().get(`/v1/admin/branches/${MISSING}`).set('Authorization', auth).expect(404),
        await http().get('/v1/admin/branches').expect(401),
      ];
      db.staffUser.findUnique.mockResolvedValue(null); // el mismo token ya no es personal
      cases.push(await http().get('/v1/admin/branches').set('Authorization', auth).expect(403));
      for (const res of cases) expect(res.headers['cache-control']).toBe('no-store');
    });

    it('la caché pública no se contagia a otras rutas', async () => {
      const res = await http().get('/v1/health').expect(200);
      expect(res.headers['cache-control']).toBeUndefined();
    });
  });

  it('no existe DELETE', async () => {
    await http()
      .delete(`/v1/admin/branches/${A}`)
      .set('Authorization', await asStaff())
      .expect(404);
  });
});
