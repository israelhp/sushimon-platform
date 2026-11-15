import type { ProductFilters } from '@/services/store';
import type { DeliveryZoneFilters } from '@/services/delivery-zones';
import type { BackofficeOrderFilters, DeliveryFilters } from '@/services/backoffice-orders';
import type { ReportFilters } from '@/services/backoffice-admin';
import type { AdminBranchFilters } from '@/services/branches';
import type { ClosureFilters } from '@/services/branch-schedule';
import type { AdminStaffFilters } from '@/services/staff';

/**
 * Claves de TanStack Query centralizadas. Jerárquicas para invalidar por prefijo
 * (p. ej., `queryKeys.orders.all` invalida detalle, lista del cliente y backoffice).
 */
export const queryKeys = {
  store: {
    config: ['store', 'config'] as const,
    /** Solo la hora del servidor (reloj de la demo del backoffice): no comparte caché con `config`. */
    serverTime: ['store', 'server-time'] as const,
    /** Prefijo de TODAS las consultas de sucursales de la tienda (públicas y operación simulada). */
    branches: ['store', 'branches'] as const,
    /** F07: listado público (solo activas). Su prefijo también cubre el detalle público. */
    publicBranches: ['store', 'branches', 'public'] as const,
    publicBranch: (id: string) => ['store', 'branches', 'public', id] as const,
    /** Operación SIMULADA (horario, abierta ahora, cobertura: F08/F09). */
    branchOperations: ['store', 'branches', 'operations'] as const,
  },
  /**
   * F08 (spec 007 D16): horario y disponibilidad PÚBLICOS por sucursal, jerárquicos: `branches.byId(id)` invalida los dos.
   * La disponibilidad se refresca en `nextTransitionAt` (no por polling).
   */
  branches: {
    all: ['branches'] as const,
    byId: (id: string) => ['branches', id] as const,
    hours: (id: string) => ['branches', id, 'hours'] as const,
    availability: (id: string) => ['branches', id, 'availability'] as const,
  },
  /**
   * F09 (spec 008): catálogos geográficos PÚBLICOS (casi inmutables: `staleTime` ≥ 1 h). Nunca se invalidan por una mutación.
   */
  locations: {
    all: ['locations'] as const,
    departments: () => ['locations', 'departments'] as const,
    municipalities: (departmentId: string) =>
      ['locations', 'municipalities', departmentId] as const,
  },
  /** F09: zonas propias (admin). `adminLists` es el prefijo de TODAS las listas filtradas. */
  deliveryZones: {
    all: ['deliveryZones'] as const,
    adminLists: ['deliveryZones', 'admin'] as const,
    admin: (filters: DeliveryZoneFilters = {}) => ['deliveryZones', 'admin', filters] as const,
    detail: (id: string) => ['deliveryZones', 'detail', id] as const,
  },
  /** F09: configuración de entrega por sucursal (admin). */
  deliverySettings: {
    all: ['deliverySettings'] as const,
    branch: (branchId: string) => ['deliverySettings', 'branch', branchId] as const,
  },
  /**
   * F09: cobertura pública por proveedor. Jerárquica por SUCURSAL (`branch(id)` invalida todas las comprobaciones de esa
   * sucursal tras cambiar zonas o configuración). `zone` es la etiqueta enviada (`Zona 10`) o '' sin zona.
   */
  deliveryCoverage: {
    all: ['deliveryCoverage'] as const,
    branch: (branchId: string) => ['deliveryCoverage', branchId] as const,
    check: (branchId: string, municipalityId: string, zone: string | null) =>
      ['deliveryCoverage', branchId, municipalityId, zone ?? ''] as const,
  },
  catalog: {
    all: ['catalog'] as const,
    categories: ['catalog', 'categories'] as const,
    products: (filters: ProductFilters = {}) => ['catalog', 'products', filters] as const,
    promotions: ['catalog', 'promotions'] as const,
  },
  orders: {
    all: ['orders'] as const,
    detail: (id: string) => ['orders', 'detail', id] as const,
    mine: ['orders', 'mine'] as const,
  },
  account: {
    all: ['account'] as const,
    me: ['account', 'me'] as const,
    addresses: ['account', 'addresses'] as const,
    favorites: ['account', 'favorites'] as const,
  },
  backoffice: {
    all: ['backoffice'] as const,
    me: ['backoffice', 'me'] as const,
    dashboard: (branchId?: string) => ['backoffice', 'dashboard', branchId ?? 'all'] as const,
    orders: (filters: BackofficeOrderFilters = {}) => ['orders', 'backoffice', filters] as const,
    deliveries: (filters: DeliveryFilters = {}) => ['orders', 'deliveries', filters] as const,
    riders: (branchId?: string) => ['backoffice', 'riders', branchId ?? 'all'] as const,
    products: ['catalog', 'backoffice', 'products'] as const,
    categories: ['catalog', 'backoffice', 'categories'] as const,
    promotions: ['catalog', 'backoffice', 'promotions'] as const,
    /** Prefijo de las consultas administrativas de sucursales (F07). */
    branches: ['backoffice', 'branches'] as const,
    adminBranchLists: ['backoffice', 'branches', 'list'] as const,
    adminBranches: (filters: AdminBranchFilters = {}) =>
      ['backoffice', 'branches', 'list', filters] as const,
    adminBranch: (id: string) => ['backoffice', 'branches', 'detail', id] as const,
    /** F08: horario y cierres ADMIN de una sucursal (`byBranch` es el prefijo de ambos). */
    branchSchedule: (id: string) => ['backoffice', 'branches', 'schedule', id] as const,
    branchHours: (id: string) => ['backoffice', 'branches', 'schedule', id, 'hours'] as const,
    branchClosures: (id: string, filters: ClosureFilters = {}) =>
      ['backoffice', 'branches', 'schedule', id, 'closures', filters] as const,
    /** F03: contexto administrativo del propio empleado (`grants`, `branches`). */
    adminContext: ['backoffice', 'admin-context'] as const,
    /** F03: prefijo de empleados (listas y detalle). */
    staff: ['backoffice', 'staff'] as const,
    staffLists: ['backoffice', 'staff', 'list'] as const,
    staffList: (filters: AdminStaffFilters = {}) =>
      ['backoffice', 'staff', 'list', filters] as const,
    staffDetail: (id: string) => ['backoffice', 'staff', 'detail', id] as const,
    /** F03: prefijo de roles (listas y detalle). */
    roles: ['backoffice', 'roles'] as const,
    roleLists: ['backoffice', 'roles', 'list'] as const,
    roleDetail: (id: string) => ['backoffice', 'roles', 'detail', id] as const,
    permissions: ['backoffice', 'permissions'] as const,
    reportSummary: (filters: ReportFilters = {}) =>
      ['orders', 'reports', 'summary', filters] as const,
    reportHistory: (filters: ReportFilters = {}) =>
      ['orders', 'reports', 'history', filters] as const,
  },
} as const;
