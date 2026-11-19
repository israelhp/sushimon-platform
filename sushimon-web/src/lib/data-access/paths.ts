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
  /** F19 (contrato): cotización de checkout (POST sin efectos, auth opcional, `private, no-store`). Nunca `public`. */
  checkoutQuote: () => '/v1/checkout/quote',
  /** F10 (contrato): árbol de categorías visibles del menú (público, sin autenticación). */
  storeCategories: () => '/v1/store/categories',
  /** F11 (contrato): productos visibles del menú (paginado, `q`, `categorySlug`) y ficha por slug. Sin autenticación. */
  storeProducts: () => '/v1/store/products',
  storeProduct: (slug: string) => `/v1/store/products/${seg(slug)}`,
  /** F13: overlay público de precio efectivo y disponibilidad de UNA sucursal (`?branchId=`). */
  storeMenu: () => '/v1/store/menu',
  /** F17 (contrato): agregado de arranque del Inicio por sucursal e idioma (`?branchId&locale`). Público, caché ≤ 15 s. */
  storeBootstrap: () => '/v1/store/bootstrap',
  /** F17 (contrato): búsqueda pública (`?q&branchId&categorySlug&available&page&pageSize`). Público, caché ≤ 15 s. */
  storeSearch: () => '/v1/store/search',
  /** LEGACY (mock previo a F10): categorías planas del catálogo simulado (Happy Hour y reportes). */
  categories: () => '/v1/catalog/categories',
  /** F15 (contrato): promociones y Happy Hour vigentes o próximas de UNA sucursal (`?branchId=&state=live|upcoming`). Público, informativo. */
  storePromotions: () => '/v1/store/promotions',
  /** F16 (contrato): banners publicados del Inicio (`?branchId&locale=es|en`). Público, solo lectura, caché ≤ 30 s. */
  storeBanners: () => '/v1/store/banners',
  orders: () => '/v1/orders',
  order: (id: string) => `/v1/orders/${seg(id)}`,
  /** F21: seguimiento ligero del pedido (`getOrderTracking`), apto para polling. */
  orderTracking: (id: string) => `/v1/orders/${seg(id)}/tracking`,
  /** F23: recibo NO fiscal del pedido (`getOrderReceipt`). Misma autorización que `getOrder`. */
  orderReceipt: (id: string) => `/v1/orders/${seg(id)}/receipt`,
  /** F23: vista previa de solo lectura de «Volver a pedir» (`previewOrderReorder`, POST sin efectos). */
  orderReorderPreview: (id: string) => `/v1/orders/${seg(id)}/reorder-preview`,
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
  /** F23 (contrato): historial paginado por cursor del cliente (`listMyOrders`, `MyOrderPage`). */
  myOrders: () => '/v1/me/orders',
  /** 🎭 Solo mock: pedidos BORRADOR (`DraftOrder`) del cliente de demostración que aún usan Inicio, consulta e incidencias. Se retira con ellos. */
  demoMyDraftOrders: () => '/v1/demo/me/orders',

  // Backoffice
  staffMe: () => '/v1/backoffice/me',
  dashboard: () => '/v1/backoffice/dashboard',
  /** F22 (contrato `admin-orders`): listado, tablero, detalle y los seis comandos de transición de pedidos. */
  adminOrders: () => '/v1/admin/orders',
  adminOrderBoard: () => '/v1/admin/orders/board',
  adminOrder: (id: string) => `/v1/admin/orders/${seg(id)}`,
  adminOrderAccept: (id: string) => `/v1/admin/orders/${seg(id)}/accept`,
  adminOrderReject: (id: string) => `/v1/admin/orders/${seg(id)}/reject`,
  adminOrderStartPreparing: (id: string) => `/v1/admin/orders/${seg(id)}/start-preparing`,
  adminOrderMarkReady: (id: string) => `/v1/admin/orders/${seg(id)}/mark-ready`,
  adminOrderComplete: (id: string) => `/v1/admin/orders/${seg(id)}/complete`,
  adminOrderCancel: (id: string) => `/v1/admin/orders/${seg(id)}/cancel`,
  boOrders: () => '/v1/backoffice/orders',
  boOrderStatus: (id: string) => `/v1/backoffice/orders/${seg(id)}/status`,
  boOrderDispatch: (id: string) => `/v1/backoffice/orders/${seg(id)}/dispatch`,
  courierQuote: () => '/v1/backoffice/deliveries/quote',
  deliveryAdvance: (orderId: string) => `/v1/backoffice/deliveries/${seg(orderId)}/advance`,
  deliveries: () => '/v1/backoffice/deliveries',
  riders: () => '/v1/backoffice/riders',
  boCategories: () => '/v1/backoffice/categories',
  boCategory: (id: string) => `/v1/backoffice/categories/${seg(id)}`,
  /** F15 (contrato): promociones y cupones (`promotions.read|create|update` + aal2; escritura exige cubrir todas sus sucursales). Sin borrado. */
  adminPromotions: () => '/v1/admin/promotions',
  adminPromotion: (id: string) => `/v1/admin/promotions/${seg(id)}`,
  adminPromotionStatus: (id: string) => `/v1/admin/promotions/${seg(id)}/status`,
  /** F16 (contrato): banners (`banners.read|create|update` + aal2; `ALL` y el reordenado exigen alcance global). Sin borrado. */
  adminBanners: () => '/v1/admin/banners',
  adminBannersOrder: () => '/v1/admin/banners/order',
  adminBanner: (id: string) => `/v1/admin/banners/${seg(id)}`,
  adminBannerStatus: (id: string) => `/v1/admin/banners/${seg(id)}/status`,
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
  /** F14 (contrato): biblioteca de medios y subida firmada (`catalog.read|update` + aal2; escrituras con alcance global). */
  adminMediaUploadIntents: () => '/v1/admin/media/upload-intents',
  adminMediaComplete: () => '/v1/admin/media/complete',
  adminMediaList: () => '/v1/admin/media',
  adminMedia: (id: string) => `/v1/admin/media/${seg(id)}`,
  adminProductMediaList: (productId: string) => `/v1/admin/products/${seg(productId)}/media`,
  adminProductMediaOrder: (productId: string) => `/v1/admin/products/${seg(productId)}/media/order`,
  adminProductMediaItem: (productId: string, mediaId: string) =>
    `/v1/admin/products/${seg(productId)}/media/${seg(mediaId)}`,
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
  /** SOLO mock: el «almacén» simulado recibe el objeto del PUT (en http el PUT va directo a la `uploadUrl` firmada). */
  demoMediaObject: (assetId: string) => `/v1/demo/media/objects/${seg(assetId)}`,
  /** Escenario SIMULADO de PedidosYa para la cobertura (solo mock; nunca existe en la API real). */
  demoPedidosyaCoverage: () => '/v1/demo/delivery/pedidosya-coverage',
  /** Solo mock: crea el pedido BORRADOR (`DraftOrder`) que aún usan el seguimiento y el backoffice simulados (retirar con F21/F22). */
  demoDraftOrders: () => '/v1/demo/orders',
  /** Solo mock: marca un pedido borrador para la tarjeta NeoNet SIMULADA (la API real rechaza `card`: F25 BLOCKED_EXTERNAL). */
  demoPrepareCardOrder: (id: string) => `/v1/demo/orders/${seg(id)}/card`,
  demoAdvanceOrder: (id: string) => `/v1/demo/orders/${seg(id)}/advance`,
  demoSimulateOrder: () => '/v1/demo/orders/simulate',
} as const;
