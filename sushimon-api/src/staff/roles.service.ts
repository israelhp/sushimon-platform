import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { StaffCommandGuard } from './staff-command-guard.js';
import { EscalationDenied } from './staff-policy.js';
import { toAdminRoleView, toPermissionCatalog } from './staff-views.js';
import { StaffRepository } from './staff.repository.js';
import type { AdminRoleView, PermissionCatalogView } from './staff.types.js';

const NOT_FOUND = 'Rol no encontrado';

/** Consulta de roles/permisos y edición de los permisos de un rol (salvo roles del sistema). */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @Inject(StaffRepository) private readonly repo: StaffRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(StaffCommandGuard) private readonly guard: StaffCommandGuard,
  ) {}

  async list(): Promise<{ items: AdminRoleView[] }> {
    return { items: (await this.repo.listRoles()).map(toAdminRoleView) };
  }

  async get(id: string): Promise<AdminRoleView> {
    const role = await this.repo.findRole(id);
    if (!role) throw new NotFoundException(NOT_FOUND);
    return toAdminRoleView(role);
  }

  async permissions(): Promise<PermissionCatalogView> {
    return toPermissionCatalog(await this.repo.listPermissions());
  }

  /**
   * Reemplazo completo de permisos. Un rol aplica a todas las sucursales donde se asigne, por eso el actor
   * necesita `roles.manage` y, para cada permiso AÑADIDO, poseerlo con alcance global (regla del subconjunto).
   * Los roles `is_system` (admin) no se editan (409).
   */
  async replacePermissions(
    caller: StaffContext,
    id: string,
    requested: string[],
  ): Promise<AdminRoleView> {
    const codes = [...new Set(requested)];

    return this.guard.run(caller, { entityType: 'role', entityId: id }, () =>
      this.repo.transaction(async (tx) => {
        await this.repo.lockAdminGuard(tx);
        const actor = await this.authorization.refreshInTx(tx, caller);
        if (!actor) throw new EscalationDenied('actor_no_longer_authorized');
        if (!this.authorization.scopeFor(actor, 'roles.manage').allBranches) {
          throw new EscalationDenied('roles_manage_not_global');
        }
        if (!(await this.repo.lockRole(tx, id))) throw new NotFoundException(NOT_FOUND);
        const role = await this.repo.findRole(id, tx);
        if (!role) throw new NotFoundException(NOT_FOUND);
        if (role.isSystem) throw new ConflictException('Un rol del sistema no es editable');

        const catalog = await this.repo.findPermissionIds(tx, codes);
        if (catalog.size !== codes.length) {
          throw new BadRequestException(['Permiso desconocido']);
        }
        const current = new Set(role.permissions.map((p) => p.code));
        const added = codes.filter((c) => !current.has(c)).sort();
        const removed = [...current].filter((c) => !codes.includes(c)).sort();
        if (added.length === 0 && removed.length === 0) return toAdminRoleView(role); // idempotente

        for (const code of added) {
          if (!this.authorization.scopeFor(actor, code).allBranches) {
            throw new EscalationDenied('permission_not_held_globally');
          }
        }
        await this.repo.replaceRolePermissions(tx, id, {
          removeCodes: removed,
          addPermissionIds: added.map((c) => catalog.get(c) as string),
        });
        await this.audit.record(tx, {
          actorId: actor.staffId,
          entityType: 'role',
          entityId: id,
          action: 'role.permissions_changed',
          newValues: {
            role: role.code,
            added,
            removed,
            affectedStaffIds: await this.repo.staffIdsWithRole(tx, id),
          },
        });
        this.logger.log(`Permisos de rol actualizados (rol=${role.code}, staff=${actor.staffId})`);
        const updated = await this.repo.findRole(id, tx);
        return toAdminRoleView(updated ?? role);
      }),
    );
  }
}
