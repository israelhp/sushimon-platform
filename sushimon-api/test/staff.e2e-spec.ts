import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FakeStaffRepo } from './support/fake-staff-repo.js';
import { ROLE_PERMISSIONS } from './support/staff-context.js';
import {
  assignmentRecord,
  BRANCH_A,
  BRANCH_B,
  BRANCH_C,
  ROLE_IDS,
  staffRecord,
} from './support/staff-fixtures.js';
import { createTestKeys, type TestKeys } from './support/tokens.js';

const ACTOR = '99999999-9999-4999-8999-999999999999';
const T1 = 'cccccccc-0000-4000-8000-000000000001'; // cocina en A
const T2 = 'cccccccc-0000-4000-8000-000000000002'; // cocina en B
const T3 = 'cccccccc-0000-4000-8000-000000000003'; // otro administrador
const MISSING = 'cccccccc-0000-4000-8000-0000000000ff';
const AAL2 = {
  aal: 'aal2',
  amr: [
    { method: 'oauth', timestamp: 1 },
    { method: 'totp', timestamp: 2 },
  ],
};
const role = (code: string) => ROLE_IDS[code] as string;

type Json = Record<string, unknown>;

/** Fila que devuelve el PrismaService falso para `loadStaff` (el contexto de autorización del actor). */
function actorRow(roleCode: string, branchIds: string[], over: { active?: boolean } = {}) {
  const permissions = (ROLE_PERMISSIONS[roleCode] as string[]).map((code) => ({
    permission: { code },
  }));
  const branches = roleCode === 'admin' ? [null] : branchIds;
  return {
    id: ACTOR,
    fullName: 'Marta Actora',
    active: over.active ?? true,
    assignments: branches.map((b) => ({
      active: true,
      branchId: b,
      branch: b ? { id: b, name: `Sucursal ${b[0]}`, code: `s-${b[0]}`, active: true } : null,
      role: { code: roleCode, permissions },
    })),
  };
}

