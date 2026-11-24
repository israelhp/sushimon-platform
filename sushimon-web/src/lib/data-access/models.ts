import type { components } from '@sushimon/contracts';

/**
 * Alias legibles de los esquemas del contrato (`components/schemas`, x-status: draft).
 * No se redefinen tipos a mano: si cambia el OpenAPI, se regeneran y cambian aquí.
 */
type S = components['schemas'];

export type LocalizedText = S['LocalizedText'];
export type StoreConfig = S['StoreConfig'];
/**
 * Borrador del contrato (`StoreConfig.weeklyHours`, día 0–6): NO se usa para decidir disponibilidad. El horario real
 * de una sucursal es `BranchHours`/`PublicBranchHours` (F08, ISO 1–7, varios intervalos). Pendiente de F17.
 */
export type DraftBranchHours = S['DraftBranchHours'];
/** F08: horario semanal administrativo con `version` (concurrencia optimista). */
export type BranchHours = S['BranchHours'];
export type BranchHoursDay = S['BranchHoursDay'];
export type BranchHoursInterval = S['BranchHoursInterval'];
export type PublicBranchHours = S['PublicBranchHours'];
export type PublicClosureWindow = S['PublicClosureWindow'];
export type ReplaceBranchHoursRequest = S['ReplaceBranchHoursRequest'];
export type BranchClosure = S['BranchClosure'];
export type BranchClosureList = S['BranchClosureList'];
export type CreateBranchClosureRequest = S['CreateBranchClosureRequest'];
export type UpdateBranchClosureRequest = S['UpdateBranchClosureRequest'];
export type ErrorViolation = S['ErrorViolation'];
/** F08: disponibilidad calculada por el SERVIDOR (la UI la consume, no la recalcula). */
export type BranchAvailability = S['BranchAvailability'];
export type BranchAvailabilityReason = S['BranchAvailabilityReason'];
/**
 * `Branch` es el modelo UI RICO de la tienda y el backoffice: mezcla campos de F07 (id, nombre, dirección, teléfono) con
 * campos SIMULADOS de F08/F09 (`isOpen`, `openNow`, `hours`, `coverage`, `radiusKm`, `status`…). Se obtiene de
 * `paths.demoBranchOperations` (solo mock). Para lo que F07 posee usa `PublicBranch` / `AdminBranch` (contrato real).
 */
