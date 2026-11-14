import type { BranchRef, GrantScope, StaffRole } from '@/lib/data-access/models';
import type { Grants } from '@/lib/permissions';

/**
 * Reglas de autorización del SERVIDOR reproducidas por el mock (spec 006, FR-011/FR-013/FR-014). Funciones puras:
 * `grants` solo con asignaciones de personal activo hacia sucursales activas (las globales, `branchId` null, siempre
 * cuentan). En http las calcula `AuthorizationService`; la UI solo las lee.
 */
export interface RbacRole {
  id: string;
  permissions: readonly string[];
}
export interface RbacAssignment {
  roleId: string;
  branchId: string | null;
}

export function computeGrants(
  staff: { active: boolean; assignments: readonly RbacAssignment[] },
  roles: readonly RbacRole[],
  branches: readonly { id: string; active: boolean }[],
): Grants {
  if (!staff.active) return {};
  const activeBranches = new Set(branches.filter((b) => b.active).map((b) => b.id));
  const scopes = new Map<string, GrantScope>();
  for (const a of staff.assignments) {
    const role = roles.find((r) => r.id === a.roleId);
    if (!role) continue;
    if (a.branchId !== null && !activeBranches.has(a.branchId)) continue;
    for (const code of role.permissions) {
      const scope = scopes.get(code) ?? { allBranches: false, branchIds: [] };
      if (a.branchId === null) scope.allBranches = true;
      else if (!scope.branchIds.includes(a.branchId)) scope.branchIds.push(a.branchId);
      scopes.set(code, scope);
    }
  }
  return Object.fromEntries(
    [...scopes].map(([code, scope]) => [
      code,
      { allBranches: scope.allBranches, branchIds: scope.allBranches ? [] : scope.branchIds },
    ]),
  );
}

/** Sucursales ACTIVAS con algún permiso (todas las activas si hay alcance global). */
export function contextBranches(
  grants: Grants,
  branches: readonly { id: string; name: string; code: string; active: boolean }[],
): BranchRef[] {
  const scopes = Object.values(grants);
  const global = scopes.some((s) => s.allBranches);
  const ids = new Set(scopes.flatMap((s) => s.branchIds));
  return branches
    .filter((b) => b.active && (global || ids.has(b.id)))
    .map((b) => ({ id: b.id, name: b.name, code: b.code }));
}

const ROLE_PRIORITY: readonly StaffRole[] = ['admin', 'manager', 'staff', 'kitchen'];

/** Rol principal para mostrar (avatar, etiqueta): el de mayor jerarquía entre las asignaciones. */
export function primaryRole(roles: readonly StaffRole[]): StaffRole {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? 'staff';
}
