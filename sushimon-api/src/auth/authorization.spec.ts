import type { Request } from 'express';
import type { IdentityService } from '../identity/identity.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import {
  buildGrants,
  scopeCovers,
  scopeOf,
  scopedBranches,
  type AssignmentFact,
} from './authorization.js';
import { AuthorizationService } from './authorization.service.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const fact = (
  perms: string[],
  over: { branchId?: string | null; active?: boolean; branchActive?: boolean } = {},
): AssignmentFact => {
  const branchId = over.branchId === undefined ? null : over.branchId;
  return {
    active: over.active ?? true,
    branchId,
    branch:
      branchId === null
        ? null
        : {
            id: branchId,
            name: `Suc ${branchId[0]}`,
            code: `s-${branchId[0]}`,
            active: over.branchActive ?? true,
          },
    role: { code: 'r', permissions: perms },
  };
};

describe('buildGrants', () => {
  it('múltiples roles: cada permiso conserva el alcance de los roles que lo otorgan', () => {
    const grants = buildGrants([
      fact(['orders.read', 'reports.read'], { branchId: A }),
      fact(['orders.read'], { branchId: B }),
      fact(['staff.read']),
    ]);
    expect(grants).toEqual({
      'orders.read': { allBranches: false, branchIds: [A, B] },
      'reports.read': { allBranches: false, branchIds: [A] },
      'staff.read': { allBranches: true, branchIds: [] },
    });
  });

  it('global NULL: allBranches solo en el permiso del rol global, nunca se propaga a otros', () => {
    const grants = buildGrants([fact(['staff.read']), fact(['orders.read'], { branchId: A })]);
    expect(scopeOf(grants, 'orders.read')).toEqual({ allBranches: false, branchIds: [A] });
    expect(scopeCovers(scopeOf(grants, 'orders.read'), B)).toBe(false);
    expect(scopeCovers(scopeOf(grants, 'staff.read'), B)).toBe(true);
    // `null` (alcance global) solo lo cubre un allBranches.
    expect(scopeCovers(scopeOf(grants, 'orders.read'), null)).toBe(false);
    expect(scopeCovers(scopeOf(grants, 'staff.read'), null)).toBe(true);
  });

  it('asignaciones inactivas no cuentan', () => {
    expect(buildGrants([fact(['staff.read'], { active: false })])).toEqual({});
  });

  it('sucursal inactiva no concede acceso operativo, pero una asignación global sigue vigente', () => {
    const grants = buildGrants([
      fact(['orders.read'], { branchId: A, branchActive: false }),
      fact(['orders.read'], { branchId: B }),
      fact(['staff.read']),
    ]);
    expect(grants['orders.read']).toEqual({ allBranches: false, branchIds: [B] });
    expect(grants['staff.read']?.allBranches).toBe(true);
  });

  it('un permiso ausente da un alcance vacío (deny by default) y no usa claves heredadas', () => {
    const grants = buildGrants([fact(['orders.read'], { branchId: A })]);
    expect(scopeOf(grants, 'staff.read')).toEqual({ allBranches: false, branchIds: [] });
    expect(scopeOf(grants, 'constructor')).toEqual({ allBranches: false, branchIds: [] });
    expect(scopeOf(grants, '__proto__')).toEqual({ allBranches: false, branchIds: [] });
  });

  it('el alcance devuelto es una copia: mutarlo no altera los grants', () => {
    const grants = buildGrants([fact(['orders.read'], { branchId: A })]);
    scopeOf(grants, 'orders.read').branchIds.push(B);
    expect(grants['orders.read']?.branchIds).toEqual([A]);
  });
});

describe('scopedBranches', () => {
  it('solo sucursales activas con algún permiso; sin duplicados', () => {
    const list = scopedBranches([
      fact(['orders.read'], { branchId: A }),
      fact(['reports.read'], { branchId: A }),
      fact([], { branchId: B }), // rol sin permisos
      fact(['orders.read']), // global: no aporta sucursal concreta
    ]);
    expect(list.map((b) => b.id)).toEqual([A]);
  });
});

describe('AuthorizationService', () => {
  const ctx = (id: string): StaffContext => ({
    staffId: id,
    fullName: 'x',
    assignments: [],
    grants: { 'orders.read': { allBranches: false, branchIds: [A] } },
    branches: [],
    permissions: [],
    allBranches: false,
    branchIds: [],
  });

  it('staffFor memoiza SOLO en la solicitud: una sola lectura por req, nueva lectura en otra req', async () => {
    const identity = { getStaffContext: vi.fn().mockResolvedValue(ctx('s1')) };
    const service = new AuthorizationService(identity as unknown as IdentityService);
    const principal = { authUserId: 'u' };
    const req1 = { principal } as unknown as Request;
    const req2 = { principal } as unknown as Request;
    await service.staffFor(req1);
    await service.staffFor(req1);
    expect(identity.getStaffContext).toHaveBeenCalledTimes(1);
    await service.staffFor(req2);
    expect(identity.getStaffContext).toHaveBeenCalledTimes(2);
  });

  it('sin principal no consulta y devuelve null', async () => {
    const identity = { getStaffContext: vi.fn() };
    const service = new AuthorizationService(identity as unknown as IdentityService);
    await expect(service.staffFor({} as Request)).resolves.toBeNull();
    expect(identity.getStaffContext).not.toHaveBeenCalled();
  });

  it('has / scopeFor / canAccess resuelven por permiso', () => {
    const service = new AuthorizationService({} as IdentityService);
    const staff = ctx('s1');
    expect(service.has(staff, 'orders.read')).toBe(true);
    expect(service.has(staff, 'orders.cancel')).toBe(false);
    expect(service.canAccess(staff, 'orders.read', A)).toBe(true);
    expect(service.canAccess(staff, 'orders.read', B)).toBe(false);
    expect(service.canAccess(staff, 'orders.cancel', A)).toBe(false);
    expect(service.canAccess(staff, 'orders.read', null)).toBe(false);
  });
});