export type Branch = Omit<S['Branch'], 'hours' | 'hoursLabel' | 'isOpen' | 'openNow'>;
/** F07: campos públicos de una sucursal activa. */
export type PublicBranch = S['PublicBranch'];
/** F07: sucursal del backoffice (con `active`, estado ADMINISTRATIVO, y `createdAt`). */
export type AdminBranch = S['AdminBranch'];
export type AdminBranchPage = S['AdminBranchPage'];
export type CreateBranchRequest = S['CreateBranchRequest'];
export type UpdateBranchRequest = S['UpdateBranchRequest'];
export type UpdateBranchStatusRequest = S['UpdateBranchStatusRequest'];
export type CoverageRule = S['CoverageRule'];
/** Borrador de `StoreConfig.departments` (MOCK_ONLY). Ya no alimenta formularios: usa `Department`/`Municipality` (F09). */
export type DraftDepartment = S['DraftDepartment'];
/** F09: catálogos geográficos públicos (`GET /v1/locations/*`). */
export type Department = S['Department'];
export type Municipality = S['Municipality'];
/** F09: zonas propias de entrega, configuración por sucursal y cobertura por proveedor. */
export type AdminDeliveryZone = S['AdminDeliveryZone'];
export type AdminDeliveryZonePage = S['AdminDeliveryZonePage'];
export type CreateDeliveryZoneRequest = S['CreateDeliveryZoneRequest'];
export type UpdateDeliveryZoneRequest = S['UpdateDeliveryZoneRequest'];
export type UpdateDeliveryZoneStatusRequest = S['UpdateDeliveryZoneStatusRequest'];
export type BranchDeliverySettings = S['BranchDeliverySettings'];
export type UpdateBranchDeliverySettingsRequest = S['UpdateBranchDeliverySettingsRequest'];
/** F19: cotización de checkout (autoridad de precios del SERVIDOR). */
export type CartQuoteInput = S['CartQuoteInput'];
export type CheckoutQuoteRequest = S['CheckoutQuoteRequest'];
export type CheckoutQuote = S['CheckoutQuote'];
export type CheckoutQuoteLine = S['CheckoutQuoteLine'];
export type CheckoutLineStatus = S['CheckoutLineStatus'];
export type CheckoutFulfillmentInput = S['CheckoutFulfillmentInput'];
export type CheckoutDeliveryOption = S['CheckoutDeliveryOption'];
export type CheckoutBlocker = S['CheckoutBlocker'];
export type CheckoutNotice = S['CheckoutNotice'];
export type CheckoutClientView = S['CheckoutClientView'];
export type DeliveryCoverageCheckRequest = S['DeliveryCoverageCheckRequest'];
export type DeliveryCoverageCheckResponse = S['DeliveryCoverageCheckResponse'];
export type DeliveryEligibility = S['DeliveryEligibility'];
export type OwnCoverage = S['OwnCoverage'];
export type PedidosYaCoverage = S['PedidosYaCoverage'];
export type ProviderIntegrationStatus = S['ProviderIntegrationStatus'];
export type CoverageReason = S['CoverageReason'];
export type DeliveryTierId = S['DeliveryTierId'];
export type DeliveryTier = S['DeliveryTier'];
export type DeliveryQuote = S['DeliveryQuote'];
export type Category = S['Category'];
/** F10: árbol público de categorías visibles y administración (`/v1/store/categories`, `/v1/admin/categories`). */
export type PublicCategory = S['PublicCategory'];
export type PublicCategoryTree = S['PublicCategoryTree'];
export type AdminCategory = S['AdminCategory'];
export type AdminCategoryList = S['AdminCategoryList'];
export type CreateCategoryRequest = S['CreateCategoryRequest'];
export type UpdateCategoryRequest = S['UpdateCategoryRequest'];
export type ReorderCategoriesRequest = S['ReorderCategoriesRequest'];
/**
 * Modelo UI del producto (borrador `Product`, MOCK_ONLY): lo que consumen carrito, checkout y favoritos. Desde F11 se
 * construye en `features/catalog/catalog-product.ts` a partir de `PublicProduct` (contrato real) más lo que F11 NO provee y
 * sigue SIMULADO (ilustración, destacado, `available`/disponibilidad por sucursal F13, textos en inglés).
 */