async function createApp(keys: TestKeys, repo: FakeStaffRepo, prisma: unknown) {
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
  const { StaffRepository } = await import('../src/staff/staff.repository.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(StaffRepository)
    .useValue(repo)
    .overrideProvider(JWKS_RESOLVER)
    .useValue(keys.jwks)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return app;
}

describe('Personal, roles y permisos (e2e)', () => {
  let keys: TestKeys;
  let app: NestExpressApplication;
  let repo: FakeStaffRepo;
  let prisma: ReturnType<typeof fakePrisma>;
  const http = () => request(app.getHttpServer());
  const call = (method: string, path: string): request.Test => {
    const server = http();
    switch (method) {
      case 'get':
        return server.get(path);
      case 'post':
        return server.post(path);
      case 'patch':
        return server.patch(path);
      case 'put':
        return server.put(path);
      default:
        throw new Error(`método no soportado: ${method}`);
    }
  };

  function fakePrisma() {
    const db = {
      customer: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      staffUser: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      branch: {
        findFirst: vi.fn((a: { where: { id: string } }) => {
          const b = repo.branches.get(a.where.id);
          return Promise.resolve(b?.active ? { id: b.id } : null);
        }),
        findMany: vi.fn(() =>
          Promise.resolve(
            [...repo.branches.values()]
              .filter((b) => b.active)
              .map((b) => ({ id: b.id, name: b.name, code: b.code })),
          ),
        ),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(),
      $disconnect: () => Promise.resolve(),
    };
    db.$transaction.mockImplementation((fn: (tx: typeof db) => Promise<unknown>) => fn(db));
    return db;
  }

  /** Autentica como un empleado con ese rol y alcance (los permisos salen de la "BD", no del token). */
  const as = async (
    roleCode: string,
    branchIds: string[] = [],
    claims: Record<string, unknown> = AAL2,
    over: { active?: boolean } = {},
  ) => {
    prisma.staffUser.findUnique.mockResolvedValue(actorRow(roleCode, branchIds, over));
    return `Bearer ${await keys.sign(claims)}`;
  };

  beforeAll(async () => {
    keys = await createTestKeys();
  });
  beforeEach(async () => {
    repo = new FakeStaffRepo();
    repo.branches.set(BRANCH_A, { id: BRANCH_A, name: 'Zona 10', code: 'zona-10', active: true });
    repo.branches.set(BRANCH_B, { id: BRANCH_B, name: 'Zona 14', code: 'zona-14', active: true });
    repo.branches.set(BRANCH_C, { id: BRANCH_C, name: 'Oakland', code: 'oakland', active: false });
    repo.seed(
      staffRecord(ACTOR, [assignmentRecord('manager', BRANCH_A)], {
        fullName: 'Marta Actora',
        email: 'marta@sushimon.test',
      }),
      staffRecord(T1, [assignmentRecord('kitchen', BRANCH_A)], {
        fullName: 'Ana Cocina',
        email: 'ana@sushimon.test',
      }),
      staffRecord(T2, [assignmentRecord('kitchen', BRANCH_B)], {
        fullName: 'Beto Cocina',
        email: 'beto@sushimon.test',
      }),
      staffRecord(T3, [assignmentRecord('admin', null)], {
        fullName: 'Tomás Admin',
        email: 'tomas@sushimon.test',
      }),
    );
    prisma = fakePrisma();
    // Cliente `tx` de las transacciones del doble: releer al actor y bloquear sucursales (FOR SHARE) dentro de la tx.
    repo.txExtras = {
      staffUser: prisma.staffUser,
      $queryRaw: (_sql: unknown, ids: string[]) =>
        Promise.resolve(ids.filter((id) => repo.branches.get(id)?.active).map((id) => ({ id }))),
    };
    app = await createApp(keys, repo, prisma);
  });
  afterEach(async () => {
    await app.close();
  });

  describe('autenticación y autorización', () => {
    const routes: [string, string][] = [
      ['get', '/v1/admin/staff'],
      ['post', '/v1/admin/staff'],
      ['get', `/v1/admin/staff/${T1}`],
      ['patch', `/v1/admin/staff/${T1}`],
      ['patch', `/v1/admin/staff/${T1}/status`],
      ['put', `/v1/admin/staff/${T1}/assignments`],
      ['get', '/v1/admin/roles'],
      ['get', `/v1/admin/roles/${role('kitchen')}`],
      ['put', `/v1/admin/roles/${role('kitchen')}/permissions`],
      ['get', '/v1/admin/permissions'],
    ];

    it.each(routes)('sin JWT → 401 (%s %s)', async (method, path) => {
      const res = await call(method, path);
      expect(res.status).toBe(401);
    });

    it('JWT inválido (firma ajena, malformado) → 401', async () => {
      for (const token of [await keys.signWithForeignKey(AAL2), 'x.y.z']) {
        await http().get('/v1/admin/staff').set('Authorization', `Bearer ${token}`).expect(401);
      }
    });

    it.each(routes)(
      'un cliente (sin fila de personal) → 403 genérico (%s %s)',
      async (method, path) => {
        const res = await call(method, path)
          .set('Authorization', `Bearer ${await keys.sign(AAL2)}`)
          .send({});
        expect(res.status).toBe(403);
        expect((res.body as Json)['message']).toBe('Acceso denegado');
      },
    );

    it('personal con permisos pero sesión aal1 → 403 MFA_REQUIRED y no toca datos', async () => {
      const res = await http()
        .get('/v1/admin/staff')
        .set('Authorization', await as('admin', [], {}))
        .expect(403);
      expect((res.body as Json)['message']).toBe('MFA_REQUIRED');
    });

    it('aal2 sin el permiso (cocina) → 403 en todas las operaciones', async () => {
      const auth = await as('kitchen', [BRANCH_A]);
      for (const [method, path] of routes) {
        const res = await call(method, path).set('Authorization', auth).send({});
        expect(res.status, `${method} ${path}`).toBe(403);
      }
      expect(repo.audit).toEqual([]);
    });

    it('empleado desactivado → 403 en la siguiente solicitud con el mismo JWT', async () => {
      const claims = AAL2;
      const auth = await as('admin', [], claims);
      await http().get('/v1/admin/staff').set('Authorization', auth).expect(200);
      await as('admin', [], claims, { active: false });
      await http().get('/v1/admin/staff').set('Authorization', auth).expect(403);
    });

    it('el rol del encargado no permite gestionar roles: PUT roles/{id}/permissions → 403 sin cambios', async () => {
      await http()
        .put(`/v1/admin/roles/${role('kitchen')}/permissions`)
        .set('Authorization', await as('manager', [BRANCH_A]))
        .send({ permissions: ['orders.read', 'payments.refund'] })
        .expect(403);
      expect(repo.roles.get(role('kitchen'))?.permissions.has('payments.refund')).toBe(false);
      expect(repo.audit).toEqual([]);
    });
  });

  describe('lectura', () => {
    it('administrador: lista todo con la forma del contrato, sin authUserId; no-store', async () => {
      const res = await http()
        .get('/v1/admin/staff')
        .set('Authorization', await as('admin'))
        .expect(200);
      const body = res.body as { items: Json[]; total: number; page: number; pageSize: number };
      expect(body).toMatchObject({ total: 4, page: 1, pageSize: 20 });
      expect(Object.keys(body.items[0] as Json).sort()).toEqual(
        [
          'active',
          'assignments',
          'createdAt',
          'createdBy',
          'email',
          'fullName',
          'id',
          'identityStatus',
          'linkedAt',
          'manageable',
        ].sort(),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/authUserId|auth_user_id/);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('el encargado de A ve solo personal de A; el empleado de B no aparece y su detalle da 404', async () => {
      const auth = await as('manager', [BRANCH_A]);
      const list = await http().get('/v1/admin/staff').set('Authorization', auth).expect(200);
      const names = (list.body as { items: { fullName: string }[] }).items.map((i) => i.fullName);
      expect(names).toEqual(['Ana Cocina', 'Marta Actora']);
      await http().get(`/v1/admin/staff/${T1}`).set('Authorization', auth).expect(200);
      const other = await http()
        .get(`/v1/admin/staff/${T2}`)
        .set('Authorization', auth)
        .expect(404);
      const missing = await http()
        .get(`/v1/admin/staff/${MISSING}`)
        .set('Authorization', auth)
        .expect(404);
      expect((other.body as Json)['message']).toBe((missing.body as Json)['message']);
      // El administrador global tampoco es visible para el encargado.
      await http().get(`/v1/admin/staff/${T3}`).set('Authorization', auth).expect(404);
    });

    it('parámetros inválidos → 400 (uuid, límites, enumeraciones)', async () => {
      const auth = await as('admin');
      for (const qs of [
        'pageSize=101',
        'page=0',
        'sort=hack',
        'order=up',
        'active=quizas',
        'branchId=xyz',
        'identityStatus=X',
        `q=${'a'.repeat(101)}`,
      ]) {
        await http().get(`/v1/admin/staff?${qs}`).set('Authorization', auth).expect(400);
      }
      await http().get('/v1/admin/staff/no-es-uuid').set('Authorization', auth).expect(400);
    });

    it('filtros por estado de vínculo, activo y búsqueda', async () => {
      repo.seed(
        staffRecord(
          'cccccccc-0000-4000-8000-0000000000a1',
          [assignmentRecord('kitchen', BRANCH_A)],
          { fullName: 'Pendiente', linked: false, linkedAt: null },
        ),
      );
      const auth = await as('admin');
      const res = await http()
        .get('/v1/admin/staff?identityStatus=PENDING_LINK')
        .set('Authorization', auth)
        .expect(200);
      expect((res.body as { items: Json[] }).items).toMatchObject([
        { fullName: 'Pendiente', identityStatus: 'PENDING_LINK', linkedAt: null },
      ]);
      const q = await http().get('/v1/admin/staff?q=ANA').set('Authorization', auth).expect(200);
      expect((q.body as { total: number }).total).toBe(1);
    });

    it('roles y permisos: encargado (roles.read) lee; el catálogo tiene 46 permisos agrupados', async () => {
      const auth = await as('manager', [BRANCH_A]);
      const roles = await http().get('/v1/admin/roles').set('Authorization', auth).expect(200);
      const items = (roles.body as { items: { code: string; isSystem: boolean }[] }).items;
      expect(items.map((r) => r.code).sort()).toEqual(['admin', 'kitchen', 'manager', 'staff']);
      expect(items.find((r) => r.code === 'admin')?.isSystem).toBe(true);
      await http()
        .get(`/v1/admin/roles/${role('kitchen')}`)
        .set('Authorization', auth)
        .expect(200);
      await http().get('/v1/admin/roles/xyz').set('Authorization', auth).expect(400);
      await http().get(`/v1/admin/roles/${MISSING}`).set('Authorization', auth).expect(404);
      const cat = await http().get('/v1/admin/permissions').set('Authorization', auth).expect(200);
      const modules = (cat.body as { items: { permissions: unknown[] }[] }).items;
      expect(modules.reduce((n, m) => n + m.permissions.length, 0)).toBe(46);
    });
  });

  describe('POST /v1/admin/staff', () => {
    const body = (over: Json = {}) => ({
      fullName: 'Luis Pérez',
      email: 'Luis@Sushimon.test',
      assignments: [{ roleId: role('kitchen'), branchId: BRANCH_A }],
      ...over,
    });

    it('encargado crea personal en su sucursal: 201, PENDING_LINK, correo normalizado, auditoría', async () => {
      const res = await http()
        .post('/v1/admin/staff')
        .set('Authorization', await as('manager', [BRANCH_A]))
        .send(body())
        .expect(201);
      expect(res.body).toMatchObject({
        email: 'luis@sushimon.test',
        identityStatus: 'PENDING_LINK',
        linkedAt: null,
        active: true,
        createdBy: { id: ACTOR },
        manageable: true,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/authUserId/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(repo.audit.map((e) => e.action)).toEqual(['staff.created']);
      expect(repo.audit[0]).toMatchObject({ actorId: ACTOR, entityType: 'staff_user' });
      expect(JSON.stringify(repo.audit)).not.toContain('@sushimon.test');
    });

    it('correo duplicado → 409 (con otra capitalización)', async () => {
      await http()
        .post('/v1/admin/staff')
        .set('Authorization', await as('admin'))
        .send(body({ email: 'ANA@sushimon.test' }))
        .expect(409);
      expect(repo.audit).toEqual([]);
    });

    it('el encargado no otorga admin ni alcance global ni otra sucursal: 403 y evento de seguridad', async () => {
      const auth = await as('manager', [BRANCH_A]);
      for (const assignments of [
        [{ roleId: role('admin'), branchId: null }],
        [{ roleId: role('manager'), branchId: null }],
        [{ roleId: role('kitchen'), branchId: BRANCH_B }],
      ]) {
        const res = await http()
          .post('/v1/admin/staff')
          .set('Authorization', auth)
          .send(body({ assignments }))
          .expect(403);
        expect((res.body as Json)['message']).toBe('Acceso denegado');
      }
      expect(repo.staff.size).toBe(4);
      expect(new Set(repo.audit.map((e) => e.action))).toEqual(
        new Set(['staff.denied_escalation']),
      );
    });

    it('rol inexistente → 400; sucursal inactiva → 400; admin con sucursal → 400', async () => {
      const auth = await as('admin');
      await http()
        .post('/v1/admin/staff')
        .set('Authorization', auth)
        .send(
          body({
            assignments: [{ roleId: 'aaaaaaaa-9999-4999-8999-999999999999', branchId: BRANCH_A }],
          }),
        )
        .expect(400);
      await http()
        .post('/v1/admin/staff')
        .set('Authorization', auth)
        .send(body({ assignments: [{ roleId: role('kitchen'), branchId: BRANCH_C }] }))
        .expect(400);
      await http()
        .post('/v1/admin/staff')
        .set('Authorization', auth)
        .send(body({ assignments: [{ roleId: role('admin'), branchId: BRANCH_A }] }))
        .expect(400);
    });

    it('validación de entrada: authUserId y campos extra, sin asignaciones, correo, uuid, >20 → 400', async () => {
      const auth = await as('admin');
      const bad: Json[] = [
        body({ authUserId: '3f2b8a52-6f0e-4a57-9d46-0c1f1d8c2a11' }),
        body({ active: false }),
        body({ assignments: [] }),
        body({ email: 'no-es-correo' }),
        body({ fullName: '' }),
        body({ assignments: [{ roleId: 'x', branchId: BRANCH_A }] }),
        body({ assignments: [{ roleId: role('kitchen') }] }),
        body({
          assignments: Array.from({ length: 21 }, () => ({
            roleId: role('kitchen'),
            branchId: BRANCH_A,
          })),
        }),
        body({ assignments: [{ roleId: role('kitchen'), branchId: BRANCH_A, extra: 1 }] }),
        { fullName: 'x' },
      ];
      for (const b of bad) {
        await http().post('/v1/admin/staff').set('Authorization', auth).send(b).expect(400);
      }
      expect(repo.staff.size).toBe(4);
    });
  });

  describe('PATCH /v1/admin/staff/{id}', () => {
    it('actualiza nombre y audita solo el nombre del campo (sin PII)', async () => {
      const res = await http()
        .patch(`/v1/admin/staff/${T1}`)
        .set('Authorization', await as('manager', [BRANCH_A]))
        .send({ fullName: 'Ana María' })
        .expect(200);
      expect(res.body).toMatchObject({ fullName: 'Ana María' });
      expect(repo.audit[0]).toMatchObject({
        action: 'staff.updated',
        newValues: { changedFields: ['fullName'] },
      });
      expect(JSON.stringify(repo.audit)).not.toMatch(/Ana/);
    });

    it('empleado de otra sucursal → 404; correo vinculado → 409; campos no permitidos → 400', async () => {
      const auth = await as('manager', [BRANCH_A]);
      await http()
        .patch(`/v1/admin/staff/${T2}`)
        .set('Authorization', auth)
        .send({ fullName: 'X' })
        .expect(404);
      await http()
        .patch(`/v1/admin/staff/${T1}`)
        .set('Authorization', auth)
        .send({ email: 'otro@sushimon.test' })
        .expect(409);
      await http()
        .patch(`/v1/admin/staff/${T1}`)
        .set('Authorization', auth)
        .send({ active: false })
        .expect(400);
      await http()
        .patch(`/v1/admin/staff/${T1}`)
        .set('Authorization', auth)
        .send({ authUserId: ACTOR })
        .expect(400);
    });

    it('autoedición: solo fullName; su propio correo → 403', async () => {
      const auth = await as('manager', [BRANCH_A]);
      await http()
        .patch(`/v1/admin/staff/${ACTOR}`)
        .set('Authorization', auth)
        .send({ fullName: 'Marta D.' })
        .expect(200);
      await http()
        .patch(`/v1/admin/staff/${ACTOR}`)
        .set('Authorization', auth)
        .send({ email: 'otra@sushimon.test' })
        .expect(403);
    });
  });

  describe('PATCH /v1/admin/staff/{id}/status', () => {
    it('desactiva con motivo y audita; sin motivo → 400', async () => {
      const auth = await as('manager', [BRANCH_A]);
      await http()
        .patch(`/v1/admin/staff/${T1}/status`)
        .set('Authorization', auth)
        .send({ active: false })
        .expect(400);
      const res = await http()
        .patch(`/v1/admin/staff/${T1}/status`)
        .set('Authorization', auth)
        .send({ active: false, reason: 'Renunció' })
        .expect(200);
      expect(res.body).toMatchObject({ active: false });
      expect(repo.audit[0]).toMatchObject({ action: 'staff.deactivated', reason: 'Renunció' });
    });

    it('no se puede autoactivar/desactivar: 403', async () => {
      const auth = await as('manager', [BRANCH_A]);
      await http()
        .patch(`/v1/admin/staff/${ACTOR}/status`)
        .set('Authorization', auth)
        .send({ active: false, reason: 'x' })
        .expect(403);
      await http()
        .patch(`/v1/admin/staff/${ACTOR}/status`)
        .set('Authorization', auth)
        .send({ active: true })
        .expect(403);
      expect(repo.staff.get(ACTOR)?.active).toBe(true);
    });

    it('un encargado no gestiona a un administrador (404, no es visible) ni al de otra sucursal (404)', async () => {
      const auth = await as('manager', [BRANCH_A]);
      await http()
        .patch(`/v1/admin/staff/${T3}/status`)
        .set('Authorization', auth)
        .send({ active: false, reason: 'x' })
        .expect(404);
      await http()
        .patch(`/v1/admin/staff/${T2}/status`)
        .set('Authorization', auth)
        .send({ active: false, reason: 'x' })
        .expect(404);
    });

    it('último administrador: desactivarlo → 409 (HTTP)', async () => {
      repo.staff.delete(ACTOR); // el único administrador es T3; el actor administrador no está en la tabla
      await http()
        .patch(`/v1/admin/staff/${T3}/status`)
        .set('Authorization', await as('admin'))
        .send({ active: false, reason: 'baja' })
        .expect(409);
      expect(repo.staff.get(T3)?.active).toBe(true);
    });
  });

  describe('PUT /v1/admin/staff/{id}/assignments', () => {
    it('el administrador reemplaza asignaciones y se audita el diff', async () => {
      const res = await http()
        .put(`/v1/admin/staff/${T1}/assignments`)
        .set('Authorization', await as('admin'))
        .send({ assignments: [{ roleId: role('manager'), branchId: BRANCH_B }] })
        .expect(200);
      expect(
        (res.body as { assignments: { role: { code: string } }[] }).assignments[0]?.role.code,
      ).toBe('manager');
      expect(repo.audit[0]).toMatchObject({ action: 'staff.assignments_changed' });
    });

    it('el encargado no otorga admin/global (403) ni cambia las propias (403); rol inexistente 400', async () => {
      const auth = await as('manager', [BRANCH_A]);
      await http()
        .put(`/v1/admin/staff/${T1}/assignments`)
        .set('Authorization', auth)
        .send({ assignments: [{ roleId: role('admin'), branchId: null }] })
        .expect(403);
      await http()
        .put(`/v1/admin/staff/${ACTOR}/assignments`)
        .set('Authorization', auth)
        .send({
          assignments: [
            { roleId: role('manager'), branchId: BRANCH_A },
            { roleId: role('manager'), branchId: BRANCH_B },
          ],
        })
        .expect(403);
      await http()
        .put(`/v1/admin/staff/${T1}/assignments`)
        .set('Authorization', auth)
        .send({
          assignments: [{ roleId: 'aaaaaaaa-9999-4999-8999-999999999999', branchId: BRANCH_A }],
        })
        .expect(400);
      expect(repo.staff.get(T1)?.assignments).toHaveLength(1);
      expect(repo.audit.map((e) => e.action)).toEqual([
        'staff.denied_escalation',
        'staff.denied_escalation',
      ]);
    });

    it('validación: vacío, duplicados y campos extra → 400', async () => {
      const auth = await as('admin');
      await http()
        .put(`/v1/admin/staff/${T1}/assignments`)
        .set('Authorization', auth)
        .send({ assignments: [] })
        .expect(400);
      await http()
        .put(`/v1/admin/staff/${T1}/assignments`)
        .set('Authorization', auth)
        .send({
          assignments: [
            { roleId: role('kitchen'), branchId: BRANCH_A },
            { roleId: role('kitchen'), branchId: BRANCH_A },
          ],
        })
        .expect(400);
      await http()
        .put(`/v1/admin/staff/${T1}/assignments`)
        .set('Authorization', auth)
        .send({ assignments: [{ roleId: role('kitchen'), branchId: BRANCH_A }], x: 1 })
        .expect(400);
    });
  });

  describe('PUT /v1/admin/roles/{id}/permissions', () => {
    it('el administrador edita un rol no del sistema: 200 y auditoría role.permissions_changed', async () => {
      const res = await http()
        .put(`/v1/admin/roles/${role('kitchen')}/permissions`)
        .set('Authorization', await as('admin'))
        .send({ permissions: ['orders.read', 'orders.accept'] })
        .expect(200);
      expect(
        (res.body as { permissions: { code: string }[] }).permissions.map((p) => p.code),
      ).toEqual(['orders.accept', 'orders.read']);
      expect(repo.audit[0]).toMatchObject({
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: role('kitchen'),
      });
    });

    it('el rol admin es de solo lectura (409); permisos desconocidos o mal formados → 400; inexistente → 404', async () => {
      const auth = await as('admin');
      await http()
        .put(`/v1/admin/roles/${role('admin')}/permissions`)
        .set('Authorization', auth)
        .send({ permissions: ['orders.read'] })
        .expect(409);
      await http()
        .put(`/v1/admin/roles/${role('kitchen')}/permissions`)
        .set('Authorization', auth)
        .send({ permissions: ['orders.read', 'x.y'] })
        .expect(400);
      for (const permissions of [
        [],
        ['ORDERS.READ'],
        ['orders.read', 'orders.read'],
        'orders.read',
      ]) {
        await http()
          .put(`/v1/admin/roles/${role('kitchen')}/permissions`)
          .set('Authorization', auth)
          .send({ permissions })
          .expect(400);
      }
      await http()
        .put(`/v1/admin/roles/${MISSING}/permissions`)
        .set('Authorization', auth)
        .send({ permissions: ['orders.read'] })
        .expect(404);
    });
  });

  describe('contexto de autorización', () => {
    it('GET /v1/admin/me/context incluye grants por permiso y branches', async () => {
      const res = await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await as('manager', [BRANCH_A]))
        .expect(200);
      const staff = (
        res.body as {
          staff: { grants: Record<string, unknown>; branches: unknown[]; permissions: string[] };
        }
      ).staff;
      expect(staff.grants['staff.read']).toEqual({ allBranches: false, branchIds: [BRANCH_A] });
      expect(staff.grants['roles.manage']).toBeUndefined();
      expect(staff.branches).toEqual([{ id: BRANCH_A, name: 'Sucursal 1', code: 's-1' }]);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('administrador: alcance global y todas las sucursales ACTIVAS', async () => {
      const res = await http()
        .get('/v1/admin/me/context')
        .set('Authorization', await as('admin'))
        .expect(200);
      const staff = (
        res.body as {
          staff: { grants: Record<string, { allBranches: boolean }>; branches: { id: string }[] };
        }
      ).staff;
      expect(staff.grants['roles.manage']?.allBranches).toBe(true);
      expect(staff.branches.map((b) => b.id).sort()).toEqual([BRANCH_A, BRANCH_B].sort());
    });
  });

  describe('no-store en todo el backoffice, incluidos errores', () => {
    it('2xx, 4xx y 5xx llevan Cache-Control: no-store', async () => {
      const auth = await as('manager', [BRANCH_A]);
      for (const res of [
        await http().get('/v1/admin/staff').set('Authorization', auth),
        await http().get(`/v1/admin/staff/${T2}`).set('Authorization', auth),
        await http().get('/v1/admin/staff'),
        await http().patch('/v1/admin/staff/xyz').set('Authorization', auth).send({}),
      ]) {
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });
  });

  describe('permisos del actor vigentes al escribir', () => {
    it('actor desactivado entre el guard y el comando → 403 y NADA se muta (todas las escrituras)', async () => {
      const token = `Bearer ${await keys.sign(AAL2)}`;
      const active = actorRow('admin', []);
      const inactive = actorRow('admin', [], { active: false });
      const attempts: (() => request.Test)[] = [
        () =>
          http()
            .post('/v1/admin/staff')
            .send({
              fullName: 'Luis',
              email: 'luis@sushimon.test',
              assignments: [{ roleId: role('kitchen'), branchId: BRANCH_A }],
            }),
        () => http().patch(`/v1/admin/staff/${T1}/status`).send({ active: false, reason: 'x' }),
        () =>
          http()
            .put(`/v1/admin/staff/${T1}/assignments`)
            .send({ assignments: [{ roleId: role('staff'), branchId: BRANCH_A }] }),
        () =>
          http()
            .put(`/v1/admin/roles/${role('kitchen')}/permissions`)
            .send({ permissions: ['orders.read'] }),
      ];
      for (const attempt of attempts) {
        // 1.ª lectura (guard): activo. 2.ª (dentro de la transacción, tras el candado): ya desactivado.
        prisma.staffUser.findUnique.mockReset();
        prisma.staffUser.findUnique.mockResolvedValueOnce(active).mockResolvedValue(inactive);
        await attempt().set('Authorization', token).expect(403);
      }
      expect(repo.staff.size).toBe(4);
      expect(repo.staff.get(T1)).toMatchObject({ active: true });
      expect(repo.staff.get(T1)?.assignments).toHaveLength(1);
      expect(repo.roles.get(role('kitchen'))?.permissions.size).toBe(5);
      expect(new Set(repo.audit.map((e) => e.reason))).toEqual(
        new Set(['actor_no_longer_authorized']),
      );
    });
  });

  describe('auditoría atómica', () => {
    it('si la auditoría falla, el alta no queda a medias y la respuesta es 500 genérica', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      repo.failNext.set('audit', new Error('audit down: secreto-interno'));
      const res = await http()
        .post('/v1/admin/staff')
        .set('Authorization', await as('admin'))
        .send({
          fullName: 'Luis',
          email: 'luis@sushimon.test',
          assignments: [{ roleId: role('kitchen'), branchId: BRANCH_A }],
        })
        .expect(500);
      expect(JSON.stringify(res.body)).not.toContain('secreto-interno');
      expect(repo.staff.size).toBe(4);
    });
  });
});
