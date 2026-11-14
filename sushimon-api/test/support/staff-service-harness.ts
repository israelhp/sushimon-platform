import { AuditService } from '../../src/audit/audit.service.js';
import { AuthorizationService } from '../../src/auth/authorization.service.js';
import type { BranchesQueryService } from '../../src/branches/branches-query.service.js';
import type { StaffContext } from '../../src/identity/identity.types.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { RolesService } from '../../src/staff/roles.service.js';
import { StaffCommandGuard } from '../../src/staff/staff-command-guard.js';
import { StaffCommandsService } from '../../src/staff/staff-commands.service.js';
import { StaffQueriesService } from '../../src/staff/staff-queries.service.js';
import type { StaffRepository } from '../../src/staff/staff.repository.js';
import { FakeStaffRepo } from './fake-staff-repo.js';
import { BRANCH_A, BRANCH_B, BRANCH_C } from './staff-fixtures.js';

/** Servicios reales de F03 sobre el doble en memoria; sucursales A y B activas, C inactiva. */
export function staffHarness() {
  const repo = new FakeStaffRepo();
  repo.branches.set(BRANCH_A, { id: BRANCH_A, name: 'Zona 10', code: 'zona-10', active: true });
  repo.branches.set(BRANCH_B, { id: BRANCH_B, name: 'Zona 14', code: 'zona-14', active: true });
  repo.branches.set(BRANCH_C, { id: BRANCH_C, name: 'Oakland', code: 'oakland', active: false });
  const real = repo as unknown as StaffRepository;
  const audit = new AuditService();
  /** Releer al actor devuelve el mismo contexto salvo que la prueba lo "revoque" (desactivado tras el guard). */
  const revoked = new Set<string>();
  class HarnessAuthorization extends AuthorizationService {
    override refreshInTx(_tx: unknown, actor: StaffContext): Promise<StaffContext | null> {
      return Promise.resolve(revoked.has(actor.staffId) ? null : actor);
    }
  }
  const authorization = new HarnessAuthorization({} as IdentityService);
  const branches = {
    allActiveForShare: vi.fn((_tx: unknown, ids: string[]) =>
      Promise.resolve([...new Set(ids)].every((id) => repo.branches.get(id)?.active === true)),
    ),
  };
  const guard = new StaffCommandGuard(real, audit);
  return {
    repo,
    revoked,
    branches,
    commands: new StaffCommandsService(
      real,
      audit,
      authorization,
      branches as unknown as BranchesQueryService,
      guard,
    ),
    queries: new StaffQueriesService(real, authorization),
    roles: new RolesService(real, audit, authorization, guard),
  };
}

export const actions = (repo: FakeStaffRepo): string[] => repo.audit.map((e) => e.action);