export type Product = S['Product'];
/** F11: productos y fichas (`/v1/store/products`, `/v1/admin/products`). Importes como CADENA decimal (`"85.00"`). */
export type ProductPrice = S['ProductPrice'];
export type PublicProduct = S['PublicProduct'];
export type PublicProductDetail = S['PublicProductDetail'];
export type PublicProductPage = S['PublicProductPage'];
export type PublicProductCategoryRef = S['PublicProductCategoryRef'];
export type PublicProductMedia = S['PublicProductMedia'];
export type AdminProduct = S['AdminProduct'];
export type AdminProductPage = S['AdminProductPage'];
export type AdminProductCategory = S['AdminProductCategory'];
export type AdminProductMedia = S['AdminProductMedia'];
export type ProductMediaInput = S['ProductMediaInput'];
/** F14: medios (biblioteca `media_assets`, intents de subida y vínculo con productos). */
export type MediaKind = S['MediaKind'];
export type MediaStatus = S['MediaStatus'];
export type MediaStorageMode = S['MediaStorageMode'];
export type CreateMediaUploadIntentRequest = S['CreateMediaUploadIntentRequest'];
export type AdminMediaUploadIntent = S['AdminMediaUploadIntent'];
export type AdminMediaAsset = S['AdminMediaAsset'];
export type AdminMediaAssetDetail = S['AdminMediaAssetDetail'];
export type AdminMediaAssetPage = S['AdminMediaAssetPage'];
export type AdminMediaUsage = S['AdminMediaUsage'];
export type AttachProductMediaRequest = S['AttachProductMediaRequest'];
export type AdminProductMediaList = S['AdminProductMediaList'];
export type CreateProductRequest = S['CreateProductRequest'];
export type UpdateProductRequest = S['UpdateProductRequest'];
/** F12: modificadores (grupos y opciones). Los importes extra son CADENAS decimales (`"5.00"`). */
export type ModifierExtraPrice = S['ModifierExtraPrice'];
export type PublicModifierOption = S['PublicModifierOption'];
export type PublicModifierGroup = S['PublicModifierGroup'];
export type AdminModifier = S['AdminModifier'];
export type AdminModifierList = S['AdminModifierList'];
export type AdminModifierGroupSummary = S['AdminModifierGroupSummary'];
export type AdminModifierGroup = S['AdminModifierGroup'];
export type AdminModifierGroupPage = S['AdminModifierGroupPage'];
export type AdminProductModifiers = S['AdminProductModifiers'];
export type ModifierOptionInput = S['ModifierOptionInput'];
export type CreateModifierGroupRequest = S['CreateModifierGroupRequest'];
export type UpdateModifierGroupRequest = S['UpdateModifierGroupRequest'];
export type CreateModifierRequest = S['CreateModifierRequest'];
export type UpdateModifierRequest = S['UpdateModifierRequest'];
export type ReorderModifiersRequest = S['ReorderModifiersRequest'];
export type ReplaceProductModifierGroupsRequest = S['ReplaceProductModifierGroupsRequest'];
/** Disponibilidad de un PRODUCTO por sucursal (borrador del catálogo; no confundir con `BranchAvailability`, F08). */
export type ProductBranchAvailability = S['DraftBranchAvailability'];
/** F13: precio y disponibilidad por sucursal (overlay público, matrices administrativas y escrituras). */
export type StoreBranchMenu = S['StoreBranchMenu'];
export type StoreBranchMenuItem = S['StoreBranchMenuItem'];
/** F17: agregados públicos (bootstrap del Inicio, búsqueda, oferta y promociones de la ficha). */
export type StoreBootstrap = S['StoreBootstrap'];
export type StoreBootstrapCategory = S['StoreBootstrapCategory'];
export type StoreBootstrapSection = S['StoreBootstrapSection'];
export type StoreSearchPage = S['StoreSearchPage'];
export type StoreProductPromo = S['StoreProductPromo'];
export type StoreProductOffer = S['StoreProductOffer'];
export type AdminBranchProductState = S['AdminBranchProductState'];
export type AdminBranchProductRow = S['AdminBranchProductRow'];
export type AdminBranchProductPage = S['AdminBranchProductPage'];
export type AdminProductBranchRow = S['AdminProductBranchRow'];
export type AdminProductBranches = S['AdminProductBranches'];
export type SetBranchProductPricingRequest = S['SetBranchProductPricingRequest'];
export type SetProductAvailabilityRequest = S['SetProductAvailabilityRequest'];
/**
 * F16 (contrato): banners del Inicio. Público = `StoreBanner` (sin `code`, versión ni promoción: solo CTA estructurado, textos por idioma
 * con `fallbackFields` y la URL pública de la imagen). Administración = `AdminBanner*` (estado derivado, `version`, `editable`).
 */
export type BannerLocale = S['BannerLocale'];
export type BannerLifecycle = S['BannerLifecycle'];
export type BannerHiddenReason = S['BannerHiddenReason'];
export type BannerCtaType = S['BannerCtaType'];
export type BannerPage = S['BannerPage'];
export type BannerCtaInput = S['BannerCtaInput'];
export type BannerTranslationInput = S['BannerTranslationInput'];
export type BannerTranslationsInput = S['BannerTranslationsInput'];
export type BannerTranslationsPatch = S['BannerTranslationsPatch'];
export type BannerTranslationsView = S['BannerTranslationsView'];
export type StoreBanner = S['StoreBanner'];
export type StoreBannerCta = S['StoreBannerCta'];
export type StoreBannerList = S['StoreBannerList'];
export type AdminBannerSummary = S['AdminBannerSummary'];
export type AdminBanner = S['AdminBanner'];
export type AdminBannerPage = S['AdminBannerPage'];
export type AdminBannerCta = S['AdminBannerCta'];
export type AdminBannerImage = S['AdminBannerImage'];
export type AdminBannerOrder = S['AdminBannerOrder'];
export type CreateBannerRequest = S['CreateBannerRequest'];
export type UpdateBannerRequest = S['UpdateBannerRequest'];
export type UpdateBannerStatusRequest = S['UpdateBannerStatusRequest'];
export type ReorderBannersRequest = S['ReorderBannersRequest'];
export type AdminMediaBannerUsage = S['AdminMediaBannerUsage'];
/**
 * F15 (contrato): promociones, cupones y Happy Hour. Público = solo informativo (`StorePromotion`: nunca `code`; un cupón sale con
 * `requiresCode=true` y sin descuento). Administración = `AdminPromotion*` (con `code`, `version` y `editable`). Los borradores
 * `Promotion`/`PromotionInput`/`HappyHourItem` (2x1, precio especial) quedaron RETIRADOS del uso (P15).
 */
