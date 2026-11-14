import type { Prisma } from '../generated/prisma/client.js';

/** Cliente transaccional (ya con el `AuditWriter` que necesita AuditService). */
export type StaffTx = Prisma.TransactionClient;

export interface RoleRefView {
  id: string;
  code: string;
  name: string;
}

export interface BranchRefView {
  id: string;
  name: string;
  code: string;
}

/** Asignación tal como vive en BD: el rol trae sus permisos para evaluar la regla del subconjunto. */
export interface AssignmentRecord {
  id: string;
  active: boolean;
  role: RoleRefView & { permissions: string[] };
  /** null = alcance global. */
  branch: (BranchRefView & { active: boolean }) | null;
}

/** Empleado en BD. `authUserId` NO sale del repositorio: solo se conserva si está vinculado. */
export interface StaffRecord {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
  linked: boolean;
  linkedAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; fullName: string } | null;
  assignments: AssignmentRecord[];
}

export type IdentityStatus = 'PENDING_LINK' | 'LINKED';

export interface StaffAssignmentView {
  role: RoleRefView;
  branch: BranchRefView | null;
  effective: boolean;
}

export interface AdminStaffView {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
  identityStatus: IdentityStatus;
  linkedAt: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
  assignments: StaffAssignmentView[];
  manageable: boolean;
}

export interface AdminStaffPageView {
  items: AdminStaffView[];
  page: number;
  pageSize: number;
  total: number;
}

export type StaffSortField = 'fullName' | 'email' | 'createdAt';

export interface StaffListQuery {
  q?: string;
  branchId?: string;
  roleId?: string;
  active?: boolean;
  identityStatus?: IdentityStatus;
  sort?: StaffSortField;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface AssignmentInput {
  roleId: string;
  /** null = global. */
  branchId: string | null;
}

export interface RoleRecord extends RoleRefView {
  isSystem: boolean;
  permissions: { code: string; description: string }[];
  assignedStaffCount: number;
}

export interface AdminRoleView extends RoleRefView {
  isSystem: boolean;
  permissions: { code: string; description: string; module: string }[];
  assignedStaffCount: number;
}

export interface PermissionCatalogView {
  items: { module: string; permissions: { code: string; description: string }[] }[];
}
