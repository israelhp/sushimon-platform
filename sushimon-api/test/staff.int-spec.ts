import { ConfigService } from '@nestjs/config';
import { ConflictException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { BranchesQueryService } from '../src/branches/branches-query.service.js';
import { BranchesRepository } from '../src/branches/branches.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import type { StaffContext } from '../src/identity/identity.types.js';
import { RolesService } from '../src/staff/roles.service.js';
import { StaffCommandGuard } from '../src/staff/staff-command-guard.js';
import { StaffCommandsService } from '../src/staff/staff-commands.service.js';
import { StaffQueriesService } from '../src/staff/staff-queries.service.js';
import { StaffRepository } from '../src/staff/staff.repository.js';
import { cleanupTestData, ensureAuthStub, migrate, TEST_URL, withClient } from './support/db.js';
import {
  ALL_PERMISSIONS,
  globalStaff,
  ROLE_PERMISSIONS,
  scopedStaff,
} from './support/staff-context.js';

/**
 * F03 contra PostgreSQL REAL: SQL del repositorio, trigger «admin⇔global», CHECK de vínculo y la
 * concurrencia del candado de administradores (pg_advisory_xact_lock). Requiere una base DESECHABLE o de
 * pruebas (DATABASE_URL_TEST); nunca la base de producción. Si la base contiene empleados reales activos y
 * vinculados, la suite FALLA con un mensaje explícito (no se omite en silencio).
 */
const url = TEST_URL;

/** Auditoría que siempre falla: demuestra que el cambio y su evento comparten transacción. */
class FailingAudit extends AuditService {
  override record(): Promise<void> {
    return Promise.reject(new Error('audit down'));
  }
}
const email = (tag = 'p') => `${tag}-${randomUUID().slice(0, 8)}@sushimon.test`;

describe.skipIf(!url)('Personal y RBAC contra PostgreSQL real', () => {
  let prisma: PrismaService;
  let commands: StaffCommandsService;
  let queries: StaffQueriesService;
  let roles: RolesService;
  let repo: StaffRepository;
  const roleId: Record<string, string> = {};
  const createdAuthIds = new Set<string>();
  const createdBranchIds = new Set<string>();

  const buildServices = (audit = new AuditService()) => {
    const authorization = new AuthorizationService({} as IdentityService);
    const branches = new BranchesQueryService(new BranchesRepository(prisma), authorization);
    const guard = new StaffCommandGuard(repo, audit);
    return {
      commands: new StaffCommandsService(repo, audit, authorization, branches, guard),
      queries: new StaffQueriesService(repo, authorization),
      roles: new RolesService(repo, audit, authorization, guard),
    };
  };

  const newBranch = async (active = true) => {
    const b = await prisma.branch.create({
      data: {
        code: `t${randomUUID().slice(0, 8)}`,
        name: 'Sucursal prueba',
        address: 'Zona 1',
        active,
      },
    });
    createdBranchIds.add(b.id);
    return b;
  };

  /** Empleado real. `admin` es global; el resto exige sucursal (trigger 0005). */
  async function mkStaff(
    role: 'admin' | 'manager' | 'kitchen' | 'staff',
    opts: { branchId?: string; linked?: boolean; active?: boolean; name?: string } = {},
  ) {
    const authUserId = opts.linked === false ? null : randomUUID();
    if (authUserId) {
      createdAuthIds.add(authUserId);
      await withClient(url as string, (c) =>
        c.query('INSERT INTO auth.users (id) VALUES ($1)', [authUserId]),
      );
    }
    return prisma.staffUser.create({
      data: {
        fullName: opts.name ?? 'Empleado Prueba',
        email: email(role),
        active: opts.active ?? true,
        authUserId,
        linkedAt: authUserId ? new Date() : null,
        assignments: {
          create: [
            {
              roleId: roleId[role] as string,
              branchId: role === 'admin' ? null : (opts.branchId as string),
            },
          ],
        },
      },
    });
  }

  const adminCtx = (staffId: string): StaffContext => globalStaff(ALL_PERMISSIONS, { staffId });
  const managerCtx = (staffId: string, branchIds: string[]): StaffContext =>
    scopedStaff(ROLE_PERMISSIONS['manager'] as string[], branchIds, { staffId });
  const auditOf = (entityId: string) =>
    prisma.auditEvent.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await withClient(url as string, ensureAuthStub);
    migrate(url as string);
    // Estas pruebas crean y desactivan administradores: NUNCA contra una base con administradores reales. Se falla
    // claramente (no se omite en silencio) para que nadie crea que pasaron en una base inadecuada.
    const probe = new PrismaService(
      new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url })),
    );
    const foreign = await probe.staffUser.count({
      where: {
        active: true,
        authUserId: { not: null },
        NOT: { email: { endsWith: '@sushimon.test' } },
      },
    });
    await probe.$disconnect();
    if (foreign > 0) {
      throw new Error(
        'staff.int-spec: DATABASE_URL_TEST contiene empleados reales activos y vinculados. Estas pruebas exigen una base DESECHABLE o de pruebas; no se ejecutaron.',
      );
    }
    prisma = new PrismaService(new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url })));
    repo = new StaffRepository(prisma);
    ({ commands, queries, roles } = buildServices());
    for (const r of await prisma.role.findMany()) roleId[r.code] = r.id;
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$disconnect();
    await cleanupTestData(url as string, {
      authUserIds: createdAuthIds,
      branchIds: createdBranchIds,
    });
  });
  beforeEach(async () => {
    // Estado limpio de personal de prueba entre casos (los administradores de una prueba no cuentan en la siguiente).
    await cleanupTestData(url as string, { authUserIds: [], branchIds: [] });
  });

  describe('invariantes de BD (0005)', () => {
    it('trigger: admin solo con sucursal NULL y alcance global solo con rol admin (INSERT y UPDATE)', async () => {
      const branch = await newBranch();
      const staff = await mkStaff('manager', { branchId: branch.id });
      const insert = (role: string, branchId: string | null) =>
        prisma.staffAssignment.create({
          data: { staffId: staff.id, roleId: roleId[role] as string, branchId },
        });
      await expect(insert('admin', branch.id)).rejects.toThrow();
      await expect(insert('kitchen', null)).rejects.toThrow();
      await expect(insert('manager', null)).rejects.toThrow();
      const existing = await prisma.staffAssignment.findFirstOrThrow({
        where: { staffId: staff.id },
      });
      await expect(
        prisma.staffAssignment.update({
          where: { id: existing.id },
          data: { roleId: roleId['admin'] as string },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.staffAssignment.update({ where: { id: existing.id }, data: { branchId: null } }),
      ).rejects.toThrow();
      expect(await prisma.staffAssignment.count({ where: { staffId: staff.id } })).toBe(1);
    });

    it('CHECK: no puede haber linked_at sin auth_user_id', async () => {
      await expect(
        prisma.staffUser.create({ data: { fullName: 'X', email: email(), linkedAt: new Date() } }),
      ).rejects.toThrow();
    });

    it('created_by: ON DELETE SET NULL conserva al empleado creado', async () => {
      const creator = await mkStaff('admin');
      const created = await prisma.staffUser.create({
        data: { fullName: 'Creado', email: email(), createdBy: creator.id },
      });
      await prisma.staffAssignment.deleteMany({ where: { staffId: creator.id } });
      await prisma.staffUser.delete({ where: { id: creator.id } });
      expect(
        (await prisma.staffUser.findUniqueOrThrow({ where: { id: created.id } })).createdBy,
      ).toBeNull();
    });
  });

  describe('alta (POST) contra la BD', () => {
    it('alta duplicada simultánea (mismo correo, distinta capitalización): una gana y la otra 409; una sola auditoría', async () => {
      const branch = await newBranch();
      const actor = await mkStaff('admin');
      const mail = email('dup');
      const input = (e: string) => ({
        fullName: 'Duplicado',
        email: e,
        assignments: [{ roleId: roleId['kitchen'] as string, branchId: branch.id }],
      });
      const results = await Promise.allSettled([
        commands.create(adminCtx(actor.id), input(mail)),
        commands.create(adminCtx(actor.id), input(mail.toUpperCase())),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      const rows = await prisma.staffUser.findMany({ where: { email: mail } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ authUserId: null, linkedAt: null, createdBy: actor.id });
      expect((await auditOf(rows[0]?.id as string)).map((e) => e.action)).toEqual([
        'staff.created',
      ]);
    });

    it('el encargado crea en su sucursal; intentar admin/global da 403 y deja staff.denied_escalation (transacción aparte)', async () => {
      const a = await newBranch();
      const b = await newBranch();
      const mgr = await mkStaff('manager', { branchId: a.id });
      const ctx = managerCtx(mgr.id, [a.id]);
      const ok = await commands.create(ctx, {
        fullName: 'Cocinero',
        email: email('ok'),
        assignments: [{ roleId: roleId['kitchen'] as string, branchId: a.id }],
      });
      expect(ok.identityStatus).toBe('PENDING_LINK');
      const before = await prisma.staffUser.count();
      for (const assignments of [
        [{ roleId: roleId['admin'] as string, branchId: null }],
        [{ roleId: roleId['kitchen'] as string, branchId: b.id }],
      ]) {
        await expect(
          commands.create(ctx, { fullName: 'X', email: email('no'), assignments }),
        ).rejects.toMatchObject({ status: 403 });
      }
      expect(await prisma.staffUser.count()).toBe(before);
      const denied = await auditOf(mgr.id);
      expect(denied.filter((e) => e.action === 'staff.denied_escalation')).toHaveLength(2);
    });
  });

  describe('listado y detalle (SQL real)', () => {
    it('el encargado de A ve solo personal de A, con filtros, orden, paginación y comodines escapados', async () => {
      const a = await newBranch();
      const b = await newBranch();
      const mgr = await mkStaff('manager', { branchId: a.id, name: 'Zeta Gerente' });
      const k1 = await mkStaff('kitchen', { branchId: a.id, name: '100% Cocina' });
      await mkStaff('kitchen', { branchId: a.id, name: '100X Cocina' });
      const other = await mkStaff('kitchen', { branchId: b.id, name: 'Otra Sucursal' });
      const ctx = managerCtx(mgr.id, [a.id]);

      const all = await queries.list(ctx, { pageSize: 100 });
      const ids = all.items.map((i) => i.id);
      expect(ids).toContain(k1.id);
      expect(ids).not.toContain(other.id);
      await expect(queries.get(ctx, other.id)).rejects.toMatchObject({ status: 404 });

      // `%` es literal, no comodín.
      const pct = await queries.list(ctx, { q: '100%' });
      expect(pct.items.map((i) => i.fullName)).toEqual(['100% Cocina']);

      const byBranch = await queries.list(ctx, {
        branchId: a.id,
        roleId: roleId['kitchen'],
        sort: 'fullName',
        order: 'desc',
        pageSize: 1,
        page: 1,
      });
      expect(byBranch).toMatchObject({ pageSize: 1, page: 1 });
      expect(byBranch.total).toBe(2);
      const detail = await queries.get(ctx, k1.id);
      expect(detail).toMatchObject({ identityStatus: 'LINKED', manageable: true });
      expect(JSON.stringify(detail)).not.toMatch(/authUserId|auth_user_id/);
    });
  });

  describe('último administrador (candado pg_advisory_xact_lock con la misma clave que el bootstrap)', () => {
    it('dos desactivaciones simultáneas de los dos últimos administradores: exactamente una tiene éxito, la otra 409', async () => {
      const x = await mkStaff('admin');
      const y = await mkStaff('admin');
      for (let round = 0; round < 3; round++) {
        await prisma.staffUser.updateMany({
          where: { id: { in: [x.id, y.id] } },
          data: { active: true },
        });
        const results = await Promise.allSettled([
          commands.changeStatus(adminCtx(x.id), y.id, { active: false, reason: `a${round}` }),
          commands.changeStatus(adminCtx(y.id), x.id, { active: false, reason: `b${round}` }),
        ]);
        expect(
          results.filter((r) => r.status === 'fulfilled'),
          `ronda ${round}`,
        ).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(ConflictException);
        expect(
          await prisma.staffUser.count({ where: { id: { in: [x.id, y.id] }, active: true } }),
        ).toBe(1);
      }
    });

    it('desactivar al único administrador vinculado (actor que no cuenta) → 409 y el empleado sigue activo', async () => {
      const only = await mkStaff('admin');
      const pending = await mkStaff('admin', { linked: false }); // PENDING_LINK no cuenta
      await expect(
        commands.changeStatus(adminCtx(pending.id), only.id, { active: false, reason: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((await prisma.staffUser.findUniqueOrThrow({ where: { id: only.id } })).active).toBe(
        true,
      );
      expect((await auditOf(only.id)).map((e) => e.action)).not.toContain('staff.deactivated');
    });

    it('reemplazar las asignaciones del último administrador por otro rol → 409; con otro administrador vinculado, se permite', async () => {
      const branch = await newBranch();
      const only = await mkStaff('admin');
      const pending = await mkStaff('admin', { linked: false });
      const replacement = {
        assignments: [{ roleId: roleId['manager'] as string, branchId: branch.id }],
      };
      await expect(
        commands.replaceAssignments(adminCtx(pending.id), only.id, replacement),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        await prisma.staffAssignment.count({ where: { staffId: only.id, branchId: null } }),
      ).toBe(1);
      const second = await mkStaff('admin');
      await expect(
        commands.replaceAssignments(adminCtx(second.id), only.id, replacement),
      ).resolves.toBeDefined();
    });

    it('el candado es el mismo que usa staff:bootstrap: la clave hashtextextended("app:staff-admin-guard", 0) bloquea a la API', async () => {
      const branch = await newBranch();
      const actor = await mkStaff('admin');
      const target = await mkStaff('kitchen', { branchId: branch.id });
      // Una sesión externa (como el bootstrap) retiene el candado: la desactivación debe esperar y luego completarse.
      await withClient(url as string, async (c) => {
        await c.query('BEGIN');
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended('app:staff-admin-guard', 0))");
        let done = false;
        const pendingOp = commands
          .changeStatus(adminCtx(actor.id), target.id, { active: false, reason: 'espera' })
          .then(() => {
            done = true;
          });
        await new Promise((r) => setTimeout(r, 700));
        expect(done, 'la API no debe avanzar mientras otra sesión retiene el candado').toBe(false);
        await c.query('COMMIT');
        await pendingOp;
        expect(done).toBe(true);
      });
    });
  });

  describe('reemplazo de asignaciones (PUT)', () => {
    it('transaccional con diff: las filas retiradas se eliminan y el diff queda auditado', async () => {
      const a = await newBranch();
      const b = await newBranch();
      const admin = await mkStaff('admin');
      const target = await mkStaff('kitchen', { branchId: a.id });
      const view = await commands.replaceAssignments(adminCtx(admin.id), target.id, {
        assignments: [
          { roleId: roleId['kitchen'] as string, branchId: a.id },
          { roleId: roleId['staff'] as string, branchId: b.id },
        ],
      });
      expect(view.assignments).toHaveLength(2);
      // Idempotente: sin cambios no escribe ni audita.
      await commands.replaceAssignments(adminCtx(admin.id), target.id, {
        assignments: [
          { roleId: roleId['kitchen'] as string, branchId: a.id },
          { roleId: roleId['staff'] as string, branchId: b.id },
        ],
      });
      await commands.replaceAssignments(adminCtx(admin.id), target.id, {
        assignments: [{ roleId: roleId['staff'] as string, branchId: b.id }],
      });
      expect(await prisma.staffAssignment.count({ where: { staffId: target.id } })).toBe(1);
      const changed = (await auditOf(target.id)).filter(
        (e) => e.action === 'staff.assignments_changed',
      );
      expect(changed).toHaveLength(2);
      expect(changed[1]?.newValues).toMatchObject({ removed: [`kitchen@${a.id}`], added: [] });
    });

    it('si la auditoría falla, TODO el reemplazo se revierte', async () => {
      const a = await newBranch();
      const admin = await mkStaff('admin');
      const target = await mkStaff('kitchen', { branchId: a.id });
      const failing = buildServices(new FailingAudit());
      await expect(
        failing.commands.replaceAssignments(adminCtx(admin.id), target.id, {
          assignments: [{ roleId: roleId['staff'] as string, branchId: a.id }],
        }),
      ).rejects.toThrow('audit down');
      const rows = await prisma.staffAssignment.findMany({
        where: { staffId: target.id },
        include: { role: true },
      });
      expect(rows.map((r) => r.role.code)).toEqual(['kitchen']);
    });

    it('un encargado no cambia sus propias asignaciones ni otorga fuera de su alcance (403)', async () => {
      const a = await newBranch();
      const b = await newBranch();
      const mgr = await mkStaff('manager', { branchId: a.id });
      const kitchen = await mkStaff('kitchen', { branchId: a.id });
      const ctx = managerCtx(mgr.id, [a.id]);
      await expect(
        commands.replaceAssignments(ctx, mgr.id, {
          assignments: [{ roleId: roleId['manager'] as string, branchId: b.id }],
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        commands.replaceAssignments(ctx, kitchen.id, {
          assignments: [{ roleId: roleId['kitchen'] as string, branchId: b.id }],
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('roles: permisos', () => {
    it('el administrador edita un rol no del sistema (y se restaura); admin es de solo lectura (409)', async () => {
      const admin = await mkStaff('admin');
      const original = ROLE_PERMISSIONS['staff'] as string[];
      try {
        const view = await roles.replacePermissions(adminCtx(admin.id), roleId['staff'] as string, [
          ...original,
          'orders.cancel',
        ]);
        expect(view.permissions.map((p) => p.code)).toContain('orders.cancel');
        const events = (await auditOf(roleId['staff'] as string)).filter(
          (e) => e.action === 'role.permissions_changed',
        );
        expect(events.at(-1)).toMatchObject({
          actorId: admin.id,
          entityType: 'role',
          newValues: { added: ['orders.cancel'], removed: [] },
        });
        await expect(
          roles.replacePermissions(adminCtx(admin.id), roleId['admin'] as string, ['orders.read']),
        ).rejects.toMatchObject({ status: 409 });
        expect(
          await prisma.rolePermission.count({ where: { roleId: roleId['admin'] as string } }),
        ).toBe(ALL_PERMISSIONS.length);
      } finally {
        await roles.replacePermissions(adminCtx(admin.id), roleId['staff'] as string, original);
      }
      expect(
        await prisma.rolePermission.count({ where: { roleId: roleId['staff'] as string } }),
      ).toBe(original.length);
    });

    it('añadir un permiso que el actor no posee globalmente → 403 y evento de seguridad', async () => {
      const a = await newBranch();
      const mgr = await mkStaff('manager', { branchId: a.id });
      const actor = globalStaff(['roles.manage', 'orders.read'], { staffId: mgr.id });
      await expect(
        roles.replacePermissions(actor, roleId['staff'] as string, [
          ...(ROLE_PERMISSIONS['staff'] as string[]),
          'payments.refund',
        ]),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await auditOf(roleId['staff'] as string)).filter(
          (e) => e.action === 'staff.denied_escalation',
        ),
      ).toHaveLength(1);
    });

    it('lista de roles con empleados activos asignados y catálogo de 43 permisos', async () => {
      const a = await newBranch();
      await mkStaff('kitchen', { branchId: a.id });
      const { items } = await roles.list();
      expect(items.find((r) => r.code === 'kitchen')?.assignedStaffCount).toBeGreaterThanOrEqual(1);
      const catalog = await roles.permissions();
      expect(catalog.items.reduce((n, m) => n + m.permissions.length, 0)).toBe(43);
    });
  });
});
