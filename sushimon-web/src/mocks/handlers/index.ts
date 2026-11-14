import type { MockRoutes } from '@/lib/data-access/mock-client';
import type { MockContext, MockStore } from '../store';
import * as account from './account';
import * as admin from './backoffice-admin';
import * as bo from './backoffice';
import * as branches from './branches';
import * as orders from './orders';
import * as pub from './public';

/**
 * Tabla de rutas del adaptador mock: las mismas de docs/contracts/planned-endpoints.md
 * (y de `lib/data-access/paths.ts`). Las de `/v1/demo/*` existen solo en el mock.
 */
export const mockRoutes: MockRoutes<MockStore, MockContext> = {
  // Públicas
  'GET /v1/store/config': pub.getStoreConfig,
  'GET /v1/branches': branches.listPublicBranches,
  'GET /v1/branches/:id': branches.getPublicBranch,
  'GET /v1/delivery/quote': pub.getDeliveryQuote,
  'GET /v1/catalog/categories': pub.listCategories,
  'GET /v1/catalog/products': pub.listProducts,
  'GET /v1/promotions': pub.listPromotions,
  'POST /v1/orders': orders.createOrder,
  'POST /v1/orders/lookup': orders.lookupOrder,
  'GET /v1/orders/:id': orders.getOrder,
  'POST /v1/payments/card': orders.payWithCard,
  'POST /v1/incidents': orders.createIncident,
  'POST /v1/job-applications': pub.createJobApplication,

  // Identidad
  'GET /v1/auth/context': account.getAuthContext,

  // Cliente
  'GET /v1/me': account.getMe,
  'PATCH /v1/me': account.updateMe,
  'GET /v1/me/addresses': account.listAddresses,
  'POST /v1/me/addresses': account.createAddress,
  'PATCH /v1/me/addresses/:id': account.updateAddress,
  'DELETE /v1/me/addresses/:id': account.deleteAddress,
  'GET /v1/me/favorites': account.listFavorites,
  'PUT /v1/me/favorites/:productId': account.addFavorite,
  'DELETE /v1/me/favorites/:productId': account.removeFavorite,
  'GET /v1/me/orders': account.listMyOrders,

  // Backoffice
  'GET /v1/backoffice/me': bo.getStaffMe,
  'GET /v1/backoffice/dashboard': bo.getDashboard,
  'GET /v1/backoffice/orders': bo.listBackofficeOrders,
  'PATCH /v1/backoffice/orders/:id/status': bo.changeOrderStatus,
  'POST /v1/backoffice/orders/:id/dispatch': bo.dispatch,
  'POST /v1/backoffice/deliveries/quote': bo.quoteCourier,
  'PATCH /v1/backoffice/deliveries/:orderId/advance': bo.advance,
  'GET /v1/backoffice/deliveries': bo.listDeliveries,
  'GET /v1/backoffice/riders': bo.listRiders,
  'GET /v1/backoffice/products': admin.listBoProducts,
  'POST /v1/backoffice/products': admin.createProduct,
  'PATCH /v1/backoffice/products/:id': admin.updateProduct,
  'GET /v1/backoffice/categories': admin.listBoCategories,
  'POST /v1/backoffice/categories': admin.createCategory,
  'PATCH /v1/backoffice/categories/:id': admin.updateCategory,
  'GET /v1/backoffice/promotions': admin.listBoPromotions,
  'POST /v1/backoffice/promotions': admin.createPromotion,
  'PATCH /v1/backoffice/promotions/:id': admin.updatePromotion,
  // F07: administración de sucursales (contrato)
  'GET /v1/admin/branches': branches.listAdminBranches,
  'POST /v1/admin/branches': branches.createAdminBranch,
  'GET /v1/admin/branches/:id': branches.getAdminBranch,
  'PATCH /v1/admin/branches/:id': branches.updateAdminBranch,
  'PATCH /v1/admin/branches/:id/status': branches.updateAdminBranchStatus,
  'GET /v1/backoffice/users': admin.listUsers,
  'POST /v1/backoffice/users': admin.createUser,
  'PATCH /v1/backoffice/users/:id': admin.updateUser,
  'GET /v1/backoffice/reports/summary': admin.getReportSummary,
  'GET /v1/backoffice/reports/history': admin.getReportHistory,

  // 🎭 Solo simulación
  'GET /v1/demo/branches/operations': branches.listBranchOperations,
  'PATCH /v1/demo/branches/:id/operations': branches.updateBranchOperations,
  'POST /v1/demo/orders/:id/advance': orders.demoAdvanceOrder,
  'POST /v1/demo/orders/simulate': orders.demoSimulateOrder,
};
