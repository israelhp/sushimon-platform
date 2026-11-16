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
  /** F10 (contrato): árbol de categorías visibles del menú (público, sin autenticación). */
  storeCategories: () => '/v1/store/categories',
  /** F11 (contrato): productos visibles del menú (paginado, `q`, `categorySlug`) y ficha por slug. Sin autenticación. */
  storeProducts: () => '/v1/store/products',
  storeProduct: (slug: string) => `/v1/store/products/${seg(slug)}`,
  /** F13: overlay público de precio efectivo y disponibilidad de UNA sucursal (`?branchId=`). */
  storeMenu: () => '/v1/store/menu',
  /** LEGACY (mock previo a F10): categorías planas del catálogo simulado (Happy Hour y reportes). */
  categories: () => '/v1/catalog/categories',
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
  /** F10 (contrato): categorías y jerarquía del menú (`catalog.read|create|update` + aal2; escrituras con alcance global). */
  adminCategories: () => '/v1/admin/categories',
  adminCategory: (id: string) => `/v1/admin/categories/${seg(id)}`,
  adminCategoriesReorder: () => '/v1/admin/categories/reorder',
  /** F11 (contrato): productos del backoffice (`catalog.read|create|update` + aal2; escrituras con alcance global). */
  adminProducts: () => '/v1/admin/products',
  /** F13: matriz por sucursal, matriz por producto y escrituras de precio/disponibilidad. */
  adminBranchProducts: (branchId: string) => `/v1/admin/branches/${seg(branchId)}/products`,
  adminBranchProductPricing: (branchId: string, productId: string) =>
    `/v1/admin/branches/${seg(branchId)}/products/${seg(productId)}/pricing`,
  adminProductBranches: (productId: string) => `/v1/admin/products/${seg(productId)}/branches`,
  adminProductAvailability: (productId: string) =>
    `/v1/admin/products/${seg(productId)}/availability`,
  adminProduct: (id: string) => `/v1/admin/products/${seg(id)}`,
  /**
   * F12 (contrato): grupos y opciones de modificadores y su asociación a productos (`catalog.read|create|update` + aal2;
   * escrituras con alcance global). Sin borrado físico.
   */
  adminModifierGroups: () => '/v1/admin/modifier-groups',
  adminModifierGroup: (id: string) => `/v1/admin/modifier-groups/${seg(id)}`,
  adminModifierGroupOptions: (id: string) => `/v1/admin/modifier-groups/${seg(id)}/modifiers`,
  adminModifierGroupReorder: (id: string) =>
    `/v1/admin/modifier-groups/${seg(id)}/modifiers/reorder`,
  adminModifier: (id: string) => `/v1/admin/modifiers/${seg(id)}`,
  adminProductModifiers: (productId: string) => `/v1/admin/products/${seg(productId)}/modifiers`,
  adminProductModifierGroups: (productId: string) =>
    `/v1/admin/products/${seg(productId)}/modifier-groups`,
  /** F03 (contrato): empleados, asignaciones, roles y permisos granulares (JWT + `staff.*`/`roles.*` + aal2). */
  adminContext: () => '/v1/admin/me/context',
  adminStaff: () => '/v1/admin/staff',
  adminStaffMember: (id: string) => `/v1/admin/staff/${seg(id)}`,
  adminStaffStatus: (id: string) => `/v1/admin/staff/${seg(id)}/status`,
  adminStaffAssignments: (id: string) => `/v1/admin/staff/${seg(id)}/assignments`,
  /** F02: restablece el segundo factor (MFA) de un empleado vinculado. Solo administrador global. 204 sin cuerpo. */
  adminStaffMfaReset: (id: string) => `/v1/admin/staff/${seg(id)}/mfa-reset`,
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
  /** F15/otros SIMULADOS: ilustración, destacado y textos en inglés de cada producto (F11 no los provee). */
  demoProductExtras: () => '/v1/demo/catalog/product-extras',
  /** Escenario SIMULADO de PedidosYa para la cobertura (solo mock; nunca existe en la API real). */
  demoPedidosyaCoverage: () => '/v1/demo/delivery/pedidosya-coverage',
  demoAdvanceOrder: (id: string) => `/v1/demo/orders/${seg(id)}/advance`,
  demoSimulateOrder: () => '/v1/demo/orders/simulate',
} as const;
