import type { components } from '@sushimon/contracts';

/**
 * Alias legibles de los esquemas del contrato (`components/schemas`, x-status: draft).
 * No se redefinen tipos a mano: si cambia el OpenAPI, se regeneran y cambian aquí.
 */
type S = components['schemas'];

export type LocalizedText = S['LocalizedText'];
export type StoreConfig = S['StoreConfig'];
export type BranchHours = S['BranchHours'];
/**
 * `Branch` es el modelo UI RICO de la tienda y el backoffice: mezcla campos de F07 (id, nombre, dirección, teléfono) con
 * campos SIMULADOS de F08/F09 (`isOpen`, `openNow`, `hours`, `coverage`, `radiusKm`, `status`…). Se obtiene de
 * `paths.demoBranchOperations` (solo mock). Para lo que F07 posee usa `PublicBranch` / `AdminBranch` (contrato real).
 */
export type Branch = S['Branch'];
/** F07: campos públicos de una sucursal activa. */
export type PublicBranch = S['PublicBranch'];
/** F07: sucursal del backoffice (con `active`, estado ADMINISTRATIVO, y `createdAt`). */
export type AdminBranch = S['AdminBranch'];
export type AdminBranchPage = S['AdminBranchPage'];
export type CreateBranchRequest = S['CreateBranchRequest'];
export type UpdateBranchRequest = S['UpdateBranchRequest'];
export type UpdateBranchStatusRequest = S['UpdateBranchStatusRequest'];
export type CoverageRule = S['CoverageRule'];
export type Department = S['Department'];
export type DeliveryTierId = S['DeliveryTierId'];
export type DeliveryTier = S['DeliveryTier'];
export type DeliveryQuote = S['DeliveryQuote'];
export type Category = S['Category'];
export type Product = S['Product'];
export type BranchAvailability = S['BranchAvailability'];
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
export type Address = S['Address'];
export type AddressInput = S['AddressInput'];
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
