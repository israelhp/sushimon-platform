import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Principal } from '../src/auth/auth.types.js';
import { AuditService } from '../src/audit/audit.service.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { IdentityService } from '../src/identity/identity.service.js';
import { cleanupTestData, ensureAuthStub, migrate, TEST_URL, withClient } from './support/db.js';

const url = TEST_URL;

/** Auditoría que siempre falla: demuestra que el cambio y su evento comparten transacción. */
class FailingAudit extends AuditService {
  override record(): Promise<void> {
    return Promise.reject(new Error('audit down'));
  }
}

function principal(over: Partial<Principal> = {}): Principal {
  return {
    authUserId: randomUUID(),
    email: `${randomUUID().slice(0, 8)}@sushimon.test`,
    provider: 'google',
    googleOAuth: true,
    aal: 'aal1',
    displayName: 'Persona Prueba',
    avatarUrl: null,
    ...over,
  };
}

describe.skipIf(!url)('Identidad contra PostgreSQL real', () => {
  let prisma: PrismaService;
  let identity: IdentityService;

  // Lo creado por las pruebas, para limpiarlo al final (permite ejecutarlas contra un proyecto de pruebas).
  const createdAuthIds = new Set<string>();
  const createdBranchIds = new Set<string>();
  const authUser = (id: string) => {
    createdAuthIds.add(id);
    return withClient(url as string, (c) =>
      c.query('INSERT INTO auth.users (id) VALUES ($1)', [id]),
    );
  };

  const newBranch = async () => {
    const branch = await prisma.branch.create({
      data: { code: `b-${randomUUID().slice(0, 6)}`, name: 'Sucursal', address: 'Zona 1' },
    });
    createdBranchIds.add(branch.id);
    return branch;
  };

  /** Preautoriza: `admin` es global (trigger 0005); cualquier otro rol necesita sucursal (se crea una si falta). */
  async function preregister(
    email: string,
    opts: { active?: boolean; role?: string; branchId?: string | null } = {},
  ) {
    const code = opts.role ?? 'admin';
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    const branchId = code === 'admin' ? null : (opts.branchId ?? (await newBranch()).id);
    return prisma.staffUser.create({
      data: {
        fullName: 'Empleado Prueba',
        email,
        active: opts.active ?? true,
        assignments: { create: [{ roleId: role.id, branchId }] },
      },
    });
  }

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await withClient(url as string, ensureAuthStub);
    migrate(url as string);
    prisma = new PrismaService(
      new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url, NODE_ENV: 'test' })),
    );
    identity = new IdentityService(prisma, new AuditService());
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await cleanupTestData(url as string, {
      authUserIds: createdAuthIds,
      branchIds: createdBranchIds,
    });
  });

  describe('clientes', () => {
    it('el primer acceso crea el perfil y es idempotente, también con solicitudes simultáneas', async () => {
      const p = principal();
      await authUser(p.authUserId);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => identity.ensureCustomer(p)),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(await prisma.customer.count({ where: { authUserId: p.authUserId } })).toBe(1);
      expect(results[0]).toMatchObject({ fullName: 'Persona Prueba', email: p.email });
    });

    it('la FK a auth.users impide un cliente con identidad inexistente', async () => {
      await expect(
        prisma.customer.create({ data: { authUserId: randomUUID(), fullName: 'Huérfano' } }),
      ).rejects.toThrow();
    });
  });

  describe('empleados (brecha: staff_users.auth_user_id)', () => {
    it('vincula una sola vez por correo verificado y conserva permisos del rol', async () => {
      const p = principal();
      await authUser(p.authUserId);
      const row = await preregister(p.email as string);
      expect(row.authUserId).toBeNull();

      const ctx = await identity.getStaffContext(p);
      expect(ctx).toMatchObject({ staffId: row.id, allBranches: true, branchIds: [] });
      expect(ctx?.permissions).toHaveLength(46);
      expect(ctx?.grants['staff.assign_roles']).toEqual({ allBranches: true, branchIds: [] });
      const linked = await prisma.staffUser.findUniqueOrThrow({ where: { id: row.id } });
      expect(linked.authUserId).toBe(p.authUserId);
      // F03: el vínculo fija linked_at y deja `staff.linked` (sin correo ni auth_user_id) en la misma transacción.
      expect(linked.linkedAt).toBeInstanceOf(Date);
      const events = await prisma.auditEvent.findMany({
        where: { entityId: row.id, action: 'staff.linked' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: row.id,
        entityType: 'staff_user',
        newValues: { identityStatus: 'LINKED' },
      });
      expect(JSON.stringify(events[0])).not.toContain(p.authUserId);
      expect(JSON.stringify(events[0])).not.toContain(p.email as string);
      // Segunda llamada: ya vinculado, mismo resultado y sin segundo evento.
      await expect(identity.getStaffContext(p)).resolves.toMatchObject({ staffId: row.id });
      expect(
        await prisma.auditEvent.count({ where: { entityId: row.id, action: 'staff.linked' } }),
      ).toBe(1);
    });

    it('si la auditoría falla, el vínculo se revierte (misma transacción): la fila sigue sin vincular', async () => {
      const p = principal();
      await authUser(p.authUserId);
      const row = await preregister(p.email as string);
      const failing = new IdentityService(prisma, new FailingAudit());
      await expect(failing.getStaffContext(p)).rejects.toThrow('audit down');
      const after = await prisma.staffUser.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.authUserId).toBeNull();
      expect(after.linkedAt).toBeNull();
    });

    it('un cliente (con perfil) NUNCA se vuelve empleado: sin preautorización no se crea ni vincula personal', async () => {
      const p = principal();
      await authUser(p.authUserId);
      await identity.ensureCustomer(p);
      const before = await prisma.staffUser.count();
      await expect(identity.getStaffContext(p)).resolves.toBeNull();
      expect(await prisma.staffUser.count()).toBe(before);
      expect(await prisma.staffUser.count({ where: { authUserId: p.authUserId } })).toBe(0);
    });

    it('mismo UUID de auth.users como cliente y como empleado', async () => {
      const p = principal();
      await authUser(p.authUserId);
      const staff = await preregister(p.email as string, { role: 'kitchen' }); // en una sucursal
      const customer = await identity.ensureCustomer(p);
      const ctx = await identity.getStaffContext(p);
      expect(ctx?.staffId).toBe(staff.id);
      expect(customer.id).not.toBe(staff.id);
      expect(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject(
        { authUserId: p.authUserId },
      );
    });

    it('solo UNA identidad se vincula si dos cuentas con el mismo correo compiten', async () => {
      const email = `carrera-${randomUUID().slice(0, 8)}@sushimon.test`;
      const a = principal({ email });
      const b = principal({ email });
      await Promise.all([authUser(a.authUserId), authUser(b.authUserId)]);
      const row = await preregister(email);
      const [ca, cb] = await Promise.all([
        identity.getStaffContext(a),
        identity.getStaffContext(b),
      ]);
      expect([ca, cb].filter(Boolean)).toHaveLength(1);
      const linked = (await prisma.staffUser.findUniqueOrThrow({ where: { id: row.id } }))
        .authUserId;
      expect([a.authUserId, b.authUserId]).toContain(linked);
    });

    it('no vincula empleados inactivos ni sesiones que no son OAuth de Google (otro proveedor o correo no verificado)', async () => {
      const inactive = principal();
      const pwd = principal({ googleOAuth: false, provider: 'email' });
      await Promise.all([authUser(inactive.authUserId), authUser(pwd.authUserId)]);
      await preregister(inactive.email as string, { active: false });
      await preregister(pwd.email as string);
      await expect(identity.getStaffContext(inactive)).resolves.toBeNull();
      await expect(identity.getStaffContext(pwd)).resolves.toBeNull();
      expect(
        await prisma.staffUser.count({
          where: { authUserId: { in: [inactive.authUserId, pwd.authUserId] } },
        }),
      ).toBe(0);
    });

    it('un empleado vinculado y luego desactivado pierde el acceso al instante', async () => {
      const p = principal();
      await authUser(p.authUserId);
      const row = await preregister(p.email as string);
      await expect(identity.getStaffContext(p)).resolves.not.toBeNull();
      await prisma.staffUser.update({ where: { id: row.id }, data: { active: false } });
      await expect(identity.getStaffContext(p)).resolves.toBeNull();
    });

    it('alcance por sucursal: asignación a una sucursal no es "todas"', async () => {
      const branch = await newBranch();
      const p = principal();
      await authUser(p.authUserId);
      await preregister(p.email as string, { role: 'manager', branchId: branch.id });
      const ctx = await identity.getStaffContext(p);
      expect(ctx).toMatchObject({ allBranches: false, branchIds: [branch.id] });
      expect(ctx?.grants['orders.read']).toEqual({ allBranches: false, branchIds: [branch.id] });
      expect(ctx?.branches.map((b) => b.id)).toEqual([branch.id]);
    });

    it('una sucursal inactiva no concede acceso: sin sucursal activa no hay contexto', async () => {
      const branch = await newBranch();
      const p = principal();
      await authUser(p.authUserId);
      await preregister(p.email as string, { role: 'manager', branchId: branch.id });
      await expect(identity.getStaffContext(p)).resolves.not.toBeNull();
      await prisma.branch.update({ where: { id: branch.id }, data: { active: false } });
      await expect(identity.getStaffContext(p)).resolves.toBeNull();
    });
  });

  describe('integridad (CHECK e índices parciales del DBML)', () => {
    it('el correo del empleado debe estar en minúsculas', async () => {
      await expect(
        prisma.staffUser.create({ data: { fullName: 'X', email: 'MAYUS@sushimon.test' } }),
      ).rejects.toThrow();
    });

    it('no se puede duplicar la asignación "todas las sucursales" (índice parcial)', async () => {
      const row = await preregister(`dup-${randomUUID().slice(0, 8)}@sushimon.test`);
      const role = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
      await expect(
        prisma.staffAssignment.create({
          data: { staffId: row.id, roleId: role.id, branchId: null },
        }),
      ).rejects.toThrow();
    });

    it('no se puede reutilizar un auth_user_id en dos empleados', async () => {
      const id = randomUUID();
      await authUser(id);
      await prisma.staffUser.create({
        data: { fullName: 'A', email: `a-${id.slice(0, 6)}@sushimon.test`, authUserId: id },
      });
      await expect(
        prisma.staffUser.create({
          data: { fullName: 'B', email: `b-${id.slice(0, 6)}@sushimon.test`, authUserId: id },
        }),
      ).rejects.toThrow();
    });
  });
});
