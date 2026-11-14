import type { BranchRef, GrantScope, Grants } from '../identity/identity.types.js';

/** Dominio puro de autorización (sin I/O): cálculo de `grants` y consulta de alcance. */

export interface AssignmentFact {
  active: boolean;
  /** null = alcance global. */
  branchId: string | null;
  /** Sucursal de la asignación (null si es global). */
  branch: (BranchRef & { active: boolean }) | null;
  role: { code: string; permissions: string[] };
}

/**
 * Una asignación concede acceso solo si está activa y su sucursal está activa (las globales siempre cuentan).
 * La actividad del empleado la comprueba el llamador (un empleado inactivo no tiene contexto).
 */
export const isEffective = (a: AssignmentFact): boolean =>
  a.active && (a.branchId === null || (a.branch !== null && a.branch.active));

export function buildGrants(assignments: AssignmentFact[]): Grants {
  const sets = new Map<string, { allBranches: boolean; branchIds: Set<string> }>();
  for (const a of assignments.filter(isEffective)) {
    for (const permission of a.role.permissions) {
      const entry = sets.get(permission) ?? { allBranches: false, branchIds: new Set<string>() };
      if (a.branchId === null) entry.allBranches = true;
      else entry.branchIds.add(a.branchId);
      sets.set(permission, entry);
    }
  }
  const grants: Grants = {};
  for (const [permission, e] of [...sets].sort(([x], [y]) => x.localeCompare(y))) {
    grants[permission] = { allBranches: e.allBranches, branchIds: [...e.branchIds].sort() };
  }
  return grants;
}

const NO_SCOPE: GrantScope = { allBranches: false, branchIds: [] };

/** Alcance del permiso (vacío si no lo posee). Nunca devuelve el objeto interno para no permitir mutarlo. */
export function scopeOf(grants: Grants, permission: string): GrantScope {
  const scope = Object.hasOwn(grants, permission) ? grants[permission] : undefined;
  return scope
    ? { allBranches: scope.allBranches, branchIds: [...scope.branchIds] }
    : { ...NO_SCOPE, branchIds: [] };
}

export const hasPermission = (grants: Grants, permission: string): boolean =>
  Object.hasOwn(grants, permission);

export const scopeCovers = (scope: GrantScope, branchId: string | null): boolean =>
  branchId === null ? scope.allBranches : scope.allBranches || scope.branchIds.includes(branchId);

/** Sucursales activas con alguna asignación efectiva cuyo rol tenga al menos un permiso (sin las globales). */
export function scopedBranches(assignments: AssignmentFact[]): BranchRef[] {
  const byId = new Map<string, BranchRef>();
  for (const a of assignments.filter(isEffective)) {
    if (a.branch && a.role.permissions.length > 0) {
      byId.set(a.branch.id, { id: a.branch.id, name: a.branch.name, code: a.branch.code });
    }
  }
  return [...byId.values()].sort((x, y) => x.name.localeCompare(y.name));
}
