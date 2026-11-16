import type { GrantScope, Grants, StaffContext } from '../../src/identity/identity.types.js';

/** Catálogo de 46 permisos (spec 006 + banners.* de F16) y matriz de roles sembrada por la migración 0005. */
export const ALL_PERMISSIONS = [
  'dashboard.read',
  'branches.read',
  'branches.create',
  'branches.update',
  'branches.manage_hours',
  'branches.manage_delivery_zones',
  'staff.read',
  'staff.create',
  'staff.update',
  'staff.disable',
  'staff.assign_roles',
  'roles.read',
  'roles.manage',
  'catalog.read',
  'catalog.create',
  'catalog.update',
  'catalog.manage_availability',
  'promotions.read',
  'promotions.create',
  'promotions.update',
  'banners.read',
  'banners.create',
  'banners.update',
  'orders.read',
  'orders.accept',
  'orders.reject',
  'orders.prepare',
  'orders.complete',
  'orders.cancel',
  'payments.read',
  'payments.confirm',
  'payments.refund',
  'riders.read',
  'riders.create',
  'riders.update',
  'riders.assign',
  'deliveries.read',
  'deliveries.assign',
  'deliveries.update',
  'incidents.read',
  'incidents.manage',
  'reports.read',
  'reports.export',
  'audit.read',
  'settings.read',
  'settings.update',
];

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ALL_PERMISSIONS,
  manager: [
    'dashboard.read',
    'branches.read',
    'orders.read',
    'orders.accept',
    'orders.reject',
    'orders.prepare',
    'orders.complete',
    'orders.cancel',
    'deliveries.read',
    'deliveries.assign',
    'deliveries.update',
    'riders.read',
    'riders.assign',
    'catalog.read',
    'catalog.manage_availability',
    'reports.read',
    'roles.read',
    'staff.read',
    'staff.create',
    'staff.update',
    'staff.disable',
    'staff.assign_roles',
  ],
  kitchen: ['orders.read', 'orders.accept', 'orders.reject', 'orders.prepare', 'orders.complete'],
  staff: ['orders.read', 'orders.accept', 'orders.prepare', 'deliveries.read'],
};

/** `grants` con los mismos permisos en el mismo alcance (global o lista de sucursales). */
export function grantsOf(permissions: string[], scope: 'global' | string[]): Grants {
  const entry: GrantScope =
    scope === 'global'
      ? { allBranches: true, branchIds: [] }
      : { allBranches: false, branchIds: [...scope] };
  return Object.fromEntries(
    permissions.map((p) => [p, { ...entry, branchIds: [...entry.branchIds] }]),
  );
}

/** Une varios grants (varias asignaciones): alcance global gana; las sucursales se unen. */
export function mergeGrants(...parts: Grants[]): Grants {
  const out: Grants = {};
  for (const grants of parts) {
    for (const [perm, s] of Object.entries(grants)) {
      const cur = out[perm] ?? { allBranches: false, branchIds: [] };
      out[perm] = {
        allBranches: cur.allBranches || s.allBranches,
        branchIds: [...new Set([...cur.branchIds, ...s.branchIds])],
      };
    }
  }
  return out;
}

export function staffContext(grants: Grants, over: Partial<StaffContext> = {}): StaffContext {
  const scopes = Object.values(grants);
  return {
    staffId: '99999999-9999-4999-8999-999999999999',
    fullName: 'Ana Admin',
    assignments: [],
    grants,
    branches: [],
    permissions: Object.keys(grants),
    allBranches: scopes.some((s) => s.allBranches),
    branchIds: [...new Set(scopes.flatMap((s) => s.branchIds))],
    ...over,
  };
}

/** Empleado con alcance global sobre los permisos dados. */
export const globalStaff = (permissions: string[], over: Partial<StaffContext> = {}) =>
  staffContext(grantsOf(permissions, 'global'), over);

/** Empleado con esos permisos solo en las sucursales dadas. */
export const scopedStaff = (
  permissions: string[],
  branchIds: string[],
  over: Partial<StaffContext> = {},
) => staffContext(grantsOf(permissions, branchIds), over);
