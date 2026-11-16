import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { scopeCovers } from '../auth/authorization.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { BranchesQueryService } from '../branches/branches-query.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { StaffCommandGuard } from './staff-command-guard.js';
import {
  assertAdminGlobalRule,
  assertNoDuplicateAssignments,
  canGrantRole,
  describeAssignment,
  diffAssignments,
  EscalationDenied,
  isGlobalAdmin,
  isManageable,
  isVisible,
  normalizeEmail,
  normalizeFullName,
  normalizeStatusReason,
} from './staff-policy.js';
import { toAdminStaffView } from './staff-views.js';
import { StaffRepository } from './staff.repository.js';
import type { AdminStaffView, AssignmentInput, StaffRecord, StaffTx } from './staff.types.js';

const ENTITY = 'staff_user';
const NOT_FOUND = 'Empleado no encontrado';

export interface CreateStaffInput {
  fullName: string;
  email: string;
  assignments: AssignmentInput[];
}

export interface UpdateStaffInput {
  fullName?: string;
  email?: string;
}

type RoleWithPermissions = { id: string; code: string; name: string; permissions: string[] };

/**
 * Comandos de personal. Cada cambio y su evento de auditoría van en UNA transacción; las mutaciones que pueden
 * tocar a un administrador toman primero el candado `app:staff-admin-guard` (mismo que `staff:bootstrap`) y
 * recuentan administradores antes de confirmar. Ver ADR-0010.
 */
@Injectable()
export class StaffCommandsService {
  private readonly logger = new Logger(StaffCommandsService.name);

  constructor(
    @Inject(StaffRepository) private readonly repo: StaffRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(BranchesQueryService) private readonly branches: BranchesQueryService,
    @Inject(StaffCommandGuard) private readonly guard: StaffCommandGuard,
  ) {}

  /** Preautoriza: crea `staff_users` sin `auth_user_id` + asignaciones. No crea cuenta de Auth ni envía correos. */
  async create(caller: StaffContext, input: CreateStaffInput): Promise<AdminStaffView> {
    const fullName = normalizeFullName(input.fullName);
    const email = normalizeEmail(input.email);
    assertNoDuplicateAssignments(input.assignments);

    return this.guard.run(caller, { entityType: ENTITY, entityId: caller.staffId }, async () => {
      const id = await this.repo.transaction(async (tx) => {
        // Candado primero; luego permisos VIGENTES del actor (pudieron revocarse tras el guard HTTP).
        await this.repo.lockAdminGuard(tx);
        const actor = await this.freshActor(tx, caller);
        const roles = await this.requireRoles(input.assignments, tx);
        const createScope = this.authorization.scopeFor(actor, 'staff.create');
        for (const a of input.assignments) {
          const role = roles.get(a.roleId) as RoleWithPermissions;
          if (!scopeCovers(createScope, a.branchId))
            throw new EscalationDenied('scope_not_covered');
          if (!canGrantRole(actor.grants, role.permissions, a.branchId)) {
            throw new EscalationDenied(
              a.branchId === null ? 'global_scope_denied' : 'role_not_grantable',
            );
          }
        }
        for (const a of input.assignments) {
          assertAdminGlobalRule((roles.get(a.roleId) as RoleWithPermissions).code, a.branchId);
        }
        await this.assertBranchesActive(tx, input.assignments);

        const created = await this.repo.insertStaff(tx, {
          fullName,
          email,
          createdBy: actor.staffId,
          assignments: input.assignments,
        });
        await this.audit.record(tx, {
          actorId: actor.staffId,
          entityType: ENTITY,
          entityId: created,
          action: 'staff.created',
          newValues: {
            // Sin PII: ni nombre ni correo; el id de la fila identifica al empleado.
            identityStatus: 'PENDING_LINK',
            assignments: this.describeInputs(input.assignments, roles),
          },
        });
        return created;
      });
      this.logger.log(`Empleado preautorizado (id=${id}, staff=${caller.staffId})`);
      return this.viewOf(caller, await this.requireStaff(id));
    });
  }

  async update(caller: StaffContext, id: string, input: UpdateStaffInput): Promise<AdminStaffView> {
    const patch: UpdateStaffInput = {};
    if (input.fullName !== undefined) patch.fullName = normalizeFullName(input.fullName);
    if (input.email !== undefined) patch.email = normalizeEmail(input.email);
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(['Debe enviar al menos un campo a modificar']);
    }

