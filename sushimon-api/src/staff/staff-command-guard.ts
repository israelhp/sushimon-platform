import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { translateStaffDbError } from './staff-db-errors.js';
import { EscalationDenied } from './staff-policy.js';
import { StaffRepository } from './staff.repository.js';

export interface DeniedTarget {
  entityType: 'staff_user' | 'role';
  entityId: string;
}

/**
 * Envoltura común de los comandos: convierte una violación anti-escalada en 403 genérico y registra
 * `staff.denied_escalation` en una transacción APARTE (la del comando ya se revirtió), y traduce errores de BD.
 */
@Injectable()
export class StaffCommandGuard {
  private readonly logger = new Logger(StaffCommandGuard.name);

  constructor(
    @Inject(StaffRepository) private readonly repo: StaffRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async run<T>(actor: StaffContext, target: DeniedTarget, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof EscalationDenied) {
        await this.recordDenied(actor, target, error.reason);
        // Mensaje genérico: la regla violada solo queda en la auditoría.
        throw new ForbiddenException('Acceso denegado');
      }
      throw translateStaffDbError(error);
    }
  }

  private async recordDenied(
    actor: StaffContext,
    target: DeniedTarget,
    reason: string,
  ): Promise<void> {
    try {
      await this.repo.transaction((tx) =>
        this.audit.record(tx, {
          actorId: actor.staffId,
          entityType: target.entityType,
          entityId: target.entityId,
          action: 'staff.denied_escalation',
          reason,
        }),
      );
    } catch {
      // La denegación se mantiene aunque la auditoría falle; sin detalles ni datos personales en el log.
      this.logger.error(`No se pudo registrar staff.denied_escalation (actor=${actor.staffId})`);
    }
  }
}