export type PromotionKind = S['PromotionKind'];
export type PromotionScope = S['PromotionScope'];
export type PromotionDecimal = S['PromotionDecimal'];
export type PromotionScheduleSlot = S['PromotionScheduleSlot'];
export type StorePromotion = S['StorePromotion'];
export type StorePromotionItem = S['StorePromotionItem'];
export type StorePromotionList = S['StorePromotionList'];
export type AdminPromotionSummary = S['AdminPromotionSummary'];
export type AdminPromotion = S['AdminPromotion'];
export type AdminPromotionPage = S['AdminPromotionPage'];
export type AdminPromotionBranchRef = S['AdminPromotionBranchRef'];
export type AdminPromotionProductRef = S['AdminPromotionProductRef'];
export type CreatePromotionRequest = S['CreatePromotionRequest'];
export type UpdatePromotionRequest = S['UpdatePromotionRequest'];
export type UpdatePromotionStatusRequest = S['UpdatePromotionStatusRequest'];
/**
 * BORRADORES (mock) — F20 (spec 021 §2.4): `Order`, `CreateOrderRequest` y `OrderStatus` del contrato son el borrador que usan el
 * seguimiento y el backoffice SIMULADOS. Se renombran aquí para no confundirlos con los esquemas REALES (`OrderDetail`,
 * `OrderCreateRequest`, `OrderLifecycleStatus`, más abajo). Se retiran con F21/F22.
 */
export type DraftOrderStatus = S['OrderStatus'];
export type PaymentStatus = S['PaymentStatus'];
export type PaymentMethod = S['PaymentMethod'];
export type DeliveryProvider = S['DeliveryProvider'];
export type DeliveryStatus = S['DeliveryStatus'];
export type FulfillmentType = S['FulfillmentType'];
export type OrderSchedule = S['OrderSchedule'];
export type OrderAddress = S['OrderAddress'];
export type OrderCustomer = S['OrderCustomer'];
export type OrderLine = S['OrderLine'];
export type OrderStatusEvent = S['OrderStatusEvent'];
export type Payment = S['Payment'];
export type Delivery = S['Delivery'];
export type DraftOrder = S['Order'];
export type CreateOrderLine = S['CreateOrderLine'];
export type DraftCreateOrderRequest = S['CreateOrderRequest'];
/**
 * F20 (contrato real, spec 021): creación y lectura de pedidos persistidos. `OrderCreateRequest` lleva la cotización aceptada
 * (`quoteToken`), nunca importes; `OrderCreated` trae el pedido y, solo para invitados, la credencial `access.guestToken`.
 */
export type OrderLifecycleStatus = S['OrderLifecycleStatus'];
export type OrderPaymentPreference = S['OrderPaymentPreference'];
export type OrderContactInput = S['OrderContactInput'];
export type OrderDeliveryAddressInput = S['OrderDeliveryAddressInput'];
export type OrderCreateRequest = S['OrderCreateRequest'];
export type OrderDetailModifier = S['OrderDetailModifier'];
export type OrderDetailLine = S['OrderDetailLine'];
export type OrderDetailPromotion = S['OrderDetailPromotion'];
export type OrderDetailAddress = S['OrderDetailAddress'];
export type OrderDetailContact = S['OrderDetailContact'];
export type OrderDetailPayment = S['OrderDetailPayment'];
/**
 * F24 (spec 025, ADR-0030): pago en EFECTIVO. Público: `OrderDetailPayment` / `OrderTracking.payment` / `OrderReceiptPayment`
 * (método `CASH`, estado `PENDING|PAID`; nunca el empleado). Backoffice (tag `admin-payments`): `getAdminOrderPayment`,
 * `registerAdminOrderCashPayment` y `listAdminOrderPaymentHistory`.
 */
