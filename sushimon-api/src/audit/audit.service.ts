import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

/** Solo lo que AuditService necesita del cliente transaccional (facilita dobles en pruebas). */
export type AuditWriter = Pick<Prisma.TransactionClient, 'auditEvent'>;

export type AuditValues = Record<string, string | number | boolean | null | string[]>;

export interface AuditEventInput {
  /** `staff_users.id` de quien actúa (null = sistema). */
  actorId: string | null;
  branchId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  reason?: string | null;
  /** Solo los campos que cambian (diff real), no el registro completo. */
  oldValues?: AuditValues | null;
  newValues?: AuditValues | null;
}

/**
 * Escritura mínima en `app.audit_events` (F07; F36 la ampliará). Recibe el cliente de la transacción del
 * cambio: el evento y el cambio se confirman o se revierten juntos. No guarda PII ni secretos: el llamador
 * decide qué campos entran en el diff.
 */
@Injectable()
export class AuditService {
  async record(tx: AuditWriter, event: AuditEventInput): Promise<void> {
    await tx.auditEvent.create({
      data: {
        actorId: event.actorId,
        branchId: event.branchId ?? null,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        reason: event.reason ?? null,
        ...(event.oldValues ? { oldValues: event.oldValues } : {}),
        ...(event.newValues ? { newValues: event.newValues } : {}),
      },
    });
  }
}
