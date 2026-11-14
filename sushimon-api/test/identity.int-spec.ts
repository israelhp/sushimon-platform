import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Principal } from '../src/auth/auth.types.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { IdentityService } from '../src/identity/identity.service.js';
import { cleanupTestData, ensureAuthStub, migrate, TEST_URL, withClient } from './support/db.js';

const url = TEST_URL;

function principal(over: Partial<Principal> = {}): Principal {
  return {
    authUserId: randomUUID(),
    email: `${randomUUID().slice(0, 8)}@sushimon.test`,
    provider: 'google',
    googleOAuth: true,
    displayName: 'Persona Prueba',
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

  async function preregister(
    email: string,
    opts: { active?: boolean; role?: string; branchId?: string | null } = {},
  ) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: opts.role ?? 'admin' } });
    return prisma.staffUser.create({
      data: {
        fullName: 'Empleado Prueba',
        email,
        active: opts.active ?? true,
        assignments: { create: [{ roleId: role.id, branchId: opts.branchId ?? null }] },
      },
    });
  }

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await withClient(url as string, ensureAuthStub);
    migrate(url as string);
    prisma = new PrismaService(new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url })));
    identity = new IdentityService(prisma);
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
      expect(ctx?.permissions).toHaveLength(10);
      expect((await prisma.staffUser.findUniqueOrThrow({ where: { id: row.id } })).authUserId).toBe(
        p.authUserId,
      );
      // Segunda llamada: ya vinculado, mismo resultado.
      await expect(identity.getStaffContext(p)).resolves.toMatchObject({ staffId: row.id });
    });

    it('mismo UUID de auth.users como cliente y como empleado', async () => {
      const p = principal();
      await authUser(p.authUserId);
      const staff = await preregister(p.email as string, { role: 'kitchen' });
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

    it('no vincula empleados inactivos ni sesiones que no son OAuth de Google', async () => {
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
      const branch = await prisma.branch.create({
        data: { code: `B-${randomUUID().slice(0, 6)}`, name: 'Sucursal' },
      });
      createdBranchIds.add(branch.id);
      const p = principal();
      await authUser(p.authUserId);
      await preregister(p.email as string, { role: 'manager', branchId: branch.id });
      const ctx = await identity.getStaffContext(p);
      expect(ctx).toMatchObject({ allBranches: false, branchIds: [branch.id] });
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
