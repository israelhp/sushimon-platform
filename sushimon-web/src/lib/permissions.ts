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

/** Etiquetas del prototipo (PERMS / ROLE_LABEL), en español: el backoffice es solo es. */
export const PERMISSION_LABEL: Record<StaffPermission, string> = {
  dashboard: 'Ver panel general',
  'orders.accept': 'Aceptar y rechazar pedidos',
  'orders.status': 'Cambiar estados de preparación',
  'orders.dispatch': 'Solicitar repartidor PedidosYa',
  'products.edit': 'Crear y editar productos',
  'products.availability': 'Cambiar disponibilidad',
  promotions: 'Gestionar promociones',
  branches: 'Gestionar sucursales',
  users: 'Gestionar usuarios',
  reports: 'Ver reportes',
};

export const ROLE_LABEL: Record<StaffRole, string> = {
  admin: 'Administrador general',
  manager: 'Encargado de sucursal',
  kitchen: 'Cocina',
};

export const ROLE_DESCRIPTION: Record<StaffRole, string> = {
  admin: 'Acceso total: sucursales, catálogo, promociones, usuarios y reportes.',
  manager: 'Opera los pedidos y entregas de su sucursal y ve sus reportes.',
  kitchen: 'Ve el tablero de su sucursal y avanza los estados de preparación.',
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
