import { Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/auth.types.js';
import type { PrismaService } from '../database/prisma.service.js';
import { IdentityService } from './identity.service.js';

const ME: Principal = {
  authUserId: '3f2b8a52-6f0e-4a57-9d46-0c1f1d8c2a11',
  email: 'ana@sushimon.test',
  provider: 'google',
  googleOAuth: true,
  aal: 'aal1',
  displayName: 'Ana',
  avatarUrl: null,
};
const BRANCH = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';

const branch = (id: string, active = true) => ({
  id,
  name: `Sucursal ${id.slice(0, 1)}`,
  code: `s-${id.slice(0, 1)}`,
  active,
});

/** Asignación tal como la devuelve la consulta única de `loadStaff`. */
const assignment = (
  role: string,
  permissions: string[],
  over: { branchId?: string | null; active?: boolean; branchActive?: boolean } = {},
) => {
  const branchId = over.branchId === undefined ? null : over.branchId;
  return {
    active: over.active ?? true,
    branchId,
    branch: branchId === null ? null : branch(branchId, over.branchActive ?? true),
    role: { code: role, permissions: permissions.map((code) => ({ permission: { code } })) },
  };
};

function staffRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    fullName: 'Ana Admin',
    active: true,
    assignments: [assignment('admin', ['staff.read', 'dashboard.read'])],
    ...over,
  };
}

