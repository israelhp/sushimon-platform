import type { GrantScope, StaffPermission } from '@/lib/data-access/models';

/**
 * Permisos del backoffice en la UI (F03, ADR-0010). SOLO para mostrar u ocultar: la autorización real la decide el
 * servidor (`@RequireStaff` + `AuthorizationService`) y vuelve a validarse en cada solicitud.
 *
 * El origen de los permisos es el contexto administrativo (`grants`: permiso `modulo.accion` → alcance por sucursal)
 * que devuelve `GET /v1/auth/context` / `GET /v1/admin/me/context`. En modo mock lo calcula el adaptador mock con la
 * tabla de roles de `mocks/fixtures/rbac.ts` (equivalente al catálogo granular de la spec 006).
 */

/** Permiso → alcance (todas las sucursales o la lista de sucursales activas donde aplica). */
export type Grants = Readonly<Record<string, GrantScope>>;

/** Pantallas del backoffice (slugs de ruta bajo /backoffice). */
export type BackofficeScreen =
  | 'panel'
  | 'pedidos'
  | 'entregas'
  | 'motoristas'
  | 'productos'
  | 'categorias'
  | 'modificadores'
  | 'promociones'
  | 'banners'
  | 'sucursales'
  | 'usuarios'
  | 'roles'
  | 'reportes';

/** Permiso mínimo que hace visible cada pantalla (solo lectura). El servidor valida cada consulta. */
export const SCREEN_PERMISSION: Readonly<Record<BackofficeScreen, StaffPermission>> = {
  panel: 'dashboard.read',
  pedidos: 'orders.read',
  entregas: 'deliveries.read',
  motoristas: 'riders.read',
  productos: 'catalog.read',
  categorias: 'catalog.read',
  modificadores: 'catalog.read',
  promociones: 'promotions.read',
  banners: 'banners.read',
  sucursales: 'branches.read',
  usuarios: 'staff.read',
  roles: 'roles.read',
  reportes: 'reports.read',
};

/** Orden de preferencia de la pantalla inicial (la primera visible). */
const HOME_ORDER: readonly BackofficeScreen[] = [
  'panel',
  'pedidos',
  'entregas',
  'motoristas',
  'productos',
  'promociones',
  'banners',
  'sucursales',
  'usuarios',
  'roles',
  'reportes',
  'categorias',
  'modificadores',
];

/**
 * ¿Tiene el permiso? Sin `branchId`: en alguna sucursal (o global). Con `branchId`: en esa sucursal (o global).
 * Cosmético: el servidor decide.
 */
export function can(
  grants: Grants | null | undefined,
  permission: StaffPermission,
  branchId?: string | null,
): boolean {
  const scope = grants?.[permission];
  if (!scope) return false;
  if (scope.allBranches) return true;
  if (branchId === undefined || branchId === null) return scope.branchIds.length > 0;
  return scope.branchIds.includes(branchId);
}

/** ¿Tiene el permiso con alcance global (todas las sucursales)? */
export function canGlobally(
  grants: Grants | null | undefined,
  permission: StaffPermission,
): boolean {
  return Boolean(grants?.[permission]?.allBranches);
}

export function canSee(grants: Grants | null | undefined, screen: BackofficeScreen): boolean {
  return can(grants, SCREEN_PERMISSION[screen]);
}

export function visibleScreens(grants: Grants | null | undefined): BackofficeScreen[] {
  return HOME_ORDER.filter((screen) => canSee(grants, screen));
}

/** Pantalla inicial: la primera visible (el panel si tiene `dashboard.read`; si no, Pedidos, etc.). */
export function homeScreen(grants: Grants | null | undefined): BackofficeScreen {
  return HOME_ORDER.find((screen) => canSee(grants, screen)) ?? 'panel';
}

/** Módulo de un permiso (`orders.accept` → `orders`). */
export const permissionModule = (code: string) => code.split('.')[0] ?? code;
