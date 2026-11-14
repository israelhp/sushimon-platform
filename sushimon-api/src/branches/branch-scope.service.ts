import { Inject, Injectable } from '@nestjs/common';
import type { StaffContext } from '../identity/identity.types.js';
import { BranchesRepository } from './branches.repository.js';

/** Permiso que habilita la gestión de sucursales (F01; F03 lo dividirá en granulares). */
export const BRANCHES_PERMISSION = 'branches';

export interface BranchScope {
  allBranches: boolean;
  branchIds: string[];
}

export const canAccess = (scope: BranchScope, branchId: string): boolean =>
  scope.allBranches || scope.branchIds.includes(branchId);

/**
 * Alcance de sucursales PARA EL PERMISO `branches`: solo cuentan las asignaciones activas cuyo rol lo contiene.
 * `StaffContext.allBranches/branchIds` mezcla todos los roles del empleado: un rol sin `branches` con alcance
 * global no puede ampliar lo que otro rol sí permite. Se lee de la BD (una consulta por solicitud).
 */
@Injectable()
export class BranchScopeService {
  constructor(@Inject(BranchesRepository) private readonly repo: BranchesRepository) {}

  async resolve(staff: StaffContext, permission = BRANCHES_PERMISSION): Promise<BranchScope> {
    const assignments = await this.repo.findAssignmentBranchIds(staff.staffId, permission);
    return {
      allBranches: assignments.some((branchId) => branchId === null),
      branchIds: [...new Set(assignments.flatMap((b) => (b === null ? [] : [b])))],
    };
  }
}