export type PaymentMethodCode = S['PaymentMethodCode'];
export type OrderPaymentStatus = S['OrderPaymentStatus'];
export type OrderReceiptPayment = S['OrderReceiptPayment'];
export type PaymentCollectionContext = S['PaymentCollectionContext'];
export type AdminOrderPaymentBlockedReason = S['AdminOrderPaymentBlockedReason'];
export type AdminOrderPaymentRegistration = S['AdminOrderPaymentRegistration'];
export type AdminOrderPaymentSummary = S['AdminOrderPaymentSummary'];
export type PaymentReception = S['PaymentReception'];
export type AdminOrderPayment = S['AdminOrderPayment'];
export type AdminCashPaymentRequest = S['AdminCashPaymentRequest'];
export type AdminCashPaymentResult = S['AdminCashPaymentResult'];
export type AdminPaymentConflict = S['AdminPaymentConflict'];
export type PaymentEventType = S['PaymentEventType'];
export type AdminPaymentEvent = S['AdminPaymentEvent'];
export type AdminPaymentHistory = S['AdminPaymentHistory'];
/**
 * F27 (spec 028, ADR-0031): motoristas PROPIOS del backoffice (tag `admin-riders`). Modelo NUEVO, separado del `Rider` de despacho
 * simulado de `bo-deliveries` (que no se toca hasta F28). `busy` solo es real si `busyKnown`; `operationalState` nunca es `BUSY` sin F28.
 */
export type RiderVehicleType = S['RiderVehicleType'];
export type RiderAvailability = S['RiderAvailability'];
export type RiderAvailabilityFilter = S['RiderAvailabilityFilter'];
export type RiderOperationalState = S['RiderOperationalState'];
export type AdminRiderSummary = S['AdminRiderSummary'];
export type AdminRider = S['AdminRider'];
export type AdminRiderPage = S['AdminRiderPage'];
export type CreateRiderRequest = S['CreateRiderRequest'];
export type UpdateRiderRequest = S['UpdateRiderRequest'];
export type UpdateRiderStatusRequest = S['UpdateRiderStatusRequest'];
export type UpdateRiderAvailabilityRequest = S['UpdateRiderAvailabilityRequest'];
/**
 * F28 (spec 029, ADR-0032): entregas PROPIAS del backoffice (tag `admin-deliveries`). Modelo NUEVO, separado del despacho simulado
 * (`DraftOrder.delivery`, `CourierQuote`, `Rider`) que sigue siendo MOCK_ONLY para PedidosYa. La web nunca decide transiciones ni
 * permisos: usa `availableActions` y `contactVisible` del servidor.
 */
export type AdminDeliveryStatus = S['AdminDeliveryStatus'];
export type AdminDeliveryEvent = S['AdminDeliveryEvent'];
export type AdminDeliveryAction = S['AdminDeliveryAction'];
export type AdminDeliveryActionState = S['AdminDeliveryActionState'];
export type AdminDeliveryRider = S['AdminDeliveryRider'];
export type AdminDeliveryOrderRef = S['AdminDeliveryOrderRef'];
export type AdminDeliveryAddress = S['AdminDeliveryAddress'];
export type AdminDeliveryCustomer = S['AdminDeliveryCustomer'];
export type AdminDeliverySummary = S['AdminDeliverySummary'];
export type AdminDeliveryHistoryEntry = S['AdminDeliveryHistoryEntry'];
export type AdminDelivery = S['AdminDelivery'];
export type AdminDeliveryPage = S['AdminDeliveryPage'];
export type AdminDeliveryTransition = S['AdminDeliveryTransition'];
export type AdminDeliveryCommandResult = S['AdminDeliveryCommandResult'];
export type AdminDeliveryStateSnapshot = S['AdminDeliveryStateSnapshot'];
export type CreateAdminDeliveryRequest = S['CreateAdminDeliveryRequest'];
export type AssignOwnRiderRequest = S['AssignOwnRiderRequest'];
export type AdminDeliveryCommandRequest = S['AdminDeliveryCommandRequest'];
export type UnassignRiderRequest = S['UnassignRiderRequest'];
export type CancelAdminDeliveryRequest = S['CancelAdminDeliveryRequest'];
export type OrderDetail = S['OrderDetail'];
export type OrderGuestAccess = S['OrderGuestAccess'];
/** F21 (spec 022): seguimiento ligero para polling; sin importes, líneas, contacto ni dirección. */
export type OrderPublicStatus = S['OrderPublicStatus'];
export type OrderTrackingStep = S['OrderTrackingStep'];
export type OrderTrackingEvent = S['OrderTrackingEvent'];
export type OrderTrackingDelivery = S['OrderTrackingDelivery'];
export type OrderTracking = S['OrderTracking'];
export type OrderCreated = S['OrderCreated'];
export type OrderQuoteChange = S['OrderQuoteChange'];
export type OrderQuoteConflict = S['OrderQuoteConflict'];
export type OrderBlocked = S['OrderBlocked'];
/**
 * F23 (spec 024, ADR-0029): historial del cliente (`listMyOrders`), recibo NO fiscal (`getOrderReceipt`) y vista previa de «Volver a
 * pedir» (`previewOrderReorder`). El detalle histórico es `OrderDetail` (`getOrder`, F20).
 */