    return this.guard.run(caller, { entityType: ENTITY, entityId: id }, () =>
      this.repo.transaction(async (tx) => {
        const actor = await this.freshActor(tx, caller);
        const current = await this.lockAndLoad(tx, actor, id);
        const isSelf = id === actor.staffId;
        const emailChanges = patch.email !== undefined && patch.email !== current.email;
        if (isSelf) {
          // Nadie edita su propia cuenta salvo el nombre.
          if (emailChanges) throw new EscalationDenied('self_modification');
        } else {
          this.assertManageable(actor, current, 'staff.update');
        }
        // El correo identifica la fila preautorizada: una identidad vinculada no lo cambia (procedimiento futuro).
        if (emailChanges && current.linked) {
          throw new ConflictException('El correo de una identidad vinculada no se puede cambiar');
        }

        const data: UpdateStaffInput = {};
        if (patch.fullName !== undefined && patch.fullName !== current.fullName) {
          data.fullName = patch.fullName;
        }
        if (emailChanges && patch.email !== undefined) {
          data.email = patch.email;
        }
        if (Object.keys(data).length === 0) return this.viewOf(actor, current); // sin cambios reales

        await this.repo.updateStaff(tx, id, data);
        await this.audit.record(tx, {
          actorId: actor.staffId,
          entityType: ENTITY,
          entityId: id,
          action: 'staff.updated',
          // Sin PII: solo los NOMBRES de los campos modificados, nunca valores de nombre o correo.
          newValues: { changedFields: Object.keys(data).sort() },
        });
        this.logger.log(`Empleado actualizado (id=${id}, staff=${actor.staffId})`);
        return this.viewOf(actor, await this.requireStaff(id, tx));
      }),
    );
  }

  async changeStatus(
    caller: StaffContext,
    id: string,
    input: { active: boolean; reason?: string },
  ): Promise<AdminStaffView> {
    const reason = normalizeStatusReason(input.active, input.reason);

    return this.guard.run(caller, { entityType: ENTITY, entityId: id }, () =>
      this.repo.transaction(async (tx) => {
        await this.repo.lockAdminGuard(tx);
        const actor = await this.freshActor(tx, caller);
        // Nadie cambia su propio estado ni se reactiva.
        if (id === actor.staffId) throw new EscalationDenied('self_modification');
        const current = await this.lockAndLoad(tx, actor, id);
        this.assertManageable(actor, current, 'staff.disable');
        if (current.active === input.active) return this.viewOf(actor, current); // idempotente

        await this.repo.updateStaff(tx, id, { active: input.active });
        await this.audit.record(tx, {
          actorId: actor.staffId,
          entityType: ENTITY,
          entityId: id,
          action: input.active ? 'staff.activated' : 'staff.deactivated',
          reason,
          oldValues: { active: current.active },
          newValues: { active: input.active },
        });
        if (!input.active && current.assignments.some(isGlobalAdmin)) {
          await this.assertAdministratorRemains(tx);
        }
        this.logger.log(
          `Empleado ${input.active ? 'activado' : 'desactivado'} (id=${id}, staff=${actor.staffId})`,
        );
        return this.viewOf(actor, await this.requireStaff(id, tx));
      }),
    );
  }

  /** Reemplazo completo y transaccional con diff; las filas retiradas se eliminan (el diff queda en la auditoría). */
  async replaceAssignments(
    caller: StaffContext,
    id: string,
    input: { assignments: AssignmentInput[] },
  ): Promise<AdminStaffView> {
    assertNoDuplicateAssignments(input.assignments);

    return this.guard.run(caller, { entityType: ENTITY, entityId: id }, () =>
      this.repo.transaction(async (tx) => {
        await this.repo.lockAdminGuard(tx);
        const actor = await this.freshActor(tx, caller);
        if (id === actor.staffId) throw new EscalationDenied('self_modification');
        const current = await this.lockAndLoad(tx, actor, id);
        this.assertManageable(actor, current, 'staff.assign_roles');

        const roles = await this.requireRoles(input.assignments, tx);
        for (const a of input.assignments) {
          const role = roles.get(a.roleId) as RoleWithPermissions;
          if (!canGrantRole(actor.grants, role.permissions, a.branchId)) {
            throw new EscalationDenied(
              a.branchId === null ? 'global_scope_denied' : 'role_not_grantable',
            );
          }
        }
        for (const a of input.assignments) {
          assertAdminGlobalRule((roles.get(a.roleId) as RoleWithPermissions).code, a.branchId);
        }

        const diff = diffAssignments(current.assignments, input.assignments);
        if (diff.add.length === 0 && diff.remove.length === 0) return this.viewOf(actor, current);
        await this.assertBranchesActive(tx, diff.add);

        await this.repo.deleteAssignments(
          tx,
          diff.remove.map((r) => r.id),
        );
        await this.repo.createAssignments(tx, id, diff.add);
        await this.audit.record(tx, {
          actorId: actor.staffId,
          entityType: ENTITY,
          entityId: id,
          action: 'staff.assignments_changed',
          newValues: {
            added: this.describeInputs(diff.add, roles),
            removed: diff.remove.map((r) => describeAssignment(r.role.code, r.branch?.id ?? null)),
          },
        });
        if (current.assignments.some(isGlobalAdmin)) await this.assertAdministratorRemains(tx);
        this.logger.log(`Asignaciones reemplazadas (id=${id}, staff=${actor.staffId})`);
        return this.viewOf(actor, await this.requireStaff(id, tx));
      }),
    );
  }

  // --- helpers ---------------------------------------------------------------------------------

  /** Bloquea la fila y la lee. Inexistente y fuera de alcance de lectura son indistinguibles (404). */
  private async lockAndLoad(tx: StaffTx, actor: StaffContext, id: string): Promise<StaffRecord> {
    const record = (await this.repo.lockStaff(tx, id)) ? await this.repo.findStaff(id, tx) : null;
    // Uno mismo siempre es alcanzable (para editar su nombre); cualquier otro, solo dentro de `staff.read`.
    if (!record || (id !== actor.staffId && !isVisible(actor.grants, record))) {
      throw new NotFoundException(NOT_FOUND);
    }
    return record;
  }

  /** Visible pero no gestionable (alcance incompleto o rol no otorgable) = 403 + evento de seguridad. */
  private assertManageable(actor: StaffContext, target: StaffRecord, permission: string): void {
    if (!isManageable(actor.grants, actor.staffId, target, permission)) {
      throw new EscalationDenied('target_not_manageable');
    }
  }

  /**
   * Permisos VIGENTES del actor, releídos con el cliente de la transacción tras tomar el candado. Si dejó de estar
   * activo o perdió toda asignación efectiva (p. ej. lo desactivaron tras el guard HTTP) → 403 sin mutar.
   */
  private async freshActor(tx: StaffTx, caller: StaffContext): Promise<StaffContext> {
    const fresh = await this.authorization.refreshInTx(tx, caller);
    if (!fresh) throw new EscalationDenied('actor_no_longer_authorized');
    return fresh;
  }

  /** Roles leídos DENTRO de la transacción y bloqueados (FOR SHARE): sus permisos no cambian hasta el commit. */
  private async requireRoles(
    inputs: AssignmentInput[],
    tx: StaffTx,
  ): Promise<Map<string, RoleWithPermissions>> {
    const ids = [...new Set(inputs.map((i) => i.roleId))];
    await this.repo.lockRolesShared(tx, ids);
    const found = await this.repo.findRolesByIds(ids, tx);
    if (found.length !== ids.length) throw new BadRequestException(['Rol inexistente']);
    return new Map(found.map((r) => [r.id, r]));
  }

  /** Las sucursales deben existir y estar activas, validadas y bloqueadas (FOR SHARE) con el cliente `tx` de F07. */
  private async assertBranchesActive(tx: StaffTx, inputs: AssignmentInput[]): Promise<void> {
    const ids = inputs.flatMap((i) => (i.branchId === null ? [] : [i.branchId]));
    if (!(await this.branches.allActiveForShare(tx, ids))) {
      throw new BadRequestException(['Sucursal inexistente o inactiva']);
    }
  }

  /** Último administrador (ADR-0010 d.5): con el candado tomado, recuenta antes de confirmar. */
  private async assertAdministratorRemains(tx: StaffTx): Promise<void> {
    if ((await this.repo.countActiveLinkedGlobalAdmins(tx)) === 0) {
      throw new ConflictException('La operación dejaría al sistema sin un administrador activo');
    }
  }

  private describeInputs(
    inputs: AssignmentInput[],
    roles: Map<string, RoleWithPermissions>,
  ): string[] {
    return inputs.map((i) => describeAssignment(roles.get(i.roleId)?.code ?? i.roleId, i.branchId));
  }

  private async requireStaff(id: string, tx?: StaffTx): Promise<StaffRecord> {
    const record = await this.repo.findStaff(id, tx);
    if (!record) throw new NotFoundException(NOT_FOUND);
    return record;
  }

  private viewOf(actor: StaffContext, record: StaffRecord): AdminStaffView {
    return toAdminStaffView(
      record,
      isManageable(actor.grants, actor.staffId, record, 'staff.update'),
    );
  }
}
