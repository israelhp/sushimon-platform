import type { Branch, StaffPermission, StaffRole, StaffUser } from '@/lib/data-access/models';
import { permissionsFor } from '@/lib/permissions';
import type { PillTone } from '@/components/ui/Pill';

/** Lógica de la pantalla Usuarios (sin React). La UI solo orienta: el servidor valida correo, rol y sucursal. */

export const ROLE_PILL_TONE: Record<StaffRole, PillTone> = {
  admin: 'info',
  manager: 'alert',
  kitchen: 'confirmed',
};

export const ROLE_ORDER: readonly StaffRole[] = ['admin', 'manager', 'kitchen'];

/** Todos los permisos asignables, en el orden del prototipo (`PERMS`). */
export const ALL_PERMISSIONS: readonly StaffPermission[] = [
  'dashboard',
  'orders.accept',
  'orders.status',
  'orders.dispatch',
  'products.edit',
  'products.availability',
  'promotions',
  'branches',
  'users',
  'reports',
];

/** Misma regla que el servidor mock (`isValidEmail`). */
export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

export interface UserFormValues {
  name: string;
  email: string;
  role: StaffRole;
  /** `all` solo para administrador. */
  branchId: string;
  permissions: StaffPermission[];
}

export type UserFormField = 'name' | 'email' | 'branchId';

export interface UserFormErrors {
  fields: UserFormField[];
  /** Texto del banner: `contact` = falta nombre o correo válido (el del prototipo); `branch` = falta sucursal. */
  reason: 'contact' | 'branch';
}

/** Validación del modal; `fields` se ordena como el formulario para enfocar el primero. */
export function validateUserForm(values: UserFormValues): UserFormErrors | null {
  const fields: UserFormField[] = [];
  if (!values.name.trim()) fields.push('name');
  if (!isValidEmail(values.email)) fields.push('email');
  if (values.role !== 'admin' && (!values.branchId || values.branchId === 'all')) {
    fields.push('branchId');
  }
  if (!fields.length) return null;
  return { fields, reason: fields.length === 1 && fields[0] === 'branchId' ? 'branch' : 'contact' };
}

export function emptyUserForm(firstBranchId: string): UserFormValues {
  return {
    name: '',
    email: '',
    role: 'manager',
    branchId: firstBranchId,
    permissions: permissionsFor('manager'),
  };
}

export function userToForm(user: StaffUser): UserFormValues {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    branchId: user.branchId ?? 'all',
    permissions: [...user.permissions],
  };
}

/** Cambio de rol: reinicia permisos y sucursal (administrador = todas; resto = una sucursal). */
export function withRole(
  values: UserFormValues,
  role: StaffRole,
  firstBranchId: string,
): UserFormValues {
  return {
    ...values,
    role,
    permissions: permissionsFor(role),
    branchId:
      role === 'admin' ? 'all' : values.branchId === 'all' ? firstBranchId : values.branchId,
  };
}

export function toggled(permissions: readonly StaffPermission[], permission: StaffPermission) {
  return permissions.includes(permission)
    ? permissions.filter((p) => p !== permission)
    : [...permissions, permission];
}

export function toUserInput(values: UserFormValues) {
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    role: values.role,
    branchId: values.role === 'admin' ? null : values.branchId,
    permissions: values.permissions,
  };
}

export function userBranchLabel(user: Pick<StaffUser, 'branchId'>, branches: readonly Branch[]) {
  if (user.branchId === null) return 'Todas';
  return branches.find((b) => b.id === user.branchId)?.name ?? user.branchId;
}

export function matchesUserSearch(user: Pick<StaffUser, 'name' | 'email'>, query: string) {
  const q = query.trim().toLowerCase();
  return !q || user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q);
}

/** Cuántos administradores activos hay (para avisar de que el último no debe desactivarse). */
export const activeAdminCount = (users: readonly StaffUser[]) =>
  users.filter((u) => u.role === 'admin' && u.active).length;
