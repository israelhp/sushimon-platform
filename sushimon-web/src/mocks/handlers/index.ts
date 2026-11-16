import type { MockRoutes } from '@/lib/data-access/mock-client';
import type { MockContext, MockStore } from '../store';
import * as account from './account';
import * as admin from './backoffice-admin';
import * as bo from './backoffice';
import * as branches from './branches';
import * as branchProducts from './branch-products';
import * as categories from './categories';
import * as delivery from './delivery';
import * as favorites from './favorites';
import * as media from './media';
import * as modifiers from './modifiers';
import * as orders from './orders';
import * as products from './products';
import * as pub from './public';
import * as schedule from './schedule';
import * as staff from './staff';

/**
 * Tabla de rutas del adaptador mock: las mismas de docs/contracts/planned-endpoints.md
 * (y de `lib/data-access/paths.ts`). Las de `/v1/demo/*` existen solo en el mock.
 */
export const mockRoutes: MockRoutes<MockStore, MockContext> = {
  // Públicas
  'GET /v1/store/config': pub.getStoreConfig,
  'GET /v1/branches': branches.listPublicBranches,
  'GET /v1/branches/:id': branches.getPublicBranch,
  // F08: horario público y disponibilidad (calculada con el reloj del servidor)
  'GET /v1/branches/:id/hours': schedule.getPublicBranchHours,
  'GET /v1/branches/:id/availability': schedule.getPublicBranchAvailability,
  // F10: árbol público de categorías visibles (contrato)
  'GET /v1/store/categories': categories.listStoreCategories,
  'GET /v1/catalog/categories': pub.listCategories,
  // F11: productos visibles y ficha por slug (contrato)
  'GET /v1/store/products': products.listStoreProducts,
  'GET /v1/store/products/:slug': products.getStoreProduct,
  // F13: overlay público de precio efectivo y disponibilidad de una sucursal (contrato)
  'GET /v1/store/menu': branchProducts.getStoreBranchMenu,
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
  'GET /v1/me/storefront': account.getStorefront,
  'GET /v1/me/addresses/:id': account.getAddress,
  'GET /v1/me/addresses': account.listAddresses,
  'POST /v1/me/addresses': account.createAddress,
  'PATCH /v1/me/addresses/:id': account.updateAddress,
  'DELETE /v1/me/addresses/:id': account.deleteAddress,
  'PATCH /v1/me/addresses/:id/default': account.setMyDefaultAddress,
  'GET /v1/me/favorites': favorites.listMyFavorites,
  'PUT /v1/me/favorites/:productId': favorites.addMyFavorite,
  'DELETE /v1/me/favorites/:productId': favorites.removeMyFavorite,
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
  // F08: horario semanal y cierres extraordinarios (contrato)
  'GET /v1/admin/branches/:id/hours': schedule.getAdminBranchHours,
  'PUT /v1/admin/branches/:id/hours': schedule.replaceAdminBranchHours,
  'GET /v1/admin/branches/:id/closures': schedule.listAdminBranchClosures,
  'POST /v1/admin/branches/:id/closures': schedule.createAdminBranchClosure,
  'PATCH /v1/admin/branches/:id/closures/:closureId': schedule.updateAdminBranchClosure,
  'DELETE /v1/admin/branches/:id/closures/:closureId': schedule.deleteAdminBranchClosure,
  // F09: geografía, zonas propias, configuración de entrega y cobertura (contrato)
  'GET /v1/locations/departments': delivery.listDepartments,
  'GET /v1/locations/municipalities': delivery.listMunicipalities,
  'GET /v1/admin/delivery-zones': delivery.listAdminDeliveryZones,
  'POST /v1/admin/delivery-zones': delivery.createAdminDeliveryZone,
  'GET /v1/admin/delivery-zones/:id': delivery.getAdminDeliveryZone,
  'PATCH /v1/admin/delivery-zones/:id': delivery.updateAdminDeliveryZone,
  'PATCH /v1/admin/delivery-zones/:id/status': delivery.updateAdminDeliveryZoneStatus,
  'GET /v1/admin/branches/:id/delivery-settings': delivery.getAdminBranchDeliverySettings,
  'PATCH /v1/admin/branches/:id/delivery-settings': delivery.updateAdminBranchDeliverySettings,
  'POST /v1/delivery-coverage/check': delivery.checkDeliveryCoverage,
  // F10: categorías y jerarquía del menú (contrato)
  'GET /v1/admin/categories': categories.listAdminCategories,
  'POST /v1/admin/categories': categories.createAdminCategory,
  'PUT /v1/admin/categories/reorder': categories.reorderAdminCategories,
  'PATCH /v1/admin/categories/:id': categories.updateAdminCategory,
  // F11: productos y fichas (contrato)
  'GET /v1/admin/products': products.listAdminProducts,
  'POST /v1/admin/products': products.createAdminProduct,
  'GET /v1/admin/products/:id': products.getAdminProduct,
  'PATCH /v1/admin/products/:id': products.updateAdminProduct,
  // F14: medios (intent firmado, confirmación, biblioteca) y vínculo con productos (contrato)
  'POST /v1/admin/media/upload-intents': media.createUploadIntent,
  'POST /v1/admin/media/complete': media.completeUpload,
  'GET /v1/admin/media': media.listAdminMedia,
  'GET /v1/admin/media/:id': media.getAdminMedia,
  'DELETE /v1/admin/media/:id': media.deleteAdminMedia,
  'POST /v1/admin/products/:id/media': media.attachProductMedia,
  'PUT /v1/admin/products/:id/media/order': media.reorderProductMedia,
  'PATCH /v1/admin/products/:id/media/:mediaId': media.updateProductMedia,
  'DELETE /v1/admin/products/:id/media/:mediaId': media.detachProductMedia,
  // F13: matrices administrativas y escrituras de precio/disponibilidad por sucursal (contrato)
  'GET /v1/admin/branches/:id/products': branchProducts.listAdminBranchProducts,
  'GET /v1/admin/products/:id/branches': branchProducts.listAdminProductBranches,
  'PUT /v1/admin/branches/:id/products/:productId/pricing':
    branchProducts.setAdminBranchProductPricing,
  'PATCH /v1/admin/products/:id/availability': branchProducts.setAdminProductAvailability,
  // F12: grupos y opciones de modificadores y su asociación a productos (contrato)
  'GET /v1/admin/modifier-groups': modifiers.listAdminModifierGroups,
  'POST /v1/admin/modifier-groups': modifiers.createAdminModifierGroup,
  'GET /v1/admin/modifier-groups/:id': modifiers.getAdminModifierGroup,
  'PATCH /v1/admin/modifier-groups/:id': modifiers.updateAdminModifierGroup,
  'POST /v1/admin/modifier-groups/:id/modifiers': modifiers.createAdminModifier,
  'PUT /v1/admin/modifier-groups/:id/modifiers/reorder': modifiers.reorderAdminModifiers,
  'PATCH /v1/admin/modifiers/:id': modifiers.updateAdminModifier,
  'GET /v1/admin/products/:id/modifiers': modifiers.getAdminProductModifiers,
  'PUT /v1/admin/products/:id/modifier-groups': modifiers.replaceAdminProductModifierGroups,
  // F03: empleados, roles y permisos (contrato)
  'GET /v1/admin/me/context': staff.getAdminContext,
  'GET /v1/admin/staff': staff.listAdminStaff,
  'POST /v1/admin/staff': staff.createAdminStaff,
  'GET /v1/admin/staff/:id': staff.getAdminStaff,
  'PATCH /v1/admin/staff/:id': staff.updateAdminStaff,
  'PATCH /v1/admin/staff/:id/status': staff.updateAdminStaffStatus,
  'PUT /v1/admin/staff/:id/assignments': staff.replaceAdminStaffAssignments,
  'POST /v1/admin/staff/:id/mfa-reset': staff.resetAdminStaffMfa,
  'GET /v1/admin/roles': staff.listAdminRoles,
  'GET /v1/admin/roles/:id': staff.getAdminRole,
  'PUT /v1/admin/roles/:id/permissions': staff.replaceAdminRolePermissions,
  'GET /v1/admin/permissions': staff.listAdminPermissions,
  'GET /v1/backoffice/reports/summary': admin.getReportSummary,
  'GET /v1/backoffice/reports/history': admin.getReportHistory,

  // 🎭 Solo simulación
  'GET /v1/demo/branches/operations': branches.listBranchOperations,
  // F15/otros SIMULADOS: lo que F11 no provee de cada producto
  // F14 SIMULADO: el almacén recibe el objeto del PUT (en http el PUT va directo a R2)
  'PUT /v1/demo/media/objects/:assetId': media.putSimulatedObject,
  'GET /v1/demo/catalog/product-extras': products.listProductExtras,
  'GET /v1/demo/delivery/pedidosya-coverage': delivery.getPedidosyaCoverageScenario,
  'PUT /v1/demo/delivery/pedidosya-coverage': delivery.setPedidosyaCoverageScenario,
  'POST /v1/demo/orders/:id/advance': orders.demoAdvanceOrder,
  'POST /v1/demo/orders/simulate': orders.demoSimulateOrder,
};
