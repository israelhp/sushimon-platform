import { ApiProperty } from '@nestjs/swagger';

const MONEY = '^(0|[1-9][0-9]{0,4})\\.[0-9]{2}$';
const PROVIDER_STATUS = ['BLOCKED_EXTERNAL', 'MOCK', 'LIVE'];
const REASONS = [
  'PROVIDER_DISABLED',
  'INTEGRATION_NOT_CONFIGURED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_ERROR',
  'INVALID_REQUEST',
  'PROVIDER_UNDETERMINED',
  'NO_ZONE_COVERAGE',
];

export class AdminDeliveryZoneDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) branchId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) municipalityId!: string;
  @ApiProperty({ type: String }) municipalityName!: string;
  @ApiProperty({ type: String, format: 'uuid' }) departmentId!: string;
  @ApiProperty({ type: String }) departmentName!: string;
  @ApiProperty({ type: String, nullable: true, description: '`null` = cobertura general.' })
  zoneLabel!: string | null;
  @ApiProperty({ type: String, pattern: MONEY, example: '15.00' }) baseFee!: string;
  @ApiProperty({ type: String, enum: ['GTQ'] }) currency!: 'GTQ';
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Number, minimum: 1 }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class AdminDeliveryZonePageDto {
  @ApiProperty({ type: [AdminDeliveryZoneDto] }) items!: AdminDeliveryZoneDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
}

export class BranchDeliverySettingsDto {
  @ApiProperty({ type: String, format: 'uuid' }) branchId!: string;
  @ApiProperty({ type: Boolean }) ownDeliveryZonesEnabled!: boolean;
  @ApiProperty({
    type: Boolean,
    description: 'Indicador ADMINISTRATIVO; no es integración operativa.',
  })
  pedidosyaEnabled!: boolean;
  @ApiProperty({ type: String, enum: PROVIDER_STATUS }) pedidosyaIntegrationStatus!: string;
  @ApiProperty({ type: Boolean }) isDefault!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class PedidosYaCoverageDto {
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({ type: String, enum: ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'] })
  coverageStatus!: string;
  @ApiProperty({ type: String, enum: PROVIDER_STATUS }) integrationStatus!: string;
  @ApiProperty({ type: String, enum: ['NOT_AVAILABLE'] }) quoteStatus!: string;
  @ApiProperty({ type: String, enum: REASONS, required: false }) reason?: string;
}

export class OwnCoverageDto {
  @ApiProperty({ type: Boolean }) enabled!: boolean;
  @ApiProperty({ type: String, enum: ['AVAILABLE', 'UNAVAILABLE'] }) coverageStatus!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) deliveryZoneId!: string | null;
  @ApiProperty({ type: String, pattern: MONEY, nullable: true }) baseFee!: string | null;
  @ApiProperty({ type: String, enum: ['GTQ'] }) currency!: string;
  @ApiProperty({ type: String, enum: ['ZONE', 'MUNICIPALITY'], nullable: true })
  matchedBy!: string | null;
  @ApiProperty({ type: String, enum: REASONS, required: false }) reason?: string;
}

export class CoverageProvidersDto {
  @ApiProperty({ type: PedidosYaCoverageDto }) PEDIDOSYA!: PedidosYaCoverageDto;
  @ApiProperty({ type: OwnCoverageDto }) OWN!: OwnCoverageDto;
}

export class DeliveryEligibilityDto {
  @ApiProperty({ type: String, enum: ['CONFIRMED', 'PENDING', 'NONE'] }) status!: string;
  @ApiProperty({ type: [String], enum: ['PEDIDOSYA', 'OWN'] }) confirmedProviders!: string[];
  @ApiProperty({ type: [String], enum: ['PEDIDOSYA', 'OWN'] }) pendingProviders!: string[];
  @ApiProperty({ type: Boolean }) simulated!: boolean;
}

export class DeliveryCoverageCheckResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) branchId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) municipalityId!: string;
  @ApiProperty({ type: String, nullable: true }) zone!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) checkedAt!: string;
  @ApiProperty({ type: CoverageProvidersDto }) providers!: CoverageProvidersDto;
  @ApiProperty({ type: DeliveryEligibilityDto }) eligibility!: DeliveryEligibilityDto;
}
