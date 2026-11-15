import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import {
  AUTH_ADMIN_PORT,
  AuthAdminProviderError,
  AuthAdminUnavailableError,
  type AuthAdminPort,
} from '../auth-admin/auth-admin.port.js';
import { codedException } from '../common/errors/coded-exception.js';
import type { StaffContext } from '../identity/identity.types.js';
import { StaffCommandGuard } from './staff-command-guard.js';
import { assertCanResetMfa, EscalationDenied, isVisible } from './staff-policy.js';
import { StaffRepository } from './staff.repository.js';

const ENTITY = 'staff_user';

/** Tope de factores eliminados por solicitud: un proveedor que devuelva más se procesa hasta el tope y se reporta. */
export const MFA_RESET_MAX_FACTORS = 20;
/** Plazo TOTAL de la fase 2 (lista + borrados), además del timeout por llamada. */
export const MFA_RESET_DEADLINE_MS = 15_000;

export const MFA_RESET_UNAVAILABLE = 'MFA_RESET_UNAVAILABLE';
export const MFA_RESET_FAILED = 'MFA_RESET_FAILED';
const UNAVAILABLE_MESSAGE = 'El reinicio de MFA no está disponible en este entorno';
const FAILED_MESSAGE = 'No se pudo reiniciar el MFA; reintenta más tarde';

/**
 * Reinicio de MFA por otro administrador global (F02). Fases, sin mantener una transacción abierta durante la red:
 *  1. Transacción corta: permisos VIGENTES del actor, reglas (global, no a uno mismo), objetivo visible y vinculado.
 *  1b. Justo antes de la primera llamada externa: el actor se reevalúa (pudo desactivarse o perder alcance entre fases;
 *     403 genérico + `staff.denied_escalation`) y se audita la INTENCIÓN `staff.mfa_reset_requested` en su propia
 *     transacción, de modo que cualquier fallo posterior deje rastro.
 *  2. Supabase Auth Admin (puerto `AUTH_ADMIN_PORT`): lista y elimina los factores, con tope de factores y plazo total
 *     (además del timeout por llamada del adaptador). Idempotente.
 *  3. Transacción de auditoría: `staff.mfa_reset` (o `staff.mfa_reset_failed` si el proveedor falla). Solo ids y
 *     contadores: sin PII, sin `auth_user_id`, sin secretos ni detalle del proveedor.
 * Si la auditoría de éxito falla tras eliminar los factores, la solicitud falla (500) y el reintento es seguro
 * (sin factores => 204).
 */
@Injectable()
export class StaffMfaResetService {
  private readonly logger = new Logger(StaffMfaResetService.name);
  /** Plazo total de la fase 2 (ms). Ajustable solo en pruebas. */
  deadlineMs = MFA_RESET_DEADLINE_MS;

  constructor(
    @Inject(StaffRepository) private readonly repo: StaffRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(StaffCommandGuard) private readonly guard: StaffCommandGuard,
    @Inject(AUTH_ADMIN_PORT) private readonly authAdmin: AuthAdminPort,
  ) {}

