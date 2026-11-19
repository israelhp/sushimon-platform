import type { StoreMenuParams } from '@/lib/store-rules';
import type { AdminProductFilters } from '@/services/products';
import type { DeliveryZoneFilters } from '@/services/delivery-zones';
import type { AdminOrderListFilters } from '@/services/admin-orders';
import type { BackofficeOrderFilters, DeliveryFilters } from '@/services/backoffice-orders';
import type { ReportFilters } from '@/services/backoffice-admin';
import type { AdminBranchFilters } from '@/services/branches';
import type { ClosureFilters } from '@/services/branch-schedule';
import type { AdminStaffFilters } from '@/services/staff';
import type { CategoryFilters } from '@/services/categories';
import type { ModifierGroupFilters } from '@/services/modifiers';
import type { BranchProductFilters } from '@/services/branch-products';
import type { MediaFilters } from '@/services/media';
import type { AdminBannerFilters } from '@/services/banners';
import type { AdminPromotionFilters } from '@/services/promotions';

/**
 * Claves de TanStack Query centralizadas. Jerárquicas para invalidar por prefijo
 * (p. ej., `queryKeys.orders.all` invalida detalle y backoffice; los pedidos del cliente viven bajo `customer`).
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
    /**
     * F17 (spec 018 D6d): agregados PÚBLICOS. La clave lleva sucursal (`'none'` = sin sucursal), idioma/filtros/página: cambiar de
     * sucursal o de idioma cambia la clave (nunca se mezclan precios). Los prefijos `bootstrapAll`/`menuAll`/`searchAll` los
     * invalida el backoffice tras cada mutación (`invalidateStoreAggregates`). SIN HydrationBoundary: la sucursal vive en localStorage.
     */
    bootstrapAll: ['store', 'bootstrap'] as const,
    bootstrap: (branchId: string | null, locale: string) =>
      ['store', 'bootstrap', branchId ?? 'none', locale] as const,
    menuAll: ['store', 'menu'] as const,
    /** Menú COMPLETO (todas las páginas) o una página: `filters.page` = número o `'all'`. */
    menu: (
      branchId: string | null,
      filters: Omit<StoreMenuParams, 'branchId' | 'page'> & { page?: number | 'all' },
    ) => ['store', 'menu', branchId ?? 'none', filters] as const,
    searchAll: ['store', 'search'] as const,
    search: (
      branchId: string | null,
      q: string,
      filters: { categorySlug?: string; available?: boolean },
    ) => ['store', 'search', branchId ?? 'none', q, filters] as const,
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
  /**
   * F10 (spec 011): categorías del menú. `store` = árbol PÚBLICO (solo visibles); `admin` = lista plana del backoffice.
   * Toda mutación invalida `all` (el árbol público y el admin dependen de la misma jerarquía).
   */
  categories: {
    all: ['categories'] as const,
    store: ['categories', 'store'] as const,
    adminLists: ['categories', 'admin'] as const,
    admin: (filters: CategoryFilters = {}) => ['categories', 'admin', filters] as const,
  },
  /**
   * F11 (spec 012): productos del contrato. `store` = lecturas PÚBLICAS (búsqueda con `q`, ficha por slug); `admin` = lista
   * paginada del backoffice. Toda mutación invalida `all` y el catálogo unido (`catalog.all`).
   */
  products: {
    all: ['products'] as const,
    /** Prefijo de TODAS las fichas públicas (F12: los `modifierGroups` viajan en la ficha). */
    storeDetails: ['products', 'store', 'detail'] as const,
    storeDetail: (slug: string, branchId: string | null) =>
      ['products', 'store', 'detail', slug, branchId ?? 'none'] as const,
    adminLists: ['products', 'admin'] as const,
    admin: (filters: AdminProductFilters = {}) => ['products', 'admin', filters] as const,
    /** SIMULADO (solo mock): disponibilidad por sucursal, ilustración y textos en inglés de cada producto. */
    extras: ['products', 'extras'] as const,
  },
  /**
   * F12 (spec 013): modificadores. `groupLists` = prefijo de las listas filtradas; `group(id)` = detalle con opciones;
   * `product(id)` = grupos asociados a un producto. Toda mutación invalida `all` y las fichas públicas (`products.storeDetails`).
   */
  modifiers: {
    all: ['modifiers'] as const,
    groupLists: ['modifiers', 'groups'] as const,
    groups: (filters: ModifierGroupFilters = {}) => ['modifiers', 'groups', filters] as const,
    group: (id: string) => ['modifiers', 'group', id] as const,
    product: (productId: string) => ['modifiers', 'product', productId] as const,
  },
  /** F13: matrices ADMIN. `byBranch` = por sucursal (con filtros); `byProduct` = por producto. Toda mutación invalida `all`. */
  branchProducts: {
    all: ['branch-products'] as const,
    branchLists: (branchId: string) => ['branch-products', 'branch', branchId] as const,
    byBranch: (branchId: string, filters: BranchProductFilters = {}) =>
      ['branch-products', 'branch', branchId, filters] as const,
    byProduct: (productId: string) => ['branch-products', 'product', productId] as const,
  },
  /**
   * F14 (spec 015): biblioteca de medios (admin). `libraryLists` = prefijo de las páginas filtradas. Toda mutación de medios o
   * de imágenes de producto invalida `all`, `products.all` (admin + fichas públicas) y `catalog.all` (menú/lista pública).
   */
  media: {
    all: ['media'] as const,
    libraryLists: ['media', 'library'] as const,
    library: (filters: MediaFilters = {}) => ['media', 'library', filters] as const,
  },
  catalog: {
    all: ['catalog'] as const,
    categories: ['catalog', 'categories'] as const,
    /**
     * F15: promociones PÚBLICAS por sucursal y estado (`live|upcoming`). `promotions` es el prefijo de todas; la caché HTTP dura ≤ 30 s
     * y el servidor da `nextChangeAt`: refetch en ese instante y al cambiar de sucursal.
     */
    promotions: ['catalog', 'promotions'] as const,
    storePromotions: (branchId: string, state: 'live' | 'upcoming', compact = false) =>
      compact
        ? (['catalog', 'promotions', branchId, state, 'compact'] as const)
        : (['catalog', 'promotions', branchId, state] as const),
    /**
     * F16: prefijo de los banners PÚBLICOS. Desde F17 el Inicio los recibe dentro del bootstrap (`store.bootstrap`); el prefijo se
     * conserva para invalidar lo que pudiera existir tras una mutación de banners.
     */
    banners: ['catalog', 'banners'] as const,
  },
  orders: {
    all: ['orders'] as const,
    detail: (id: string) => ['orders', 'detail', id] as const,
    /** F20: pedido REAL (`OrderDetail`), aislado por cuenta o invitado. La credencial de invitado NUNCA entra en la clave. */
    placed: (scope: string | null, id: string) =>
      ['orders', 'placed', scope ?? 'guest', id] as const,
    /**
     * F21: seguimiento REAL (`OrderTracking`), aislado por cuenta o invitado y por pedido. NUNCA lleva la credencial de invitado
     * ni se persiste; `useCustomerCacheGuard` lo descarta al cambiar de cuenta.
     */
    tracking: (scope: string | null, id: string) =>
      ['orders', 'tracking', scope ?? 'guest', id] as const,
  },
  /**
   * F06 (spec 010 D15): datos del CLIENTE con la IDENTIDAD en la raíz (`scope` = id de Supabase Auth, o `demo:<correo>` en el
   * mock; nunca vacío: sin sesión las consultas no se habilitan). Otra cuenta jamás puede leer la caché ajena porque su
   * clave difiere; al cerrar sesión o cambiar de cuenta `useCustomerCacheGuard` descarta las claves del `scope` anterior.
   */
  customer: {
    all: ['customer'] as const,
    /** F04/F05: perfil y direcciones del cliente (`/v1/me`, `/v1/me/addresses`), aislados por identidad. */
    account: {
      all: (scope: string) => ['customer', scope, 'account'] as const,
      me: (scope: string) => ['customer', scope, 'account', 'me'] as const,
      addresses: (scope: string) => ['customer', scope, 'account', 'addresses'] as const,
    },
    /** Pedidos DEL CLIENTE (SIMULADOS hasta F20). Su invalidación va por `customerOrdersPredicate`. */
    orders: {
      mine: (scope: string) => ['customer', scope, 'orders', 'mine'] as const,
    },
    favorites: {
      all: (scope: string) => ['customer', scope, 'favorites'] as const,
      /** Ids completos (`pageSize=0`): el estado de TODOS los corazones y el contador. */
      ids: (scope: string) => ['customer', scope, 'favorites', 'ids'] as const,
      /** Prefijo de TODAS las páginas de Mis favoritos. */
      lists: (scope: string) => ['customer', scope, 'favorites', 'list'] as const,
      list: (scope: string, page: number) =>
        ['customer', scope, 'favorites', 'list', page] as const,
      /** Clave común de las mutaciones (alta/baja): permite saber cuántas hay en vuelo. */
      mutation: (scope: string) => ['customer', scope, 'favorites', 'mutate'] as const,
    },
  },
  /**
   * F19 (spec 020): cotización de checkout. PRIVADA: con sesión la clave cuelga de `customer` con la IDENTIDAD (`scope`), así
   * `useCustomerCacheGuard` la descarta al cerrar sesión o cambiar de cuenta y otra cuenta nunca lee la respuesta ajena. El invitado
   * usa su propia rama (`checkout/guest`): no empieza por `customer`, así el guard (que descarta lo «de otra identidad» al
   * montarse y al cambiar de cuenta) no borra una cotización de invitado en vuelo. `fingerprint` = huella canónica de las
   * ENTRADAS (`quoteFingerprint`); no incluye `clientView`.
   */
  checkout: {
    quote: (scope: string | null, fingerprint: string) =>
      scope
        ? (['customer', scope, 'checkout', 'quote', fingerprint] as const)
        : (['checkout', 'guest', 'quote', fingerprint] as const),
  },
  backoffice: {
    all: ['backoffice'] as const,
    me: ['backoffice', 'me'] as const,
    dashboard: (branchId?: string) => ['backoffice', 'dashboard', branchId ?? 'all'] as const,
    orders: (filters: BackofficeOrderFilters = {}) => ['orders', 'backoffice', filters] as const,
    /**
     * F22 (spec 023 §10.2): pedidos REALES del backoffice. La clave lleva SIEMPRE la persona (`staffKey` = id del personal) y la
     * sucursal/filtros; jamás se usa `keepPreviousData` entre claves distintas. Al cerrar sesión o cambiar de persona se descarta
     * todo `['backoffice','adminOrders']` (lo hace `DemoSessionProvider.resetCaches`). Sin persistencia del contenido.
     */
    adminOrders: {
      all: ['backoffice', 'adminOrders'] as const,
      board: (staffKey: string | null, branchId: string | null | undefined) =>
        ['backoffice', 'adminOrders', staffKey ?? 'anon', 'board', branchId ?? 'all'] as const,
      list: (staffKey: string | null, filters: AdminOrderListFilters) =>
        ['backoffice', 'adminOrders', staffKey ?? 'anon', 'list', filters] as const,
      detail: (staffKey: string | null, id: string) =>
        ['backoffice', 'adminOrders', staffKey ?? 'anon', 'detail', id] as const,
    },
    deliveries: (filters: DeliveryFilters = {}) => ['orders', 'deliveries', filters] as const,
    riders: (branchId?: string) => ['backoffice', 'riders', branchId ?? 'all'] as const,
    categories: ['catalog', 'backoffice', 'categories'] as const,
    /** F15: promociones ADMIN. `promotions` = prefijo de listas y detalle; toda mutación lo invalida (y `catalog.promotions`). */
    promotions: ['catalog', 'backoffice', 'promotions'] as const,
    promotionList: (filters: AdminPromotionFilters = {}) =>
      ['catalog', 'backoffice', 'promotions', 'list', filters] as const,
    promotion: (id: string) => ['catalog', 'backoffice', 'promotions', 'detail', id] as const,
    /** F16: banners ADMIN. `banners` = prefijo de listas, orden y detalle; toda mutación lo invalida (y `catalog.banners`). */
    banners: ['catalog', 'backoffice', 'banners'] as const,
    bannerList: (filters: AdminBannerFilters = {}) =>
      ['catalog', 'backoffice', 'banners', 'list', filters] as const,
    bannerOrder: ['catalog', 'backoffice', 'banners', 'order'] as const,
    banner: (id: string) => ['catalog', 'backoffice', 'banners', 'detail', id] as const,
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

/** Coincide con las consultas de pedidos del cliente de CUALQUIER identidad (`['customer', scope, 'orders', …]`). */
export const customerOrdersPredicate = (query: { queryKey: readonly unknown[] }): boolean =>
  query.queryKey[0] === queryKeys.customer.all[0] && query.queryKey[2] === 'orders';
