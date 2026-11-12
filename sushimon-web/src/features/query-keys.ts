import type { DeliveryQuoteArgs, ProductFilters } from '@/services/store';
import type { BackofficeOrderFilters, DeliveryFilters } from '@/services/backoffice-orders';
import type { ReportFilters } from '@/services/backoffice-admin';

/**
 * Claves de TanStack Query centralizadas. Jerárquicas para invalidar por prefijo
 * (p. ej., `queryKeys.orders.all` invalida detalle, lista del cliente y backoffice).
 */
export const queryKeys = {
  store: {
    config: ['store', 'config'] as const,
    /** Solo la hora del servidor (reloj de la demo del backoffice): no comparte caché con `config`. */
    serverTime: ['store', 'server-time'] as const,
    branches: ['store', 'branches'] as const,
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
    branches: ['backoffice', 'branches'] as const,
    users: ['backoffice', 'users'] as const,
    reportSummary: (filters: ReportFilters = {}) =>
      ['orders', 'reports', 'summary', filters] as const,
    reportHistory: (filters: ReportFilters = {}) =>
      ['orders', 'reports', 'history', filters] as const,
  },
} as const;