  async reset(caller: StaffContext, id: string): Promise<void> {
    const prepared = await this.guard.run(caller, { entityType: ENTITY, entityId: id }, () =>
      this.repo.transaction(async (tx) => {
        const actor = await this.authorization.refreshInTx(tx, caller);
        if (!actor) throw new EscalationDenied('actor_no_longer_authorized');
        // Las reglas del actor se evalúan ANTES de mirar al objetivo: quien no puede no averigua si existe.
        assertCanResetMfa(actor.grants, actor.staffId, id);
        const record = await this.repo.findStaff(id, tx);
        if (!record || !isVisible(actor.grants, record)) {
          throw codedException(HttpStatus.NOT_FOUND, 'STAFF_NOT_FOUND', 'Empleado no encontrado');
        }
        const authUserId = record.linked ? await this.repo.findAuthUserId(tx, id) : null;
        if (!authUserId) {
          throw codedException(
            HttpStatus.CONFLICT,
            'STAFF_NOT_LINKED',
            'El empleado aún no inició sesión: no tiene MFA que reiniciar',
          );
        }
        return { actorId: actor.staffId, authUserId };
      }),
    );

    // Fase 1b: reevaluar al actor y dejar constancia de la intención ANTES de tocar al proveedor.
    await this.guard.run(caller, { entityType: ENTITY, entityId: id }, () =>
      this.repo.transaction(async (tx) => {
        const actor = await this.authorization.refreshInTx(tx, caller);
        if (!actor) throw new EscalationDenied('actor_no_longer_authorized');
        assertCanResetMfa(actor.grants, actor.staffId, id);
        await this.audit.record(tx, {
          actorId: actor.staffId,
          entityType: ENTITY,
          entityId: id,
          action: 'staff.mfa_reset_requested',
        });
      }),
    );

    const progress: Progress = { removed: 0, cancelled: false };
    try {
      await this.withDeadline(this.removeFactors(prepared.authUserId, progress), progress);
    } catch (error) {
      const category = failureCategory(error);
      await this.recordFailure(prepared.actorId, id, progress.removed, category);
      this.logger.warn(
        `Reinicio de MFA fallido (id=${id}, staff=${prepared.actorId}, ${category})`,
      );
      if (error instanceof AuthAdminUnavailableError) {
        throw codedException(
          HttpStatus.SERVICE_UNAVAILABLE,
          MFA_RESET_UNAVAILABLE,
          UNAVAILABLE_MESSAGE,
        );
      }
      throw codedException(HttpStatus.BAD_GATEWAY, MFA_RESET_FAILED, FAILED_MESSAGE);
    }
    const removed = progress.removed;

    await this.repo.transaction((tx) =>
      this.audit.record(tx, {
        actorId: prepared.actorId,
        entityType: ENTITY,
        entityId: id,
        action: 'staff.mfa_reset',
        newValues: { factorsRemoved: removed },
      }),
    );
    this.logger.log(`MFA reiniciado (id=${id}, staff=${prepared.actorId}, factores=${removed})`);
  }

  /** Lista y elimina hasta el tope; si el proveedor devuelve más, procesa el tope y falla (`too_many_factors`). */
  private async removeFactors(authUserId: string, progress: Progress): Promise<void> {
    const factors = await this.authAdmin.listMfaFactors(authUserId);
    for (const factor of factors.slice(0, MFA_RESET_MAX_FACTORS)) {
      if (progress.cancelled) return;
      await this.authAdmin.deleteMfaFactor(authUserId, factor.id);
      progress.removed += 1;
    }
    if (factors.length > MFA_RESET_MAX_FACTORS)
      throw new AuthAdminProviderError('too_many_factors');
  }

  /** Plazo total: al agotarse cancela los borrados pendientes y falla como `timeout` (la llamada en vuelo se ignora). */
  private withDeadline(work: Promise<void>, progress: Progress): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        progress.cancelled = true;
        reject(new AuthAdminProviderError('timeout'));
      }, this.deadlineMs);
      work.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new AuthAdminProviderError('bad_response'));
        },
      );
    });
  }

  /** La auditoría del fallo nunca enmascara el error al cliente: si no se pudo escribir, solo se registra en el log. */
  private async recordFailure(
    actorId: string,
    id: string,
    removed: number,
    category: string,
  ): Promise<void> {
    try {
      await this.repo.transaction((tx) =>
        this.audit.record(tx, {
          actorId,
          entityType: ENTITY,
          entityId: id,
          action: 'staff.mfa_reset_failed',
          reason: category,
          newValues: { factorsRemoved: removed },
        }),
      );
    } catch {
      this.logger.error(`No se pudo registrar staff.mfa_reset_failed (actor=${actorId})`);
    }
  }
}

interface Progress {
  removed: number;
  cancelled: boolean;
}

/** Categoría fija y sin datos del proveedor (apta para auditoría y logs). */
function failureCategory(error: unknown): string {
  if (error instanceof AuthAdminUnavailableError) return 'unavailable';
  if (error instanceof AuthAdminProviderError) {
    return error.status === undefined ? error.kind : `${error.kind}_${error.status}`;
  }
  return 'unexpected';
}