export type MyOrderSummary = S['MyOrderSummary'];
export type MyOrderPage = S['MyOrderPage'];
export type OrderReceipt = S['OrderReceipt'];
export type OrderReorderRequest = S['OrderReorderRequest'];
export type OrderReorderPreview = S['OrderReorderPreview'];
export type OrderReorderLine = S['OrderReorderLine'];
export type OrderReorderLineStatus = S['OrderReorderLineStatus'];
export type OrderReorderIssue = S['OrderReorderIssue'];
export type OrderReorderIssueCode = S['OrderReorderIssueCode'];
export type OrderReorderCandidate = S['OrderReorderCandidate'];
export type OrderReorderBranch = S['OrderReorderBranch'];
export type OrderReorderSummary = S['OrderReorderSummary'];
/**
 * F22 (spec 023, ADR-0028): pedidos del backoffice (tag `admin-orders`). La web nunca decide la matriz de transiciones:
 * usa `availableActions` que calcula el servidor.
 */
export type AdminOrderAction = S['AdminOrderAction'];
export type AdminOrderActionState = S['AdminOrderActionState'];
export type AdminOrderSummary = S['AdminOrderSummary'];
export type AdminOrderPage = S['AdminOrderPage'];
export type AdminOrderBoard = S['AdminOrderBoard'];
export type AdminOrderBoardColumn = S['AdminOrderBoardColumn'];
export type AdminOrderBoardSummary = S['AdminOrderBoardSummary'];
export type AdminOrderDetail = S['AdminOrderDetail'];
export type AdminOrderHistoryEntry = S['AdminOrderHistoryEntry'];
export type AdminOrderContact = S['AdminOrderContact'];
export type AdminOrderCommandRequest = S['AdminOrderCommandRequest'];
export type AdminOrderReasonRequest = S['AdminOrderReasonRequest'];
export type AdminOrderTransition = S['AdminOrderTransition'];
export type AdminOrderPendingAction = S['AdminOrderPendingAction'];
export type AdminOrderTransitionResult = S['AdminOrderTransitionResult'];
export type AdminOrderStateSnapshot = S['AdminOrderStateSnapshot'];
export type OrderLookupRequest = S['OrderLookupRequest'];
export type CourierQuote = S['CourierQuote'];
export type DispatchRequest = S['DispatchRequest'];
export type OrderStatusChangeRequest = S['OrderStatusChangeRequest'];
export type Rider = S['Rider'];
export type StaffRole = S['StaffRole'];
export type StaffPermission = S['StaffPermission'];
export type StaffUser = S['StaffUser'];
export type StaffUserInput = S['StaffUserInput'];
/** F03 (ADR-0010): empleados, asignaciones rol+sucursal, roles y permisos granulares `modulo.accion`. */
export type AdminStaff = S['AdminStaff'];
export type AdminStaffPage = S['AdminStaffPage'];
export type StaffAssignmentView = S['StaffAssignmentView'];
export type StaffAssignmentInput = S['StaffAssignmentInput'];
export type StaffIdentityStatus = S['StaffIdentityStatus'];
export type CreateStaffRequest = S['CreateStaffRequest'];
export type UpdateStaffRequest = S['UpdateStaffRequest'];
export type UpdateStaffStatusRequest = S['UpdateStaffStatusRequest'];
export type ReplaceStaffAssignmentsRequest = S['ReplaceStaffAssignmentsRequest'];
export type AdminRole = S['AdminRole'];
export type AdminRoleList = S['AdminRoleList'];
export type PermissionRef = S['PermissionRef'];
export type AdminPermissionModule = S['AdminPermissionModule'];
export type AdminPermissionCatalog = S['AdminPermissionCatalog'];
export type ReplaceRolePermissionsRequest = S['ReplaceRolePermissionsRequest'];
export type GrantScope = S['GrantScope'];
export type BranchRef = S['BranchRef'];
export type RoleRef = S['RoleRef'];
export type AuthStaffContext = S['AuthStaffContext'];
export type AdminContextResponse = S['AdminContextResponse'];
export type Customer = S['Customer'];
/** F04: perfil de cliente tal como lo devuelve la API (`GET`/`PATCH /v1/me`). */
export type MeResponse = S['MeResponse'];
export type CustomerProfile = S['CustomerProfile'];
export type CustomerStorefrontContext = S['CustomerStorefrontContext'];
export type UpdateCustomerProfileRequest = S['UpdateCustomerProfileRequest'];
/**
 * F05: dirección tal como la devuelve la API real (`GET /v1/me/addresses`, contrato `CustomerAddress`).
 * La web todavía NO la consume: su UI usa la forma simulada de abajo (Etapa 1, `MOCK_ONLY`).
 */
