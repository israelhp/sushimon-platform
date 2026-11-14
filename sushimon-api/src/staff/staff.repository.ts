import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  AssignmentInput,
  AssignmentRecord,
  RoleRecord,
  StaffListQuery,
  StaffRecord,
  StaffTx,
} from './staff.types.js';

const STAFF_SELECT = {
  id: true,
  fullName: true,
  email: true,
  active: true,
  authUserId: true,
  linkedAt: true,
  createdAt: true,
  creator: { select: { id: true, fullName: true } },
  assignments: {
    select: {
      id: true,
      active: true,
      role: {
        select: {
          id: true,
          code: true,
          name: true,
          permissions: { select: { permission: { select: { code: true } } } },
        },
      },
      branch: { select: { id: true, name: true, code: true, active: true } },
    },
    orderBy: [{ id: 'asc' }],
  },
} satisfies Prisma.StaffUserSelect;

type StaffRow = Prisma.StaffUserGetPayload<{ select: typeof STAFF_SELECT }>;

const ROLE_SELECT = {
  id: true,
  code: true,
  name: true,
  isSystem: true,
  permissions: { select: { permission: { select: { code: true, description: true } } } },
  _count: { select: { assignments: { where: { active: true, staff: { active: true } } } } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

/** `authUserId` se descarta aquí: solo se conserva «está vinculado». Nada de identidad sale del repositorio. */
function toRecord(row: StaffRow): StaffRecord {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    active: row.active,
    linked: row.authUserId !== null,
    linkedAt: row.linkedAt,
    createdAt: row.createdAt,
    createdBy: row.creator,
    assignments: row.assignments.map((a): AssignmentRecord => ({
      id: a.id,
      active: a.active,
      role: {
        id: a.role.id,
        code: a.role.code,
        name: a.role.name,
        permissions: a.role.permissions.map((rp) => rp.permission.code).sort(),
      },
      branch: a.branch,
    })),
  };
}

function toRole(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isSystem: row.isSystem,
    permissions: row.permissions
      .map((rp) => rp.permission)
      .sort((x, y) => x.code.localeCompare(y.code)),
    assignedStaffCount: row._count.assignments,
  };
}

export interface StaffListFilter extends StaffListQuery {
  /** null = sin restricción (alcance global de `staff.read`); lista = solo empleados con asignación allí. */
  scope: string[] | null;
  page: number;
  pageSize: number;
  sort: NonNullable<StaffListQuery['sort']>;
  order: NonNullable<StaffListQuery['order']>;
}

