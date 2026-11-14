import { NotFoundException } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { IdentityService } from '../identity/identity.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import {
  globalStaff,
  grantsOf,
  mergeGrants,
  scopedStaff,
  staffContext,
} from '../../test/support/staff-context.js';
import { BranchesQueryService } from './branches-query.service.js';
import type { BranchesRepository } from './branches.repository.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** Empleado con `branches.read` global (por defecto) o solo en `branchIds` (`allBranches: false`). */
const staff = (over: { allBranches?: boolean; branchIds?: string[] } = {}): StaffContext =>
  over.allBranches === false
    ? scopedStaff(['branches.read'], over.branchIds ?? [])
    : globalStaff(['branches.read']);

function setup() {
  const repo = {
    listPublic: vi.fn().mockResolvedValue([]),
    findPublicById: vi.fn().mockResolvedValue(null),
    existsActive: vi.fn().mockResolvedValue(true),
    findIds: vi.fn().mockResolvedValue([A]),
    findAdminById: vi.fn().mockResolvedValue({ id: A }),
    listAdmin: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const authorization = new AuthorizationService({} as IdentityService);
  return {
    repo,
    service: new BranchesQueryService(repo as unknown as BranchesRepository, authorization),
  };
}

describe('BranchesQueryService', () => {
  it('detalle público inexistente o inactivo → 404', async () => {
    await expect(setup().service.getPublicById(A)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('existsActive delega en el repositorio', async () => {
    const { service, repo } = setup();
    await expect(service.existsActive(A)).resolves.toBe(true);
    expect(repo.existsActive).toHaveBeenCalledWith(A);
  });

  it('listado admin: allBranches sin alcance restringido, con valores por defecto', async () => {
    const { service, repo } = setup();
    await expect(service.listAdmin(staff(), {})).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    expect(repo.listAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ scope: null, sort: 'name', order: 'asc', page: 1, pageSize: 20 }),
    );
  });

  it('listado admin: sin allBranches se filtra a sus sucursales', async () => {
    const { service, repo } = setup();
    await service.listAdmin(staff({ allBranches: false, branchIds: [A] }), { q: 'zona', page: 2 });
    expect(repo.listAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ scope: [A], q: 'zona', page: 2 }),
    );
  });

  it('listado admin: sin sucursales asignadas → lista vacía sin consultar', async () => {
    const { service, repo } = setup();
    const res = await service.listAdmin(staff({ allBranches: false, branchIds: [] }), {});
    expect(res.items).toEqual([]);
    expect(repo.listAdmin).not.toHaveBeenCalled();
  });

  it('detalle admin fuera de alcance → 404 sin consultar; dentro de alcance → la sucursal', async () => {
    const { service, repo } = setup();
    const scoped = staff({ allBranches: false, branchIds: [A] });
    await expect(service.getAdminById(scoped, B)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findAdminById).not.toHaveBeenCalled();
    await expect(service.getAdminById(scoped, A)).resolves.toEqual({ id: A });
  });

  it('idsInScope: todas vs. solo las del empleado vs. ninguna', async () => {
    const { service, repo } = setup();
    await service.idsInScope(staff(), { activeOnly: true });
    expect(repo.findIds).toHaveBeenLastCalledWith({ scope: null, activeOnly: true });
    await service.idsInScope(staff({ allBranches: false, branchIds: [B] }));
    expect(repo.findIds).toHaveBeenLastCalledWith({ scope: [B], activeOnly: false });
    repo.findIds.mockClear();
    await expect(service.idsInScope(staff({ allBranches: false, branchIds: [] }))).resolves.toEqual(
      [],
    );
    expect(repo.findIds).not.toHaveBeenCalled();
  });

  it('el alcance sale del permiso branches.read, no de otros permisos ni de la unión plana', async () => {
    const { service, repo } = setup();
    // branches.update es global, pero branches.read solo cubre A: el listado y el detalle se limitan a A.
    const mixed = staffContext(
      mergeGrants(grantsOf(['branches.update'], 'global'), grantsOf(['branches.read'], [A])),
    );
    await service.listAdmin(mixed, {});
    expect(repo.listAdmin).toHaveBeenCalledWith(expect.objectContaining({ scope: [A] }));
    await expect(service.getAdminById(mixed, B)).rejects.toBeInstanceOf(NotFoundException);
    // Sin branches.read en absoluto: nada, aunque tenga alcance global en otros permisos.
    const noRead = globalStaff(['branches.update']);
    await expect(service.listAdmin(noRead, {})).resolves.toMatchObject({ total: 0 });
  });
});
