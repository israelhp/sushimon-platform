import type { StaffRole } from '@/lib/data-access/models';

/**
 * Catálogo granular de permisos (43, `modulo.accion`) y roles del sistema, equivalentes a los que la migración 0005
 * (spec 006, ADR-0010) siembra en la base real. SOLO mock: en http los devuelven `/v1/admin/permissions` y
 * `/v1/admin/roles`. Los permisos de módulos aún inexistentes (pagos, incidencias, auditoría, ajustes) existen para que
 * los roles los referencien; no habilitan nada todavía.
 */
export interface PermissionSeed {
  code: string;
  description: string;
}

export const PERMISSION_CATALOG: readonly PermissionSeed[] = [
  { code: 'dashboard.read', description: 'Ver el panel general' },
  { code: 'branches.read', description: 'Ver sucursales' },
  { code: 'branches.create', description: 'Crear sucursales' },
  { code: 'branches.update', description: 'Editar sucursales y activarlas o desactivarlas' },
  { code: 'branches.manage_hours', description: 'Gestionar horarios de sucursales' },
  { code: 'branches.manage_delivery_zones', description: 'Gestionar zonas de entrega' },
  { code: 'staff.read', description: 'Ver empleados' },
  { code: 'staff.create', description: 'Preautorizar empleados' },
  { code: 'staff.update', description: 'Editar nombre y correo de empleados' },
  { code: 'staff.disable', description: 'Activar y desactivar empleados' },
  { code: 'staff.assign_roles', description: 'Asignar roles y sucursales a empleados' },
  { code: 'roles.read', description: 'Ver roles y permisos' },
  { code: 'roles.manage', description: 'Editar los permisos de un rol' },
  { code: 'catalog.read', description: 'Ver el catálogo' },
  { code: 'catalog.create', description: 'Crear productos y categorías' },
  { code: 'catalog.update', description: 'Editar productos y categorías' },
  { code: 'catalog.manage_availability', description: 'Cambiar la disponibilidad de productos' },
  { code: 'promotions.read', description: 'Ver promociones' },
  { code: 'promotions.create', description: 'Crear promociones' },
  { code: 'promotions.update', description: 'Editar y activar promociones' },
  { code: 'orders.read', description: 'Ver pedidos' },
  { code: 'orders.accept', description: 'Aceptar pedidos' },
  { code: 'orders.reject', description: 'Rechazar pedidos' },
  { code: 'orders.prepare', description: 'Pasar pedidos a preparación' },
  { code: 'orders.complete', description: 'Marcar pedidos como listos o entregados' },
  { code: 'orders.cancel', description: 'Cancelar pedidos' },
  { code: 'payments.read', description: 'Ver pagos' },
  { code: 'payments.confirm', description: 'Confirmar pagos' },
  { code: 'payments.refund', description: 'Reembolsar pagos' },
  { code: 'riders.read', description: 'Ver repartidores' },
  { code: 'riders.create', description: 'Crear repartidores' },
  { code: 'riders.update', description: 'Editar repartidores' },
  { code: 'riders.assign', description: 'Asignar repartidores' },
  { code: 'deliveries.read', description: 'Ver entregas' },
  {
    code: 'deliveries.assign',
    description: 'Despachar pedidos (PedidosYa simulado o repartidor propio)',
  },
  { code: 'deliveries.update', description: 'Actualizar el estado de las entregas' },
  { code: 'incidents.read', description: 'Ver incidencias' },
  { code: 'incidents.manage', description: 'Gestionar incidencias' },
  { code: 'reports.read', description: 'Ver reportes' },
  { code: 'reports.export', description: 'Exportar reportes' },
  { code: 'audit.read', description: 'Consultar la auditoría' },
  { code: 'settings.read', description: 'Ver ajustes' },
  { code: 'settings.update', description: 'Editar ajustes' },
];

export interface RoleSeed {
  id: string;
  code: StaffRole;
  name: string;
  /** Rol del sistema: sus permisos no se editan (409). */
  isSystem: boolean;
  permissions: string[];
}

const ALL = PERMISSION_CATALOG.map((p) => p.code);

export const ROLE_SEEDS: readonly RoleSeed[] = [
  { id: 'role-admin', code: 'admin', name: 'Administrador', isSystem: true, permissions: ALL },
  {
    id: 'role-manager',
    code: 'manager',
    name: 'Encargado',
    isSystem: false,
    permissions: [
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
  },
  {
    id: 'role-kitchen',
    code: 'kitchen',
    name: 'Cocina',
    isSystem: false,
    permissions: [
      'orders.read',
      'orders.accept',
      'orders.reject',
      'orders.prepare',
      'orders.complete',
    ],
  },
  {
    id: 'role-staff',
    code: 'staff',
    name: 'Empleado',
    isSystem: false,
    permissions: ['orders.read', 'orders.accept', 'orders.prepare', 'deliveries.read'],
  },
];

export const roleSeedByCode = (code: StaffRole) => {
  const role = ROLE_SEEDS.find((r) => r.code === code);
  if (!role) throw new Error(`Rol desconocido: ${code}`);
  return role;
};
