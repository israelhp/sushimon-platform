import type { DeliveryQuoteArgs, ProductFilters } from '@/services/store';
import type { BackofficeOrderFilters, DeliveryFilters } from '@/services/backoffice-orders';
import type { ReportFilters } from '@/services/backoffice-admin';
import type { AdminBranchFilters } from '@/services/branches';

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
    /** Prefijo de las cotizaciones de envío (cambian si cambia el conjunto de sucursales activas). */
    deliveryQuotes: ['store', 'delivery-quote'] as const,
    deliveryQuote: (args: DeliveryQuoteArgs) => ['store', 'delivery-quote', args] as const,
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
    users: ['backoffice', 'users'] as const,
    reportSummary: (filters: ReportFilters = {}) =>
      ['orders', 'reports', 'summary', filters] as const,
    reportHistory: (filters: ReportFilters = {}) =>
      ['orders', 'reports', 'history', filters] as const,
  },
} as const;
