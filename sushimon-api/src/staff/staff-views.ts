import type {
  AdminRoleView,
  AdminStaffView,
  PermissionCatalogView,
  RoleRecord,
  StaffRecord,
} from './staff.types.js';

/** Proyecciones de respuesta: aquí se decide qué sale. `authUserId` no existe en `StaffRecord`. */
export function toAdminStaffView(record: StaffRecord, manageable: boolean): AdminStaffView {
  return {
    id: record.id,
    fullName: record.fullName,
    email: record.email,
    active: record.active,
    identityStatus: record.linked ? 'LINKED' : 'PENDING_LINK',
    linkedAt: record.linkedAt ? record.linkedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    createdBy: record.createdBy
      ? { id: record.createdBy.id, fullName: record.createdBy.fullName }
      : null,
    assignments: record.assignments.map((a) => ({
      role: { id: a.role.id, code: a.role.code, name: a.role.name },
      branch: a.branch ? { id: a.branch.id, name: a.branch.name, code: a.branch.code } : null,
      // Una asignación inactiva o hacia una sucursal inactiva no concede acceso operativo.
      effective: a.active && (a.branch === null || a.branch.active),
    })),
    manageable,
  };
}

export const moduleOf = (code: string): string => code.split('.')[0] ?? code;

export function toAdminRoleView(role: RoleRecord): AdminRoleView {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    isSystem: role.isSystem,
    permissions: role.permissions.map((p) => ({ ...p, module: moduleOf(p.code) })),
    assignedStaffCount: role.assignedStaffCount,
  };
}

export function toPermissionCatalog(
  permissions: { code: string; description: string }[],
): PermissionCatalogView {
  const byModule = new Map<string, { code: string; description: string }[]>();
  for (const p of permissions) {
    const list = byModule.get(moduleOf(p.code)) ?? [];
    list.push({ code: p.code, description: p.description });
    byModule.set(moduleOf(p.code), list);
  }
  return {
    items: [...byModule]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, list]) => ({ module, permissions: list })),
  };
}