/** Único punto de acceso a datos de personal, roles y permisos. Selects mínimos; filtros y paginación en SQL. */
@Injectable()
export class StaffRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: StaffTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  /**
   * Serializa TODA mutación que pueda tocar a un administrador. Misma clave que `staff:bootstrap`
   * (ADR-0010 d.5). Se libera al terminar la transacción.
   */
  async lockAdminGuard(tx: StaffTx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('app:staff-admin-guard', 0))`;
  }

  /** Bloquea la fila del empleado (FOR UPDATE); false si no existe. Evita PATCH/PUT concurrentes sobre la misma. */
  async lockStaff(tx: StaffTx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.staff_users WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  /** Bloquea la fila del rol (FOR UPDATE); false si no existe. */
  async lockRole(tx: StaffTx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.roles WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  async findStaff(id: string, tx?: StaffTx): Promise<StaffRecord | null> {
    const row = await (tx ?? this.prisma).staffUser.findUnique({
      where: { id },
      select: STAFF_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async listStaff(f: StaffListFilter): Promise<{ items: StaffRecord[]; total: number }> {
    const q = f.q?.trim();
    const and: Prisma.StaffUserWhereInput[] = [];
    if (f.scope) and.push({ assignments: { some: { branchId: { in: f.scope } } } });
    if (f.branchId) and.push({ assignments: { some: { branchId: f.branchId } } });
    if (f.roleId) and.push({ assignments: { some: { roleId: f.roleId } } });
    if (f.active !== undefined) and.push({ active: f.active });
    if (f.identityStatus) {
      and.push({ authUserId: f.identityStatus === 'LINKED' ? { not: null } : null });
    }
    // La búsqueda trata `%`, `_` y `!` como texto literal (comodines escapados): ILIKE con ESCAPE '!' explícito
    // (carácter sin significado especial en cadenas SQL, evita ambigüedades de barras invertidas).
    if (q) {
      const pattern = `%${q.replace(/[!%_]/g, '!$&')}%`;
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM app.staff_users
        WHERE full_name ILIKE ${pattern} ESCAPE '!' OR email ILIKE ${pattern} ESCAPE '!'`;
      and.push({ id: { in: rows.map((r) => r.id) } });
    }
    const where: Prisma.StaffUserWhereInput = and.length > 0 ? { AND: and } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.staffUser.findMany({
        where,
        select: STAFF_SELECT,
        orderBy: [{ [f.sort]: f.order }, { id: 'asc' }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.staffUser.count({ where }),
    ]);
    return { items: rows.map(toRecord), total };
  }

  async insertStaff(
    tx: StaffTx,
    data: {
      fullName: string;
      email: string;
      createdBy: string;
      assignments: AssignmentInput[];
    },
  ): Promise<string> {
    const created = await tx.staffUser.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        createdBy: data.createdBy,
        assignments: {
          create: data.assignments.map((a) => ({ roleId: a.roleId, branchId: a.branchId })),
        },
      },
      select: { id: true },
    });
    return created.id;
  }

  async updateStaff(
    tx: StaffTx,
    id: string,
    data: { fullName?: string; email?: string; active?: boolean },
  ): Promise<void> {
    await tx.staffUser.update({ where: { id }, data, select: { id: true } });
  }

  async deleteAssignments(tx: StaffTx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.staffAssignment.deleteMany({ where: { id: { in: ids } } });
  }

  async createAssignments(tx: StaffTx, staffId: string, inputs: AssignmentInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await tx.staffAssignment.createMany({
      data: inputs.map((a) => ({ staffId, roleId: a.roleId, branchId: a.branchId })),
    });
  }

  /** Administradores activos, VINCULADOS y con asignación `admin` global activa (ADR-0010 d.5). */
  countActiveLinkedGlobalAdmins(tx: StaffTx): Promise<number> {
    return tx.staffUser.count({
      where: {
        active: true,
        authUserId: { not: null },
        assignments: { some: { active: true, branchId: null, role: { code: 'admin' } } },
      },
    });
  }

  /**
   * Bloquea (FOR SHARE) los roles indicados dentro de la transacción: sus permisos no cambian (PUT de permisos toma
   * FOR UPDATE) entre la regla del subconjunto y la escritura de la asignación.
   */
  async lockRolesShared(tx: StaffTx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM app.roles WHERE id = ANY(${ids}::uuid[]) FOR SHARE`;
  }

  /** Roles con sus permisos (para la regla del subconjunto). Devuelve solo los que existen. */
  async findRolesByIds(
    ids: string[],
    tx?: StaffTx,
  ): Promise<{ id: string; code: string; name: string; permissions: string[] }[]> {
    if (ids.length === 0) return [];
    const rows = await (tx ?? this.prisma).role.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        code: true,
        name: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      permissions: r.permissions.map((rp) => rp.permission.code).sort(),
    }));
  }

  async listRoles(): Promise<RoleRecord[]> {
    const rows = await this.prisma.role.findMany({
      select: ROLE_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRole);
  }

  async findRole(id: string, tx?: StaffTx): Promise<RoleRecord | null> {
    const row = await (tx ?? this.prisma).role.findUnique({ where: { id }, select: ROLE_SELECT });
    return row ? toRole(row) : null;
  }

  listPermissions(): Promise<{ code: string; description: string }[]> {
    return this.prisma.permission.findMany({
      select: { code: true, description: true },
      orderBy: { code: 'asc' },
    });
  }

  async findPermissionIds(tx: StaffTx, codes: string[]): Promise<Map<string, string>> {
    const rows = await tx.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  async replaceRolePermissions(
    tx: StaffTx,
    roleId: string,
    change: { removeCodes: string[]; addPermissionIds: string[] },
  ): Promise<void> {
    if (change.removeCodes.length > 0) {
      await tx.rolePermission.deleteMany({
        where: { roleId, permission: { code: { in: change.removeCodes } } },
      });
    }
    if (change.addPermissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: change.addPermissionIds.map((permissionId) => ({ roleId, permissionId })),
      });
    }
  }

  /** Empleados con una asignación activa del rol (para la auditoría del cambio de permisos). */
  async staffIdsWithRole(tx: StaffTx, roleId: string): Promise<string[]> {
    const rows = await tx.staffAssignment.findMany({
      where: { roleId, active: true, staff: { active: true } },
      select: { staffId: true },
    });
    return [...new Set(rows.map((r) => r.staffId))].sort();
  }
}