function setup() {
  const audit = { auditEvent: { create: vi.fn().mockResolvedValue({}) } };
  const prisma = {
    customer: { count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
    staffUser: { findUnique: vi.fn(), updateMany: vi.fn() },
    branch: { findMany: vi.fn().mockResolvedValue([branch(BRANCH), branch(BRANCH_B)]) },
    auditEvent: audit.auditEvent,
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
    fn(prisma),
  );
  return {
    prisma,
    audit,
    service: new IdentityService(prisma as unknown as PrismaService, new AuditService()),
  };
}

describe('IdentityService', () => {
  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  describe('getStaffContext', () => {
    it('calcula grants por permiso: alcance propio de cada rol, sin mezclar roles', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(
        staffRow({
          assignments: [
            assignment('manager', ['reports.read', 'staff.read'], { branchId: BRANCH }),
            assignment('kitchen', ['reports.read', 'orders.read'], { branchId: BRANCH_B }),
          ],
        }),
      );
      const ctx = await service.getStaffContext(ME);
      expect(ctx?.grants).toEqual({
        'orders.read': { allBranches: false, branchIds: [BRANCH_B] },
        'reports.read': { allBranches: false, branchIds: [BRANCH, BRANCH_B].sort() },
        'staff.read': { allBranches: false, branchIds: [BRANCH] },
      });
      expect(ctx).toMatchObject({
        staffId: 's1',
        permissions: ['orders.read', 'reports.read', 'staff.read'],
        allBranches: false,
        branchIds: [BRANCH, BRANCH_B].sort(),
      });
      // Una consulta de grants, y sin consulta de sucursales cuando no hay alcance global.
      expect(prisma.staffUser.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.branch.findMany).not.toHaveBeenCalled();
      expect(ctx?.branches.map((b) => b.id)).toEqual([BRANCH, BRANCH_B]);
    });

    it('alcance global solo del permiso que lo tiene; withAllBranches completa con todas las activas', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(
        staffRow({
          assignments: [
            assignment('admin', ['staff.read']),
            assignment('kitchen', ['orders.read'], { branchId: BRANCH }),
          ],
        }),
      );
      const ctx = await service.getStaffContext(ME);
      expect(ctx?.grants['staff.read']).toEqual({ allBranches: true, branchIds: [] });
      expect(ctx?.grants['orders.read']).toEqual({ allBranches: false, branchIds: [BRANCH] });
      expect(ctx?.allBranches).toBe(true);
      // El camino de autorización no consulta sucursales: solo `withAllBranches` (endpoints de contexto).
      expect(prisma.branch.findMany).not.toHaveBeenCalled();
      const full = ctx && (await service.withAllBranches(ctx));
      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
      expect(full?.branches).toHaveLength(2);
    });

    it('staffContextById relee con el cliente de la transacción (no con el pool) y respeta empleado inactivo', async () => {
      const { prisma, service } = setup();
      const tx = { staffUser: { findUnique: vi.fn().mockResolvedValue(staffRow()) } };
      const ctx = await service.staffContextById('s1', tx as never);
      expect(ctx?.staffId).toBe('s1');
      expect(tx.staffUser.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1' } }),
      );
      expect(prisma.staffUser.findUnique).not.toHaveBeenCalled();
      tx.staffUser.findUnique.mockResolvedValue(staffRow({ active: false }));
      await expect(service.staffContextById('s1', tx as never)).resolves.toBeNull();
      tx.staffUser.findUnique.mockResolvedValue(null);
      await expect(service.staffContextById('s1', tx as never)).resolves.toBeNull();
    });

    it('withAllBranches no consulta si no hay alcance global', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(
        staffRow({ assignments: [assignment('manager', ['orders.read'], { branchId: BRANCH })] }),
      );
      const ctx = await service.getStaffContext(ME);
      await expect(ctx && service.withAllBranches(ctx)).resolves.toBe(ctx);
      expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });

    it('una asignación hacia una sucursal inactiva no entra en grants (ni en branches)', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(
        staffRow({
          assignments: [
            assignment('manager', ['orders.read'], { branchId: BRANCH }),
            assignment('manager', ['orders.read', 'staff.read'], {
              branchId: BRANCH_B,
              branchActive: false,
            }),
          ],
        }),
      );
      const ctx = await service.getStaffContext(ME);
      expect(ctx?.grants).toEqual({ 'orders.read': { allBranches: false, branchIds: [BRANCH] } });
      expect(ctx?.branches.map((b) => b.id)).toEqual([BRANCH]);
    });

    it('una asignación inactiva no concede nada', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(
        staffRow({
          assignments: [
            assignment('manager', ['orders.read'], { branchId: BRANCH }),
            assignment('admin', ['roles.manage'], { active: false }),
          ],
        }),
      );
      const ctx = await service.getStaffContext(ME);
      expect(Object.keys(ctx?.grants ?? {})).toEqual(['orders.read']);
    });

    it.each([
      ['empleado inactivo', staffRow({ active: false })],
      ['sin asignaciones activas', staffRow({ assignments: [] })],
      [
        'todas sus sucursales inactivas',
        staffRow({
          assignments: [
            assignment('manager', ['orders.read'], { branchId: BRANCH, branchActive: false }),
          ],
        }),
      ],
    ])('null: %s', async (_name, row) => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(row);
      await expect(service.getStaffContext(ME)).resolves.toBeNull();
    });

    it('vincula por correo, fija linked_at y escribe staff.linked en la MISMA transacción', async () => {
      const { prisma, audit, service } = setup();
      prisma.staffUser.findUnique
        .mockResolvedValueOnce(null) // loadStaff: aún sin vincular
        .mockResolvedValueOnce({ id: 's1' }) // dentro de la transacción: id de la fila vinculada
        .mockResolvedValueOnce(staffRow()); // recarga
      prisma.staffUser.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.getStaffContext(ME)).resolves.toMatchObject({ staffId: 's1' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.staffUser.updateMany).toHaveBeenCalledWith({
        where: { email: 'ana@sushimon.test', authUserId: null, active: true },
        data: { authUserId: ME.authUserId, linkedAt: expect.any(Date) as unknown },
      });
      expect(audit.auditEvent.create).toHaveBeenCalledTimes(1);
      const data = (audit.auditEvent.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })
        .data;
      expect(data).toMatchObject({
        actorId: 's1',
        entityType: 'staff_user',
        entityId: 's1',
        action: 'staff.linked',
        newValues: { identityStatus: 'LINKED' },
      });
      // Sin correo ni auth_user_id en el evento.
      expect(JSON.stringify(data)).not.toContain('ana@sushimon.test');
      expect(JSON.stringify(data)).not.toContain(ME.authUserId);
    });

    it('si la auditoría falla, el vínculo se revierte y el error se propaga', async () => {
      const { prisma, audit, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 's1' });
      prisma.staffUser.updateMany.mockResolvedValue({ count: 1 });
      audit.auditEvent.create.mockRejectedValueOnce(new Error('audit down'));
      await expect(service.getStaffContext(ME)).rejects.toThrow('audit down');
    });

    it.each([
      [
        'sesión que no es OAuth de Google (otro proveedor o correo no verificado)',
        { ...ME, googleOAuth: false },
      ],
      ['token sin correo', { ...ME, email: null }],
    ])('no intenta vincular: %s', async (_n, principal) => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(null);
      await expect(service.getStaffContext(principal)).resolves.toBeNull();
      expect(prisma.staffUser.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('sin fila preautorizada (count 0) no hay acceso, no se crea personal y no se audita', async () => {
      const { prisma, audit, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(null);
      prisma.staffUser.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.getStaffContext(ME)).resolves.toBeNull();
      expect(prisma.staffUser.findUnique).toHaveBeenCalledTimes(1);
      expect((prisma.staffUser as Record<string, unknown>)['create']).toBeUndefined();
      expect(audit.auditEvent.create).not.toHaveBeenCalled();
    });

    it('carrera: la otra identidad ya ganó (P2002 por auth_user_id) → sin acceso, sin 500', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(null);
      prisma.staffUser.updateMany.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
      await expect(service.getStaffContext(ME)).resolves.toBeNull();
    });
  });

  describe('ensureCustomer', () => {
    it('devuelve el existente sin crear', async () => {
      const { prisma, service } = setup();
      prisma.customer.findUnique.mockResolvedValue({ id: 'c1' });
      await expect(service.ensureCustomer(ME)).resolves.toEqual({ id: 'c1' });
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('crea con nombre de las claims y correo del token', async () => {
      const { prisma, service } = setup();
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue({ id: 'c2' });
      await service.ensureCustomer(ME);
      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: { authUserId: ME.authUserId, fullName: 'Ana', email: 'ana@sushimon.test' },
      });
    });

    it('sin nombre usa la parte local del correo, y "Cliente" si tampoco hay correo', async () => {
      const { prisma, service } = setup();
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue({ id: 'c' });
      await service.ensureCustomer({ ...ME, displayName: null });
      await service.ensureCustomer({ ...ME, displayName: null, email: null });
      const names = (prisma.customer.create.mock.calls as { data: { fullName: string } }[][]).map(
        (c) => c[0]?.data.fullName,
      );
      expect(names).toEqual(['ana', 'Cliente']);
    });

    it('resuelve la carrera P2002 leyendo la fila ganadora', async () => {
      const { prisma, service } = setup();
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
      prisma.customer.findUniqueOrThrow.mockResolvedValue({ id: 'winner' });
      await expect(service.ensureCustomer(ME)).resolves.toEqual({ id: 'winner' });
    });

    it('propaga otros errores', async () => {
      const { prisma, service } = setup();
      prisma.customer.findUnique.mockResolvedValue(null);
      prisma.customer.create.mockRejectedValue(new Error('db caída'));
      await expect(service.ensureCustomer(ME)).rejects.toThrow('db caída');
    });
  });
});
