import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { translateBranchDbError } from './branch-db-errors.js';
import {
  diffBranch,
  normalizeCreate,
  normalizeStatus,
  normalizeUpdate,
  assertCoordinatePair,
  resultingCoordinates,
  type CreateBranchInput,
  type StatusInput,
  type UpdateBranchInput,
} from './branch-policy.js';
import { BranchesRepository, type BranchTx } from './branches.repository.js';
import type { AdminBranchView } from './branches.types.js';

const ENTITY = 'branch';
const NOT_FOUND = 'Sucursal no encontrada';

/** Comandos de escritura. Cada cambio y su evento de auditoría van en UNA transacción. */
@Injectable()
export class BranchesCommandsService {
  private readonly logger = new Logger(BranchesCommandsService.name);

  constructor(
    @Inject(BranchesRepository) private readonly repo: BranchesRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  /** Alta global: solo personal con alcance a TODAS las sucursales. */
  async create(staff: StaffContext, input: CreateBranchInput): Promise<AdminBranchView> {
    // Alcance global SOLO si una asignación con permiso `branches.create` es global (no basta otro rol).
    if (!this.authorization.scopeFor(staff, 'branches.create').allBranches) {
      throw new ForbiddenException('Acceso denegado');
    }
    const data = normalizeCreate(input);
    try {
      const created = await this.repo.transaction(async (tx) => {
        const branch = await this.repo.insert(tx, data);
        await this.audit.record(tx, {
          actorId: staff.staffId,
          branchId: branch.id,
          entityType: ENTITY,
          entityId: branch.id,
          action: 'branch.created',
          newValues: {
            code: branch.code,
            name: branch.name,
            address: branch.address,
            phone: branch.phone,
            latitude: branch.latitude,
            longitude: branch.longitude,
            active: branch.active,
          },
        });
        return branch;
      });
      this.logger.log(`Sucursal creada (id=${created.id}, staff=${staff.staffId})`);
      return created;
    } catch (error) {
      // Unicidad garantizada por el UNIQUE de BD (sin SELECT previo racy); CHECK → 400.
      throw translateBranchDbError(error);
    }
  }

  async update(
    staff: StaffContext,
    id: string,
    input: UpdateBranchInput,
  ): Promise<AdminBranchView> {
    const patch = normalizeUpdate(input);
    this.assertInScope(staff, id);
    return this.inTransaction(async (tx) => {
      const current = await this.requireBranch(tx, id);
      const { latitude, longitude } = resultingCoordinates(current, patch);
      assertCoordinatePair(latitude, longitude);
      const diff = diffBranch(current, patch);
      if (!diff) return current; // sin cambios reales: ni escritura ni auditoría
      const updated = await this.repo.update(tx, id, diff.changes);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: id,
        entityType: ENTITY,
        entityId: id,
        action: 'branch.updated',
        oldValues: diff.oldValues,
        newValues: diff.newValues,
      });
      this.logger.log(`Sucursal actualizada (id=${id}, staff=${staff.staffId})`);
      return updated;
    });
  }

  async changeStatus(
    staff: StaffContext,
    id: string,
    input: StatusInput,
  ): Promise<AdminBranchView> {
    const { active, reason } = normalizeStatus(input);
    this.assertInScope(staff, id);
    return this.inTransaction(async (tx) => {
      const current = await this.requireBranch(tx, id);
      if (current.active === active) return current; // idempotente
      const updated = await this.repo.update(tx, id, { active });
      await this.audit.record(tx, {
        actorId: staff.staffId,
        branchId: id,
        entityType: ENTITY,
        entityId: id,
        action: active ? 'branch.activated' : 'branch.deactivated',
        reason,
        oldValues: { active: current.active },
        newValues: { active },
      });
      this.logger.log(
        `Sucursal ${active ? 'activada' : 'desactivada'} (id=${id}, staff=${staff.staffId})`,
      );
      return updated;
    });
  }

  /** Fuera del alcance de `branches.update` = inexistente (404), sin consultar la sucursal. */
  private assertInScope(staff: StaffContext, id: string): void {
    if (!this.authorization.canAccess(staff, 'branches.update', id)) {
      throw new NotFoundException(NOT_FOUND);
    }
  }

  private async inTransaction<T>(fn: (tx: BranchTx) => Promise<T>): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      throw translateBranchDbError(error);
    }
  }

  /** Lee la fila BLOQUEADA (FOR UPDATE): serializa PATCH concurrentes (sin lost updates ni doble auditoría). */
  private async requireBranch(tx: BranchTx, id: string): Promise<AdminBranchView> {
    const branch = await this.repo.findAdminForUpdate(tx, id);
    if (!branch) throw new NotFoundException(NOT_FOUND);
    return branch;
  }
}
