import type { components } from '@sushimon/contracts';

/**
 * Alias legibles de los esquemas del contrato (`components/schemas`, x-status: draft).
 * No se redefinen tipos a mano: si cambia el OpenAPI, se regeneran y cambian aquí.
 */
type S = components['schemas'];

export type LocalizedText = S['LocalizedText'];
export type StoreConfig = S['StoreConfig'];
export type BranchHours = S['BranchHours'];
export type Branch = S['Branch'];
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

export const STAFF_ROLES = ['admin', 'manager', 'kitchen'] as const satisfies readonly StaffRole[];
