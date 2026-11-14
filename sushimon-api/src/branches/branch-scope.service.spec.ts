import type { StaffContext } from '../identity/identity.types.js';
import { BranchScopeService } from './branch-scope.service.js';
import type { BranchesRepository } from './branches.repository.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const staff = { staffId: 's-1', allBranches: true, branchIds: [] } as unknown as StaffContext;

const scopeFor = (rows: (string | null)[]) => {
  const repo = { findAssignmentBranchIds: vi.fn().mockResolvedValue(rows) };
  return { repo, service: new BranchScopeService(repo as unknown as BranchesRepository) };
};

describe('BranchScopeService', () => {
  it('consulta una sola vez el permiso `branches` del empleado', async () => {
    const { service, repo } = scopeFor([A]);
    await service.resolve(staff);
    expect(repo.findAssignmentBranchIds).toHaveBeenCalledTimes(1);
    expect(repo.findAssignmentBranchIds).toHaveBeenCalledWith('s-1', 'branches');
  });

  it('asignación con branch NULL = todas; las demás se ignoran', async () => {
    await expect(scopeFor([null, A]).service.resolve(staff)).resolves.toEqual({
      allBranches: true,
      branchIds: [A],
    });
  });

  it('solo sucursales concretas, sin duplicados', async () => {
    await expect(scopeFor([A, B, A]).service.resolve(staff)).resolves.toEqual({
      allBranches: false,
      branchIds: [A, B],
    });
  });

  it('el contexto mezclado del StaffContext NO manda: sin asignaciones con el permiso, alcance vacío', async () => {
    // staff.allBranches=true viene de OTRO rol sin `branches`.
    await expect(scopeFor([]).service.resolve(staff)).resolves.toEqual({
      allBranches: false,
      branchIds: [],
    });
  });
});
