import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  buildGrants,
  isEffective,
  scopedBranches,
  type AssignmentFact,
} from '../auth/authorization.js';
import type { BranchRef, StaffContext } from './identity.types.js';

export interface CustomerRecord {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  createdAt: Date;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async hasCustomer(authUserId: string): Promise<boolean> {
    return (await this.prisma.customer.count({ where: { authUserId } })) > 0;
  }

  /** Lectura SIN creación (F06: GET/DELETE de favoritos no deben crear filas en `customers`). */
  findCustomer(principal: Principal): Promise<CustomerRecord | null> {
    return this.prisma.customer.findUnique({ where: { authUserId: principal.authUserId } });
  }

  /** Devuelve el perfil de cliente de la identidad; lo crea (idempotente) si aún no existe. */
  async ensureCustomer(principal: Principal): Promise<CustomerRecord> {
    const existing = await this.prisma.customer.findUnique({
      where: { authUserId: principal.authUserId },
    });
    if (existing) return existing;
    try {
      return await this.prisma.customer.create({
        data: {
          authUserId: principal.authUserId,
          fullName: principal.displayName ?? principal.email?.split('@')[0] ?? 'Cliente',
          email: principal.email,
        },
      });
    } catch (error) {
      // Carrera entre dos solicitudes simultáneas: la otra ya creó la fila (UNIQUE auth_user_id).
      if ((error as { code?: string }).code === 'P2002') {
        return this.prisma.customer.findUniqueOrThrow({
          where: { authUserId: principal.authUserId },
        });
      }
      throw error;
    }
  }

  /**
   * Contexto de personal activo, o null. AUTORIZACIÓN: se calcula en el servidor desde la base de datos.
   * Primer acceso de un empleado preregistrado: vincula `auth_user_id` por correo, solo si la sesión nació
   * de OAuth con Google y la fila está activa y sin vincular (UPDATE atómico, una sola vez). Sin
   * preautorización NUNCA se crea personal: el vínculo solo actualiza una fila que ya existe.
   */
  async getStaffContext(principal: Principal): Promise<StaffContext | null> {
    let staff = await this.loadStaff({ authUserId: principal.authUserId });
    if (!staff && principal.googleOAuth && principal.email) {
      if (await this.tryLink(principal.authUserId, principal.email)) {
        staff = await this.loadStaff({ authUserId: principal.authUserId });
      }
    }
    return this.toContext(staff);
  }

  /**
   * Relee el contexto del empleado POR ID con el cliente de una transacción en curso. Los comandos de personal lo
   * usan tras tomar el candado de administradores para decidir con permisos vigentes (no los del guard, que pudieron
   * revocarse entre la autenticación y la escritura). null = ya no es personal activo con asignación efectiva.
   */
  async staffContextById(
    staffId: string,
    client: Pick<Prisma.TransactionClient, 'staffUser'> = this.prisma,
  ): Promise<StaffContext | null> {
    return this.toContext(await this.loadStaff({ id: staffId }, client));
  }

  private toContext(staff: Awaited<ReturnType<IdentityService['loadStaff']>>): StaffContext | null {
    if (!staff || !staff.active) return null;

    const facts: AssignmentFact[] = staff.assignments.map((a) => ({
      active: a.active,
      branchId: a.branchId,
      branch: a.branch,
      role: { code: a.role.code, permissions: a.role.permissions.map((rp) => rp.permission.code) },
    }));
    const effective = facts.filter(isEffective);
    if (effective.length === 0) return null;

    const grants = buildGrants(facts);
    const allBranches = Object.values(grants).some((g) => g.allBranches);
    // `branches`: solo las de asignaciones acotadas; con alcance global `withAllBranches` la completa (solo los
    // endpoints de contexto la necesitan: así el camino de autorización es UNA lectura).
    return {
      staffId: staff.id,
      fullName: staff.fullName,
      assignments: effective.map((a) => ({ role: a.role.code, branchId: a.branchId })),
      grants,
      branches: scopedBranches(facts),
      permissions: Object.keys(grants),
      allBranches,
      branchIds: [...new Set(Object.values(grants).flatMap((g) => g.branchIds))].sort(),
    };
  }

  /**
   * Completa `branches` para el contexto que se devuelve al cliente: con alcance global en algún permiso son
   * TODAS las sucursales activas (una consulta mínima); si no, las de sus asignaciones (ya cargadas).
   */
  async withAllBranches(staff: StaffContext): Promise<StaffContext> {
    if (!staff.allBranches) return staff;
    const branches: BranchRef[] = await this.prisma.branch.findMany({
      where: { active: true },
      select: { id: true, name: true, code: true },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
    return { ...staff, branches };
  }

  /**
   * Vincula la identidad a la fila preautorizada. UPDATE atómico (ADR-0009): con dos identidades simultáneas
   * del mismo correo gana una (la otra encuentra `auth_user_id` ya fijado y afecta 0 filas). `linked_at` y
   * el evento `staff.linked` se confirman en la MISMA transacción que el vínculo.
   */
  private async tryLink(authUserId: string, email: string): Promise<boolean> {
    try {
      const linkedId = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.staffUser.updateMany({
          where: { email, authUserId: null, active: true },
          data: { authUserId, linkedAt: new Date() },
        });
        if (count !== 1) return null;
        const row = await tx.staffUser.findUnique({ where: { authUserId }, select: { id: true } });
        if (!row) return null;
        await this.audit.record(tx, {
          actorId: row.id,
          entityType: 'staff_user',
          entityId: row.id,
          action: 'staff.linked',
          // Sin correo ni auth_user_id en la auditoría.
          newValues: { identityStatus: 'LINKED' },
        });
        return row.id;
      });
      if (linkedId) this.logger.log(`Empleado vinculado a su identidad (staff=${linkedId})`);
      return linkedId !== null;
    } catch (error) {
      // Esta identidad ya está vinculada a otra fila (UNIQUE auth_user_id) por una solicitud concurrente.
      if ((error as { code?: string }).code === 'P2002') return false;
      throw error;
    }
  }

  private loadStaff(
    where: { authUserId: string } | { id: string },
    client: Pick<Prisma.TransactionClient, 'staffUser'> = this.prisma,
  ) {
    return client.staffUser.findUnique({
      where,
      select: {
        id: true,
        fullName: true,
        active: true,
        assignments: {
          where: { active: true },
          select: {
            active: true,
            branchId: true,
            branch: { select: { id: true, name: true, code: true, active: true } },
            role: {
              select: {
                code: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });
  }
}
