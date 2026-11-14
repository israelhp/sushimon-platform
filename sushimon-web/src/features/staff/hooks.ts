'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  CreateStaffRequest,
  ReplaceRolePermissionsRequest,
  ReplaceStaffAssignmentsRequest,
  UpdateStaffRequest,
  UpdateStaffStatusRequest,
} from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  createAdminStaff,
  getAdminContext,
  getAdminRole,
  getAdminStaff,
  listAdminPermissions,
  listAdminRoles,
  listAdminStaff,
  replaceAdminRolePermissions,
  replaceAdminStaffAssignments,
  setAdminStaffStatus,
  updateAdminStaff,
  type AdminStaffFilters,
} from '@/services/staff';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';

/**
 * F03 — Hooks de empleados, roles y permisos (contrato `/v1/admin/staff|roles|permissions`). Solo corren con sesión de
 * personal; ocultar UI es cosmético: la API decide (JWT + `staff.*`/`roles.*` + aal2).
 */

function useStaffEnabled() {
  return !!useDemoSession().staff;
}

/**
 * Contexto administrativo del propio empleado (`grants`, `branches`): la fuente de la navegación y de `can()`.
 * Se refresca al cambiar sus asignaciones o los permisos de su rol.
 */
export function useAdminContext() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.adminContext,
    queryFn: ({ signal }) => getAdminContext(client, signal),
    enabled,
    staleTime: 60_000,
  });
}

export function useAdminStaffList(filters: AdminStaffFilters = {}) {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.staffList(filters),
    queryFn: () => listAdminStaff(client, filters),
    enabled,
    // Mantiene la página anterior mientras llega la nueva (sin parpadeo al filtrar/paginar).
    placeholderData: (previous) => previous,
  });
}

export function useAdminStaff(id: string | null) {
  const client = useDataClient();
  const enabled = useStaffEnabled() && !!id;
  return useQuery({
    queryKey: queryKeys.backoffice.staffDetail(id ?? ''),
    queryFn: () => getAdminStaff(client, id as string),
    enabled,
  });
}

export function useAdminRoles() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.roleLists,
    queryFn: () => listAdminRoles(client),
    enabled,
  });
}

export function useAdminRole(id: string | null) {
  const client = useDataClient();
  const enabled = useStaffEnabled() && !!id;
  return useQuery({
    queryKey: queryKeys.backoffice.roleDetail(id ?? ''),
    queryFn: () => getAdminRole(client, id as string),
    enabled,
  });
}

/** Catálogo de permisos agrupado por módulo (cambia solo con migraciones). */
export function usePermissionCatalog() {
  const client = useDataClient();
  const enabled = useStaffEnabled();
  return useQuery({
    queryKey: queryKeys.backoffice.permissions,
    queryFn: () => listAdminPermissions(client),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export type StaffMutationKind = 'create' | 'update' | 'status' | 'assignments';

/**
 * Claves a invalidar tras una mutación de empleados (sin invalidar toda la app):
 * - crear: listas de empleados y de roles (`assignedStaffCount`);
 * - editar: listas + detalle (y el contexto solo si es el propio empleado);
 * - estado y asignaciones: listas + detalle + roles (conteo); el contexto solo si afecta al propio usuario.
 */
export function staffInvalidationKeys(
  kind: StaffMutationKind,
  id?: string,
  selfId?: string | null,
): QueryKey[] {
  const keys: QueryKey[] = [queryKeys.backoffice.staffLists];
  if (kind !== 'create' && id) keys.push(queryKeys.backoffice.staffDetail(id));
  if (kind !== 'update') keys.push(queryKeys.backoffice.roleLists);
  if (kind !== 'create' && id && id === selfId) keys.push(queryKeys.backoffice.adminContext);
  return keys;
}

/**
 * Cambiar los permisos de un rol afecta a roles (lista y detalle), a empleados (`manageable` y asignaciones
 * efectivas) y, potencialmente, al contexto del propio usuario.
 */
export function rolePermissionsInvalidationKeys(id?: string): QueryKey[] {
  const keys: QueryKey[] = [queryKeys.backoffice.roleLists];
  if (id) keys.push(queryKeys.backoffice.roleDetail(id));
  keys.push(queryKeys.backoffice.staff, queryKeys.backoffice.adminContext);
  return keys;
}

function useInvalidatingMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  keysOf: (args: TArgs) => QueryKey[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Se espera el refetch: mientras tanto la mutación sigue «pendiente» y la UI no repite la acción.
    onSuccess: (_data, args) =>
      Promise.all(keysOf(args).map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export function useCreateStaff() {
  const client = useDataClient();
  return useInvalidatingMutation(
    (input: CreateStaffRequest) => createAdminStaff(client, input),
    () => staffInvalidationKeys('create'),
  );
}

export function useUpdateStaff() {
  const client = useDataClient();
  const selfId = useDemoSession().staff?.userId;
  return useInvalidatingMutation(
    ({ id, input }: { id: string; input: UpdateStaffRequest }) =>
      updateAdminStaff(client, id, input),
    (args) => staffInvalidationKeys('update', args.id, selfId),
  );
}

export function useSetStaffStatus() {
  const client = useDataClient();
  const selfId = useDemoSession().staff?.userId;
  return useInvalidatingMutation(
    ({ id, input }: { id: string; input: UpdateStaffStatusRequest }) =>
      setAdminStaffStatus(client, id, input),
    (args) => staffInvalidationKeys('status', args.id, selfId),
  );
}

export function useReplaceStaffAssignments() {
  const client = useDataClient();
  const selfId = useDemoSession().staff?.userId;
  return useInvalidatingMutation(
    ({ id, input }: { id: string; input: ReplaceStaffAssignmentsRequest }) =>
      replaceAdminStaffAssignments(client, id, input),
    (args) => staffInvalidationKeys('assignments', args.id, selfId),
  );
}

export function useReplaceRolePermissions() {
  const client = useDataClient();
  return useInvalidatingMutation(
    ({ id, input }: { id: string; input: ReplaceRolePermissionsRequest }) =>
      replaceAdminRolePermissions(client, id, input),
    (args) => rolePermissionsInvalidationKeys(args.id),
  );
}
