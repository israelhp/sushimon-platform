import { BadRequestException } from '@nestjs/common';
import { hasPermission, scopeCovers, scopeOf } from '../auth/authorization.js';
import type { Grants } from '../identity/identity.types.js';
import type { AssignmentInput, AssignmentRecord, StaffRecord } from './staff.types.js';

/**
 * Reglas de dominio de personal y RBAC (ADR-0010): funciones puras, sin I/O. Los permisos del ACTOR se pasan
 * como `grants` (calculados en el servidor); aquí nunca se mira el token.
 */

export const FULL_NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const REASON_MAX = 200;
export const ADMIN_ROLE_CODE = 'admin';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Violación de una regla anti-escalada: la API responde 403 genérico y el motivo solo va a la auditoría. */
export class EscalationDenied extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'EscalationDenied';
  }
}

function fail(message: string): never {
  throw new BadRequestException([message]);
}

/** Correo normalizado: recortado y en minúsculas (la BD tiene CHECK de minúsculas y UNIQUE). */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email))
    fail('email inválido');
  return email;
}

/** Control (Cc) y formato (Cf: RTL override, ancho cero, BOM…): pueden falsificar cómo se ve un nombre. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

export function normalizeFullName(raw: string): string {
  if (CONTROL_OR_FORMAT.test(raw)) fail('fullName contiene caracteres no permitidos');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '') fail('fullName no puede estar vacío');
  if (name.length > FULL_NAME_MAX) fail(`fullName no puede superar ${FULL_NAME_MAX} caracteres`);
  return name;
}

/** Desactivar exige motivo; al activar es opcional. */
export function normalizeStatusReason(active: boolean, raw: string | undefined): string | null {
  const reason = raw === undefined ? '' : raw.trim().replace(/\s+/g, ' ');
  if (reason.length > REASON_MAX) fail(`reason no puede superar ${REASON_MAX} caracteres`);
  if (!active && reason === '') fail('reason es obligatorio al desactivar a un empleado');
  return reason === '' ? null : reason;
}

export const assignmentKey = (roleId: string, branchId: string | null): string =>
  `${roleId}|${branchId ?? 'global'}`;

/** Sin pares (rol, sucursal) repetidos. */
export function assertNoDuplicateAssignments(inputs: AssignmentInput[]): void {
  const seen = new Set<string>();
  for (const i of inputs) {
    const key = assignmentKey(i.roleId, i.branchId);
    if (seen.has(key)) fail('assignments contiene pares (roleId, branchId) repetidos');
    seen.add(key);
  }
}

/** Invariante «alcance global <=> rol admin» (ADR-0010 d.3); la BD la refuerza con un trigger. */
export function assertAdminGlobalRule(roleCode: string, branchId: string | null): void {
  if (branchId === null && roleCode !== ADMIN_ROLE_CODE)
    fail('El alcance global (branchId null) solo se permite con el rol admin');
  if (branchId !== null && roleCode === ADMIN_ROLE_CODE)
    fail('El rol admin solo puede asignarse con alcance global (branchId null)');
}

/** ¿El actor posee TODOS los permisos de un rol en la sucursal dada (null = global)? Regla del subconjunto. */
export function holdsRoleAt(
  grants: Grants,
  rolePermissions: string[],
  branchId: string | null,
): boolean {
  return rolePermissions.every((p) => scopeCovers(scopeOf(grants, p), branchId));
}

/** Otorgar/retirar un rol en un alcance: `staff.assign_roles` allí y subconjunto de los permisos del rol. */
export function canGrantRole(
  grants: Grants,
  rolePermissions: string[],
  branchId: string | null,
): boolean {
  return (
    scopeCovers(scopeOf(grants, 'staff.assign_roles'), branchId) &&
    holdsRoleAt(grants, rolePermissions, branchId)
  );
}

/** Visible = alguna asignación dentro del alcance de `staff.read` (global lo ve todo). Si no, 404. */
export function isVisible(grants: Grants, target: Pick<StaffRecord, 'assignments'>): boolean {
  if (!hasPermission(grants, 'staff.read')) return false;
  const scope = scopeOf(grants, 'staff.read');
  if (scope.allBranches) return true;
  return target.assignments.some((a) => a.branch !== null && scope.branchIds.includes(a.branch.id));
}

/**
 * Dominio del objetivo (FR-016): TODAS sus asignaciones dentro del alcance del permiso y cada rol otorgable
 * por el actor. Nadie se gestiona a sí mismo (solo `fullName`, que se trata aparte).
 */
export function isManageable(
  grants: Grants,
  actorId: string,
  target: Pick<StaffRecord, 'id' | 'assignments'>,
  permission: string,
): boolean {
  if (target.id === actorId) return false;
  const scope = scopeOf(grants, permission);
  return target.assignments.every((a) => {
    const branchId = a.branch?.id ?? null;
    return scopeCovers(scope, branchId) && holdsRoleAt(grants, a.role.permissions, branchId);
  });
}

export interface AssignmentDiff {
  /** Filas existentes a eliminar (ya sea retiradas o inactivas que se recrean). */
  remove: AssignmentRecord[];
  /** Asignaciones a crear. */
  add: AssignmentInput[];
}

/**
 * Diff entre lo almacenado y lo deseado. Una fila ACTIVA que coincide se conserva; una inactiva que coincide
 * se elimina y se recrea activa (el reemplazo deja exactamente lo pedido, todo efectivo).
 */
export function diffAssignments(
  current: AssignmentRecord[],
  desired: AssignmentInput[],
): AssignmentDiff {
  const desiredKeys = new Set(desired.map((d) => assignmentKey(d.roleId, d.branchId)));
  const kept = new Set<string>();
  const remove: AssignmentRecord[] = [];
  for (const row of current) {
    const key = assignmentKey(row.role.id, row.branch?.id ?? null);
    if (row.active && desiredKeys.has(key)) kept.add(key);
    else remove.push(row);
  }
  return {
    remove,
    add: desired.filter((d) => !kept.has(assignmentKey(d.roleId, d.branchId))),
  };
}

/** Descripción legible y sin PII de una asignación para la auditoría: `rol@codigo-sucursal` o `rol@global`. */
export const describeAssignment = (role: string, branch: string | null): string =>
  `${role}@${branch ?? 'global'}`;

/** ¿La fila concede el rol `admin` global activo? (para la protección del último administrador). */
export const isGlobalAdmin = (a: AssignmentRecord): boolean =>
  a.active && a.branch === null && a.role.code === ADMIN_ROLE_CODE;
