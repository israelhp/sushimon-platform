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
export type Product = S['Product'];
/** Disponibilidad de un PRODUCTO por sucursal (borrador del catálogo; no confundir con `BranchAvailability`, F08). */
export type ProductBranchAvailability = S['DraftBranchAvailability'];
export type Promotion = S['Promotion'];
export type PromotionInput = S['PromotionInput'];
export type HappyHourItem = S['HappyHourItem'];
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

/** 🎭 F05 simulado: forma de UI del prototipo (etiqueta enum + texto libre). Pendiente de migrar a `CustomerAddressResponse`. */
export type Address = {
  id: string;
  label: 'home' | 'work' | 'other';
  customLabel: string;
  department: string;
  municipality: string;
  zone: string;
  line: string;
  references: string;
  createdAt: string;
};
/** 🎭 F05 simulado: entrada de la UI del prototipo. Pendiente de migrar a `CreateCustomerAddressRequest`. */
export type AddressInput = {
  label: 'home' | 'work' | 'other';
  customLabel?: string;
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
