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
export type OrderStatus = S['OrderStatus'];
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
export type Order = S['Order'];
export type CreateOrderLine = S['CreateOrderLine'];
export type CreateOrderRequest = S['CreateOrderRequest'];
export type OrderLookupRequest = S['OrderLookupRequest'];
export type CardPaymentRequest = S['CardPaymentRequest'];
export type PaymentResult = S['PaymentResult'];
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
] as const satisfies readonly OrderStatus[];

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
