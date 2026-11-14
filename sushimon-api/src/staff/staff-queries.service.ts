import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { isManageable, isVisible } from './staff-policy.js';
import { toAdminStaffView } from './staff-views.js';
import { StaffRepository } from './staff.repository.js';
import type { AdminStaffPageView, AdminStaffView, StaffListQuery } from './staff.types.js';

const NOT_FOUND = 'Empleado no encontrado';

/** Consultas de personal. Solo se ve a quien tiene alguna asignación dentro del alcance de `staff.read`. */
@Injectable()
export class StaffQueriesService {
  constructor(
    @Inject(StaffRepository) private readonly repo: StaffRepository,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  async list(actor: StaffContext, query: StaffListQuery): Promise<AdminStaffPageView> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const scope = this.authorization.scopeFor(actor, 'staff.read');
    if (!scope.allBranches && scope.branchIds.length === 0) {
      return { items: [], page, pageSize, total: 0 };
    }
    const { items, total } = await this.repo.listStaff({
      ...query,
      scope: scope.allBranches ? null : scope.branchIds,
      page,
      pageSize,
      sort: query.sort ?? 'fullName',
      order: query.order ?? 'asc',
    });
    return {
      items: items.map((r) =>
        toAdminStaffView(r, isManageable(actor.grants, actor.staffId, r, 'staff.update')),
      ),
      page,
      pageSize,
      total,
    };
  }

  /** Inexistente y fuera de alcance dan la misma respuesta (404). */
  async get(actor: StaffContext, id: string): Promise<AdminStaffView> {
    const record = await this.repo.findStaff(id);
    if (!record || !isVisible(actor.grants, record)) throw new NotFoundException(NOT_FOUND);
    return toAdminStaffView(
      record,
      isManageable(actor.grants, actor.staffId, record, 'staff.update'),
    );
  }
}
