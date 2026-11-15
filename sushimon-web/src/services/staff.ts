import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminContextResponse,
  AdminPermissionCatalog,
  AdminRole,
  AdminRoleList,
  AdminStaff,
  AdminStaffPage,
  CreateStaffRequest,
  ReplaceRolePermissionsRequest,
  ReplaceStaffAssignmentsRequest,
  StaffIdentityStatus,
  UpdateStaffRequest,
  UpdateStaffStatusRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F03 — Empleados, asignaciones, roles y permisos (contrato `/v1/admin/staff|roles|permissions`, ADR-0010). Nunca hay
 * `authUserId`. La API decide: la UI solo muestra/oculta según `manageable` y el contexto administrativo.
 */

export interface AdminStaffFilters {
  /** Nombre o correo (contiene); máx. 100 caracteres. */
  q?: string;
  /** Empleados con una asignación a esa sucursal exacta. */
  branchId?: string;
  roleId?: string;
  /** undefined = todos. */
  active?: boolean;
  identityStatus?: StaffIdentityStatus;
  sort?: 'fullName' | 'email' | 'createdAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** Contexto administrativo del propio empleado (`grants`, `branches`). */
export const getAdminContext = (client: DataClient, signal?: AbortSignal) =>
  client.get<AdminContextResponse>(paths.adminContext(), { signal });

export const listAdminStaff = (client: DataClient, filters: AdminStaffFilters = {}) =>
  client.get<AdminStaffPage>(paths.adminStaff(), {
    query: {
      q: filters.q?.trim() || undefined,
      branchId: filters.branchId,
      roleId: filters.roleId,
      active: filters.active,
      identityStatus: filters.identityStatus,
      sort: filters.sort,
      order: filters.order,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

export const getAdminStaff = (client: DataClient, id: string) =>
  client.get<AdminStaff>(paths.adminStaffMember(id));

/** Preautoriza (PENDING_LINK): sin cuenta de Auth ni correo. 409 si el correo ya existe. */
export const createAdminStaff = (client: DataClient, input: CreateStaffRequest) =>
  client.post<AdminStaff>(paths.adminStaff(), input);

/** Nombre y correo (el correo solo en PENDING_LINK; nadie edita su propia cuenta salvo el nombre). */
export const updateAdminStaff = (client: DataClient, id: string, input: UpdateStaffRequest) =>
  client.patch<AdminStaff>(paths.adminStaffMember(id), input);

/** Activa/desactiva. Desactivar exige `reason`; 409 si dejaría al sistema sin administrador. */
export const setAdminStaffStatus = (
  client: DataClient,
  id: string,
  input: UpdateStaffStatusRequest,
) => client.patch<AdminStaff>(paths.adminStaffStatus(id), input);

/** Reemplazo COMPLETO de asignaciones rol+sucursal (1..20, sin duplicados). */
export const replaceAdminStaffAssignments = (
  client: DataClient,
  id: string,
  input: ReplaceStaffAssignmentsRequest,
) => client.put<AdminStaff>(paths.adminStaffAssignments(id), input);

/**
 * F02: restablece el MFA de un empleado (elimina sus factores en el proveedor de identidad; deberá enrolar de nuevo en su
 * siguiente acceso). 204 sin cuerpo e idempotente. Solo administrador global y nunca sobre uno mismo (403); 404
 * `STAFF_NOT_FOUND`; 409 `STAFF_NOT_LINKED`; 429; 502 `MFA_RESET_FAILED`; 503 `MFA_RESET_UNAVAILABLE`.
 */
export const resetAdminStaffMfa = (client: DataClient, id: string) =>
  client.post<void>(paths.adminStaffMfaReset(id));

export const listAdminRoles = async (client: DataClient): Promise<AdminRole[]> =>
  (await client.get<AdminRoleList>(paths.adminRoles())).items;

export const getAdminRole = (client: DataClient, id: string) =>
  client.get<AdminRole>(paths.adminRole(id));

/** Catálogo de permisos agrupado por módulo. */
export const listAdminPermissions = async (client: DataClient) =>
  (await client.get<AdminPermissionCatalog>(paths.adminPermissions())).items;

/** Reemplazo completo de permisos de un rol (409 si es del sistema; 403 si no posee los añadidos). */
export const replaceAdminRolePermissions = (
  client: DataClient,
  id: string,
  input: ReplaceRolePermissionsRequest,
) => client.put<AdminRole>(paths.adminRolePermissions(id), input);
