/**
 * Constructores de rutas de la API (`/v1`). Fuente: docs/contracts/planned-endpoints.md.
 * Los services usan solo estas funciones; el adaptador mock registra las mismas rutas.
 * Los segmentos variables se codifican con encodeURIComponent.
 */
const seg = (value: string) => encodeURIComponent(value);

export const paths = {
  // Públicas
  storeConfig: () => '/v1/store/config',
  branches: () => '/v1/branches',
  deliveryQuote: () => '/v1/delivery/quote',
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
  myAddresses: () => '/v1/me/addresses',
  myAddress: (id: string) => `/v1/me/addresses/${seg(id)}`,
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
  boBranches: () => '/v1/backoffice/branches',
  boBranch: (id: string) => `/v1/backoffice/branches/${seg(id)}`,
  users: () => '/v1/backoffice/users',
  user: (id: string) => `/v1/backoffice/users/${seg(id)}`,
  reportSummary: () => '/v1/backoffice/reports/summary',
  reportHistory: () => '/v1/backoffice/reports/history',

  /**
   * 🎭 Solo simulación: existen únicamente en el adaptador mock (nunca en la API real).
   * La UI solo las ofrece cuando `client.kind === 'mock'`.
   */
  demoAdvanceOrder: (id: string) => `/v1/demo/orders/${seg(id)}/advance`,
  demoSimulateOrder: () => '/v1/demo/orders/simulate',
} as const;
