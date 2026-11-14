import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import type { GrantScope, StaffContext } from '../identity/identity.types.js';
import { hasPermission, scopeCovers, scopeOf } from './authorization.js';

/**
 * Punto único de autorización por permiso y sucursal (ADR-0010 d.2). Los `grants` salen de UNA lectura a la
 * BD por solicitud (asignaciones activas de empleado activo hacia sucursales activas) y se memoizan SOLO en
 * `req.staff`: nunca entre solicitudes, de modo que una revocación rige en la siguiente petición.
 */
@Injectable()
export class AuthorizationService {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  /** Contexto del empleado de esta solicitud (null = no es personal activo). Memoizado en `req`. */
  async staffFor(req: Request): Promise<StaffContext | null> {
    if (req.staff) return req.staff;
    if (!req.principal) return null;
    const staff = await this.identity.getStaffContext(req.principal);
    if (staff) req.staff = staff;
    return staff;
  }

  /**
   * Relee los permisos del actor con el cliente de la transacción en curso (tras tomar el candado de administradores).
   * null = el actor ya no está activo o perdió toda asignación efectiva: el comando debe abortar sin mutar.
   */
  refreshInTx(
    tx: Pick<Prisma.TransactionClient, 'staffUser'>,
    actor: StaffContext,
  ): Promise<StaffContext | null> {
    return this.identity.staffContextById(actor.staffId, tx);
  }

  /** ¿Posee el permiso en algún alcance? (lo que exige `@RequireStaff`). */
  has(staff: StaffContext, permission: string): boolean {
    return hasPermission(staff.grants, permission);
  }

  /** Alcance del permiso (vacío si no lo posee). */
  scopeFor(staff: StaffContext, permission: string): GrantScope {
    return scopeOf(staff.grants, permission);
  }

  /** ¿Puede ejercer el permiso sobre la sucursal? `null` = alcance global (todas las sucursales). */
  canAccess(staff: StaffContext, permission: string, branchId: string | null): boolean {
    return scopeCovers(this.scopeFor(staff, permission), branchId);
  }
}