export type CustomerAddressResponse = S['CustomerAddress'];
export type CreateCustomerAddressRequest = S['CreateCustomerAddressRequest'];
export type UpdateCustomerAddressRequest = S['UpdateCustomerAddressRequest'];

/**
 * Dirección en la vista de la UI (F05). Se construye desde `CustomerAddressResponse` en `services/account.ts`.
 * La etiqueta es un enum de UI: la API guarda texto ("Casa", "Trabajo" o el nombre propio).
 */
export type Address = {
  id: string;
  isDefault: boolean;
  label: 'home' | 'work' | 'other';
  customLabel: string;
  municipalityId: string;
  department: string;
  municipality: string;
  zone: string;
  line: string;
  references: string;
  createdAt: string;
};

/** Forma interna de la dirección en el mock (sin predeterminada ni id de municipio). */
export type StoredAddress = Omit<Address, 'isDefault' | 'municipalityId'>;

/** Entrada del formulario de direcciones (UI). Los nombres sirven a la validación de zona y a la vista. */
export type AddressInput = {
  label: 'home' | 'work' | 'other';
  customLabel?: string;
  municipalityId: string;
  department: string;
  municipality: string;
  zone: string;
  line: string;
  references?: string;
};
export type Incident = S['Incident'];
export type CreateIncidentRequest = S['CreateIncidentRequest'];
export type JobApplication = S['JobApplication'];
export type JobApplicationRequest = S['JobApplicationRequest'];
export type BranchCount = S['BranchCount'];
export type DashboardAlert = S['DashboardAlert'];
export type DashboardSummary = S['DashboardSummary'];
export type ReportGroup = S['ReportGroup'];
export type ReportSummary = S['ReportSummary'];
export type ErrorResponse = S['ErrorResponse'];

/** Constantes de catálogo (derivadas de los enums del contrato, comprobadas por el tipo). */
export const ORDER_STATUSES = [
  'received',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'rejected',
  'cancelled',
] as const satisfies readonly DraftOrderStatus[];

export const DELIVERY_TIERS = [
  'near',
  'mid',
  'extended',
  'far',
] as const satisfies readonly DeliveryTierId[];

export const STAFF_ROLES = [
  'admin',
  'manager',
  'kitchen',
  'staff',
] as const satisfies readonly StaffRole[];

/** F06: favoritos del cliente (`GET /v1/me/favorites`). Sin precios: el precio lo resuelve el catálogo de la sucursal. */
export type CustomerFavorites = S['CustomerFavorites'];
export type FavoriteItem = S['FavoriteItem'];
export type FavoriteProductSummary = S['FavoriteProductSummary'];
export type FavoriteProductStatus = S['FavoriteProductStatus'];

/**
 * SIMULADO (solo mock, `/v1/demo/catalog/product-extras`): lo que F11 NO provee y la tienda sigue necesitando hasta que
 * lleguen F15 (insignias) y los textos por idioma. Nunca existe
 * en la API real: en http la UI usa valores por defecto.
 */
export interface SimulatedProductExtras {
  productId: string;
  nameEn?: string;
  descriptionEn?: string;
  illustration: string;
  featured: boolean;
  food: boolean;
}
