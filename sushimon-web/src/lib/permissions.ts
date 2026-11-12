import type { StaffPermission, StaffRole } from '@/lib/data-access/models';

/**
 * Permisos por rol del backoffice (ROLE_MENU / ROLE_PERMS del prototipo).
 * SOLO para mostrar u ocultar UI. La autorización real la decide el servidor; en modo mock la
 * reproduce el adaptador mock con estas mismas tablas.
 */

/** Pantallas del backoffice (slugs de ruta bajo /backoffice). */
export type BackofficeScreen =
  | 'panel'
  | 'pedidos'
  | 'entregas'
  | 'productos'
  | 'categorias'
  | 'promociones'
  | 'sucursales'
  | 'usuarios'
  | 'reportes';

export const ROLE_MENU: Record<StaffRole, readonly BackofficeScreen[]> = {
  admin: [
    'panel',
    'pedidos',
    'entregas',
    'productos',
    'categorias',
    'promociones',
    'sucursales',
    'usuarios',
    'reportes',
  ],
  manager: ['panel', 'pedidos', 'entregas', 'productos', 'reportes'],
  kitchen: ['pedidos'],
};

/** Pantalla inicial al entrar por rol. */
export const ROLE_HOME: Record<StaffRole, BackofficeScreen> = {
  admin: 'panel',
  manager: 'panel',
  kitchen: 'pedidos',
};

export const ROLE_PERMISSIONS: Record<StaffRole, readonly StaffPermission[]> = {
  admin: [
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
  ],
  manager: [
    'dashboard',
    'orders.accept',
    'orders.status',
    'orders.dispatch',
    'products.availability',
    'reports',
  ],
  kitchen: ['orders.accept', 'orders.status'],
};

export function permissionsFor(role: StaffRole): StaffPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function can(role: StaffRole | null | undefined, permission: StaffPermission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

export function canSee(role: StaffRole | null | undefined, screen: BackofficeScreen): boolean {
  return !!role && ROLE_MENU[role].includes(screen);
}
