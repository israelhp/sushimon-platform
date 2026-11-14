import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import type { StaffContext } from './identity.types.js';

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

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async hasCustomer(authUserId: string): Promise<boolean> {
    return (await this.prisma.customer.count({ where: { authUserId } })) > 0;
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
   * de OAuth con Google y la fila está activa y sin vincular (UPDATE atómico, una sola vez).
   */
  async getStaffContext(principal: Principal): Promise<StaffContext | null> {
    let staff = await this.loadStaff(principal.authUserId);
    if (!staff && principal.googleOAuth && principal.email) {
      const { count } = await this.prisma.staffUser.updateMany({
        where: { email: principal.email, authUserId: null, active: true },
        data: { authUserId: principal.authUserId },
      });
      if (count === 1) {
        this.logger.log(`Empleado vinculado a su identidad (auth_user_id=${principal.authUserId})`);
        staff = await this.loadStaff(principal.authUserId);
      }
    }
    if (!staff || !staff.active) return null;

    const assignments = staff.assignments;
    if (assignments.length === 0) return null;
    const permissions = new Set<string>();
    for (const a of assignments) {
      for (const rp of a.role.permissions) permissions.add(rp.permission.code);
    }
    return {
      staffId: staff.id,
      fullName: staff.fullName,
      assignments: assignments.map((a) => ({ role: a.role.code, branchId: a.branchId })),
      permissions: [...permissions].sort(),
      allBranches: assignments.some((a) => a.branchId === null),
      branchIds: [...new Set(assignments.flatMap((a) => (a.branchId ? [a.branchId] : [])))],
    };
  }

  private loadStaff(authUserId: string) {
    return this.prisma.staffUser.findUnique({
      where: { authUserId },
      include: {
        assignments: {
          where: { active: true },
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
  }
}
