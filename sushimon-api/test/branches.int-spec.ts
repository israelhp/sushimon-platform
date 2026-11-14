import { ConfigService } from '@nestjs/config';
import { ConflictException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../src/audit/audit.service.js';
import { BranchScopeService } from '../src/branches/branch-scope.service.js';
import { BranchesCommandsService } from '../src/branches/branches-commands.service.js';
import { BranchesQueryService } from '../src/branches/branches-query.service.js';
import { BranchesRepository } from '../src/branches/branches.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { StaffContext } from '../src/identity/identity.types.js';
import { cleanupTestData, ensureAuthStub, migrate, TEST_URL, withClient } from './support/db.js';

const url = TEST_URL;
const uniqueCode = () => `t${randomUUID().slice(0, 8)}`;

const global: StaffContext = {
  staffId: '', // se completa con el empleado real creado en beforeAll
  fullName: 'Admin Prueba',
  assignments: [],
  permissions: ['branches'],
  allBranches: true,
  branchIds: [],
};

describe.skipIf(!url)('Sucursales contra PostgreSQL real', () => {
  let prisma: PrismaService;
  let commands: BranchesCommandsService;
  let queries: BranchesQueryService;
  const createdBranchIds = new Set<string>();
  let adminRoleId = '';

  const create = async (
    over: Partial<{ code: string; latitude: number; longitude: number }> = {},
  ) => {
    const branch = await commands.create(global, {
      code: over.code ?? uniqueCode(),
      name: 'Sucursal de prueba',
      address: 'Zona 1',
      ...over,
    });
    createdBranchIds.add(branch.id);
    return branch;
  };
  const rawBranch = (data: Record<string, unknown>) =>
    prisma.branch.create({
      data: { code: uniqueCode(), name: 'N', address: 'D', ...data } as never,
    });

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await withClient(url as string, ensureAuthStub);
    migrate(url as string);
    prisma = new PrismaService(new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url })));
    const repo = new BranchesRepository(prisma);
    const scopes = new BranchScopeService(repo);
    commands = new BranchesCommandsService(repo, new AuditService(), scopes);
    queries = new BranchesQueryService(repo, scopes);
    // El alcance se lee de la BD: el empleado de prueba necesita una asignación global con el permiso `branches`.
    const admin = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    adminRoleId = admin.id;
    const staff = await prisma.staffUser.create({
      data: {
        fullName: 'Admin Prueba',
        email: `${randomUUID().slice(0, 8)}@sushimon.test`,
        assignments: { create: [{ roleId: admin.id, branchId: null }] },
      },
    });
    global.staffId = staff.id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await cleanupTestData(url as string, { authUserIds: [], branchIds: createdBranchIds });
  });

  it('código único con solicitudes simultáneas: una creación y un 409', async () => {
    const code = uniqueCode();
    const results = await Promise.allSettled([
      create({ code }),
      create({ code: code.toUpperCase() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(await prisma.branch.count({ where: { code } })).toBe(1);
    // El intento perdedor no deja auditoría: su transacción se revirtió.
    const winner = await prisma.branch.findUniqueOrThrow({ where: { code } });
    expect(await prisma.auditEvent.count({ where: { branchId: winner.id } })).toBe(1);
  });

  describe('CHECK de la base de datos (defensa en profundidad)', () => {
    it.each([
      ['código con mayúsculas', { code: 'Mayus' }],
      ['código con espacios', { code: 'dos palabras' }],
      ['código de 1 carácter', { code: 'a' }],
      ['código con guion doble', { code: 'a--b' }],
      ['nombre en blanco', { name: '   ' }],
      ['dirección en blanco', { address: '  ' }],
      ['latitud sin longitud', { latitude: 14.6 }],
      ['longitud sin latitud', { longitude: -90.5 }],
      ['latitud 91', { latitude: 91, longitude: 0 }],
      ['longitud 181', { latitude: 0, longitude: 181 }],
    ])('rechaza %s', async (_name, data) => {
      await expect(rawBranch(data)).rejects.toThrow();
    });

    it('acepta coordenadas válidas y las devuelve como number', async () => {
      const created = await create({ latitude: 14.6349149, longitude: -90.5069329 });
      expect(created).toMatchObject({ latitude: 14.6349149, longitude: -90.5069329, active: true });
      await expect(queries.getAdminById(global, created.id)).resolves.toMatchObject({
        latitude: 14.6349149,
      });
    });
  });

  it('auditoría con diff real (old/new), actor y motivo', async () => {
    const branch = await create();
    await commands.update(global, branch.id, { name: 'Nombre nuevo', address: 'Zona 1' });
    await commands.update(global, branch.id, { name: 'Nombre nuevo' }); // sin cambios: no audita
    await commands.changeStatus(global, branch.id, { active: false, reason: 'Remodelación' });
    await commands.changeStatus(global, branch.id, { active: false, reason: 'Otra vez' }); // idempotente
    await commands.changeStatus(global, branch.id, { active: true });

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'branch', entityId: branch.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual([
      'branch.created',
      'branch.updated',
      'branch.deactivated',
      'branch.activated',
    ]);
    expect(events[1]).toMatchObject({
      actorId: global.staffId,
      branchId: branch.id,
      oldValues: { name: 'Sucursal de prueba' },
      newValues: { name: 'Nombre nuevo' },
    });
    expect(events[2]).toMatchObject({
      reason: 'Remodelación',
      oldValues: { active: true },
      newValues: { active: false },
    });
  });

  it('desactivar no borra relaciones: staff_assignments y empleado siguen', async () => {
    const branch = await create();
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
    const staff = await prisma.staffUser.create({
      data: {
        fullName: 'Gerente Prueba',
        email: `${randomUUID().slice(0, 8)}@sushimon.test`,
        assignments: { create: [{ roleId: role.id, branchId: branch.id }] },
      },
    });
    await commands.changeStatus(global, branch.id, { active: false, reason: 'Cierre temporal' });

    expect(await prisma.staffAssignment.count({ where: { branchId: branch.id } })).toBe(1);
    expect(await prisma.staffUser.count({ where: { id: staff.id } })).toBe(1);
    expect(await queries.existsActive(branch.id)).toBe(false);
    // La FK RESTRICT de auditoría impide borrar una sucursal con historial.
    await expect(prisma.branch.delete({ where: { id: branch.id } })).rejects.toThrow();
  });

  it('listado: alcance, filtro active y paginación en SQL', async () => {
    const a = await create();
    const b = await create();
    await commands.changeStatus(global, b.id, { active: false, reason: 'x' });
    const scopedStaff = await prisma.staffUser.create({
      data: {
        fullName: 'Gerente Prueba',
        email: `${randomUUID().slice(0, 8)}@sushimon.test`,
        assignments: {
          create: [
            { roleId: adminRoleId, branchId: a.id },
            { roleId: adminRoleId, branchId: b.id },
          ],
        },
      },
    });
    const scoped: StaffContext = {
      ...global,
      staffId: scopedStaff.id,
      allBranches: false,
      branchIds: [a.id, b.id],
    };

    const all = await queries.listAdmin(scoped, { pageSize: 1 });
    expect(all).toMatchObject({ total: 2, pageSize: 1 });
    expect(all.items).toHaveLength(1);
    const inactive = await queries.listAdmin(scoped, { active: false });
    expect(inactive.items.map((i) => i.id)).toEqual([b.id]);
    await expect(queries.idsInScope(scoped, { activeOnly: true })).resolves.toEqual([a.id]);
  });

  it('audit_events es solo-añadir (migración 0004): UPDATE y DELETE se rechazan', async () => {
    const branch = await create();
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: branch.id } });
    await expect(
      prisma.auditEvent.update({ where: { id: event.id }, data: { reason: 'manipulado' } }),
    ).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });
});
