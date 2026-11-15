/**
 * Constructores de rutas de la API (`/v1`). Fuente: docs/contracts/planned-endpoints.md.
 * Los services usan solo estas funciones; el adaptador mock registra las mismas rutas.
 * Los segmentos variables se codifican con encodeURIComponent.
 */
const seg = (value: string) => encodeURIComponent(value);

export const paths = {
  // Públicas
  storeConfig: () => '/v1/store/config',
  /** F07 (contrato): sucursales activas, solo campos públicos. */
  branches: () => '/v1/branches',
  branch: (id: string) => `/v1/branches/${seg(id)}`,
  /** F08 (contrato): horario semanal público y disponibilidad (calculada por el servidor). */
  branchHours: (id: string) => `/v1/branches/${seg(id)}/hours`,
  branchAvailability: (id: string) => `/v1/branches/${seg(id)}/availability`,
  /** F09 (contrato): catálogos geográficos públicos y comprobación de cobertura por proveedor. */
  locationDepartments: () => '/v1/locations/departments',
  locationMunicipalities: () => '/v1/locations/municipalities',
  deliveryCoverageCheck: () => '/v1/delivery-coverage/check',
  categories: () => '/v1/catalog/categories',
  products: () => '/v1/catalog/products',
  promotions: () => '/v1/promotions',
  orders: () => '/v1/orders',
  order: (id: string) => `/v1/orders/${seg(id)}`,
  orderLookup: () => '/v1/orders/lookup',
  cardPayment: () => '/v1/payments/card',
  incidents: () => '/v1/incidents',
  jobApplications: () => '/v1/job-applications',

  // Cliente
  authContext: () => '/v1/auth/context',
  me: () => '/v1/me',
  /** F04 (contrato): contexto agregado de Mi cuenta. */
  myStorefront: () => '/v1/me/storefront',
  myAddresses: () => '/v1/me/addresses',
  myAddress: (id: string) => `/v1/me/addresses/${seg(id)}`,
  myAddressDefault: (id: string) => `/v1/me/addresses/${seg(id)}/default`,
  myFavorites: () => '/v1/me/favorites',
  myFavorite: (productId: string) => `/v1/me/favorites/${seg(productId)}`,
  myOrders: () => '/v1/me/orders',

  // Backoffice
  staffMe: () => '/v1/backoffice/me',
  dashboard: () => '/v1/backoffice/dashboard',
  boOrders: () => '/v1/backoffice/orders',
  boOrderStatus: (id: string) => `/v1/backoffice/orders/${seg(id)}/status`,
  boOrderDispatch: (id: string) => `/v1/backoffice/orders/${seg(id)}/dispatch`,
  courierQuote: () => '/v1/backoffice/deliveries/quote',
  deliveryAdvance: (orderId: string) => `/v1/backoffice/deliveries/${seg(orderId)}/advance`,
  deliveries: () => '/v1/backoffice/deliveries',
  riders: () => '/v1/backoffice/riders',
  boProducts: () => '/v1/backoffice/products',
  boProduct: (id: string) => `/v1/backoffice/products/${seg(id)}`,
  boCategories: () => '/v1/backoffice/categories',
  boCategory: (id: string) => `/v1/backoffice/categories/${seg(id)}`,
  boPromotions: () => '/v1/backoffice/promotions',
  boPromotion: (id: string) => `/v1/backoffice/promotions/${seg(id)}`,
  /** F07 (contrato): administración de sucursales (JWT + `branches.*` + aal2). */
  adminBranches: () => '/v1/admin/branches',
  adminBranch: (id: string) => `/v1/admin/branches/${seg(id)}`,
  adminBranchStatus: (id: string) => `/v1/admin/branches/${seg(id)}/status`,
  /** F08 (contrato): horario semanal y cierres extraordinarios (`branches.read` / `branches.manage_hours` + aal2). */
  adminBranchHours: (id: string) => `/v1/admin/branches/${seg(id)}/hours`,
  adminBranchClosures: (id: string) => `/v1/admin/branches/${seg(id)}/closures`,
  adminBranchClosure: (id: string, closureId: string) =>
    `/v1/admin/branches/${seg(id)}/closures/${seg(closureId)}`,
  /** F09 (contrato): zonas propias y configuración de entrega por sucursal (`branches.read` / `branches.manage_delivery_zones` + aal2). */
  adminDeliveryZones: () => '/v1/admin/delivery-zones',
  adminDeliveryZone: (id: string) => `/v1/admin/delivery-zones/${seg(id)}`,
  adminDeliveryZoneStatus: (id: string) => `/v1/admin/delivery-zones/${seg(id)}/status`,
  adminBranchDeliverySettings: (id: string) => `/v1/admin/branches/${seg(id)}/delivery-settings`,
  /** F03 (contrato): empleados, asignaciones, roles y permisos granulares (JWT + `staff.*`/`roles.*` + aal2). */
  adminContext: () => '/v1/admin/me/context',
  adminStaff: () => '/v1/admin/staff',
  adminStaffMember: (id: string) => `/v1/admin/staff/${seg(id)}`,
  adminStaffStatus: (id: string) => `/v1/admin/staff/${seg(id)}/status`,
  adminStaffAssignments: (id: string) => `/v1/admin/staff/${seg(id)}/assignments`,
  adminRoles: () => '/v1/admin/roles',
  adminRole: (id: string) => `/v1/admin/roles/${seg(id)}`,
  adminRolePermissions: (id: string) => `/v1/admin/roles/${seg(id)}/permissions`,
  adminPermissions: () => '/v1/admin/permissions',
  reportSummary: () => '/v1/backoffice/reports/summary',
  reportHistory: () => '/v1/backoffice/reports/history',

  /**
   * 🎭 Solo simulación: existen únicamente en el adaptador mock (nunca en la API real).
   * La UI solo las ofrece cuando `client.kind === 'mock'`.
   */
  /**
   * Operación SIMULADA de las sucursales (zona/área: F33), sin contrato todavía; la cobertura ya es contrato (F09). El horario y la
   * disponibilidad ya son contrato (F08: `branchHours`, `branchAvailability`). La identidad y el estado administrativo (F07) viven en `branches`/`adminBranches`.
   */
  demoBranchOperations: () => '/v1/demo/branches/operations',
  /** Escenario SIMULADO de PedidosYa para la cobertura (solo mock; nunca existe en la API real). */
  demoPedidosyaCoverage: () => '/v1/demo/delivery/pedidosya-coverage',
  demoAdvanceOrder: (id: string) => `/v1/demo/orders/${seg(id)}/advance`,
  demoSimulateOrder: () => '/v1/demo/orders/simulate',
} as const;
