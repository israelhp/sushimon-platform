/** Tipos de dominio de cobertura (F09). Los enums son abiertos para los clientes; aquí son los valores que emite F09. */

export type CourierProvider = 'PEDIDOSYA' | 'OWN';
export type CoverageStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
export type ProviderIntegrationStatus = 'BLOCKED_EXTERNAL' | 'MOCK' | 'LIVE';
export type CoverageReason =
  | 'PROVIDER_DISABLED'
  | 'INTEGRATION_NOT_CONFIGURED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'INVALID_REQUEST'
  | 'PROVIDER_UNDETERMINED'
  | 'NO_ZONE_COVERAGE';

export const COVERAGE_REASONS: readonly CoverageReason[] = [
  'PROVIDER_DISABLED',
  'INTEGRATION_NOT_CONFIGURED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_ERROR',
  'INVALID_REQUEST',
  'PROVIDER_UNDETERMINED',
  'NO_ZONE_COVERAGE',
];

/** Defaults de una sucursal sin fila (D4). ÚNICO lugar en código; coinciden con los DEFAULT de columna. */
export const DEFAULT_DELIVERY_SETTINGS = {
  ownDeliveryZonesEnabled: false,
  pedidosyaEnabled: true,
} as const;

export interface DeliverySettingsValues {
  ownDeliveryZonesEnabled: boolean;
  pedidosyaEnabled: boolean;
}

export interface OwnCoverageEvaluation {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  deliveryZoneId: string | null;
  baseFee: string | null;
  currency: 'GTQ';
  matchedBy: 'ZONE' | 'MUNICIPALITY' | null;
  reason?: CoverageReason;
}

export interface PedidosYaCoverageView {
  enabled: boolean;
  coverageStatus: CoverageStatus;
  integrationStatus: ProviderIntegrationStatus;
  quoteStatus: 'NOT_AVAILABLE';
  reason?: CoverageReason;
}

export interface OwnCoverageView {
  enabled: boolean;
  coverageStatus: 'AVAILABLE' | 'UNAVAILABLE';
  deliveryZoneId: string | null;
  baseFee: string | null;
  currency: 'GTQ';
  matchedBy: 'ZONE' | 'MUNICIPALITY' | null;
  reason?: CoverageReason;
}

export interface DeliveryEligibilityView {
  status: 'CONFIRMED' | 'PENDING' | 'NONE';
  confirmedProviders: CourierProvider[];
  pendingProviders: CourierProvider[];
  simulated: boolean;
}

/** Cuerpo de `POST /v1/delivery-coverage/check`; F19/F20 consumen exactamente este objeto. */
export interface DeliveryCoverageResult {
  branchId: string;
  municipalityId: string;
  zone: string | null;
  checkedAt: string;
  providers: { PEDIDOSYA: PedidosYaCoverageView; OWN: OwnCoverageView };
  eligibility: DeliveryEligibilityView;
}
