import { Logger } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import type { PrismaService } from '../database/prisma.service.js';
import { IdentityService } from './identity.service.js';
import { canAccessBranch } from './identity.types.js';

const ME: Principal = {
  authUserId: '3f2b8a52-6f0e-4a57-9d46-0c1f1d8c2a11',
  email: 'ana@sushimon.test',
  provider: 'google',
  googleOAuth: true,
  displayName: 'Ana',
};
const BRANCH = '11111111-1111-4111-8111-111111111111';

function staffRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    fullName: 'Ana Admin',
    active: true,
    assignments: [
      {
        branchId: null,
        role: {
          code: 'admin',
          permissions: [{ permission: { code: 'users' } }, { permission: { code: 'dashboard' } }],
        },
      },
    ],
    ...over,
  };
}

function setup() {
  const prisma = {
    customer: { count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
    staffUser: { findUnique: vi.fn(), updateMany: vi.fn() },
  };
  return { prisma, service: new IdentityService(prisma as unknown as PrismaService) };
}

describe('IdentityService', () => {
  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  describe('getStaffContext', () => {
    it('resume roles, permisos únicos y alcance de sucursales', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(
        staffRow({
          assignments: [
            {
              branchId: BRANCH,
              role: { code: 'manager', permissions: [{ permission: { code: 'reports' } }] },
            },
            {
              branchId: BRANCH,
              role: { code: 'kitchen', permissions: [{ permission: { code: 'reports' } }] },
            },
          ],
        }),
      );
      const ctx = await service.getStaffContext(ME);
      expect(ctx).toMatchObject({
        staffId: 's1',
        permissions: ['reports'],
        allBranches: false,
        branchIds: [BRANCH],
      });
      expect(ctx && canAccessBranch(ctx, BRANCH)).toBe(true);
      expect(ctx && canAccessBranch(ctx, '22222222-2222-4222-8222-222222222222')).toBe(false);
    });

    it('asignación sin sucursal = todas las sucursales', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(staffRow());
      const ctx = await service.getStaffContext(ME);
      expect(ctx?.allBranches).toBe(true);
      expect(ctx && canAccessBranch(ctx, BRANCH)).toBe(true);
    });

    it.each([
      ['empleado inactivo', staffRow({ active: false })],
      ['sin asignaciones activas', staffRow({ assignments: [] })],
    ])('null: %s', async (_name, row) => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(row);
      await expect(service.getStaffContext(ME)).resolves.toBeNull();
    });

    it('vincula por correo en el primer acceso con Google y recarga', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(staffRow());
      prisma.staffUser.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.getStaffContext(ME)).resolves.toMatchObject({ staffId: 's1' });
      expect(prisma.staffUser.updateMany).toHaveBeenCalledWith({
        where: { email: 'ana@sushimon.test', authUserId: null, active: true },
        data: { authUserId: ME.authUserId },
      });
    });

    it.each([
      ['sesión que no es OAuth de Google', { ...ME, googleOAuth: false }],
      ['token sin correo', { ...ME, email: null }],
    ])('no intenta vincular: %s', async (_n, principal) => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(null);
      await expect(service.getStaffContext(principal)).resolves.toBeNull();
      expect(prisma.staffUser.updateMany).not.toHaveBeenCalled();
    });

    it('sin fila preregistrada (count 0) no hay acceso', async () => {
      const { prisma, service } = setup();
      prisma.staffUser.findUnique.mockResolvedValue(null);
      prisma.staffUser.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.getStaffContext(ME)).resolves.toBeNull();
      expect(prisma.staffUser.findUnique).toHaveBeenCalledTimes(1);
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
