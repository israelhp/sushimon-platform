import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Esquemas de respuesta de `POST /v1/checkout/quote` (contrato: `CheckoutQuote*`). Importes: cadenas `"85.00"` en GTQ. */

export class CheckoutQuoteMetaDto {
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: String, nullable: true, maxLength: 1024 })
  token!: string | null;
}

export class CheckoutBranchStateDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: Boolean })
  isAcceptingOrders!: boolean;

  @ApiProperty({ type: String })
  reason!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextOpensAt!: string | null;
}

export class CheckoutModifierLineDto {
  @ApiProperty({ type: String, format: 'uuid' })
  groupId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  optionId!: string;

  @ApiProperty({ type: String, example: '5.00' })
  extraPrice!: string;
}

export class CheckoutQuoteLineDto {
  @ApiProperty({ type: Number })
  index!: number;

  @ApiProperty({ type: String, format: 'uuid' })
  productId!: string;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String, nullable: true })
  unitPrice!: string | null;

  @ApiProperty({ type: [CheckoutModifierLineDto] })
  modifiers!: CheckoutModifierLineDto[];

  @ApiProperty({ type: String, nullable: true })
  extrasPerUnit!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lineSubtotal!: string | null;

  @ApiProperty({ type: String, nullable: true })
  discount!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  promotionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lineTotal!: string | null;

  @ApiProperty({ type: String, nullable: true })
  previousUnitPrice!: string | null;
}

export class CheckoutDeliveryOptionDto {
  @ApiProperty({ type: String, enum: ['PEDIDOSYA', 'OWN'] })
  provider!: 'PEDIDOSYA' | 'OWN';

  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: String, enum: ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'] })
  coverageStatus!: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

  @ApiPropertyOptional({ type: String, enum: ['BLOCKED_EXTERNAL', 'MOCK', 'LIVE'] })
  integrationStatus?: 'BLOCKED_EXTERNAL' | 'MOCK' | 'LIVE';

  @ApiProperty({ type: Boolean })
  simulated!: boolean;

  @ApiProperty({ type: String, nullable: true })
  customerFee!: string | null;

  @ApiProperty({ type: Boolean })
  selectable!: boolean;

  @ApiPropertyOptional({ type: String })
  unavailableReason?: string;
}

export class CheckoutDeliveryDto {
  @ApiProperty({ type: String, enum: ['PEDIDOSYA', 'OWN'], nullable: true })
  selectedProvider!: 'PEDIDOSYA' | 'OWN' | null;

  @ApiProperty({ type: [CheckoutDeliveryOptionDto] })
  options!: CheckoutDeliveryOptionDto[];
}

export class CheckoutFulfillmentDto {
  @ApiProperty({ type: String, enum: ['DELIVERY'] })
  type!: 'DELIVERY';

  @ApiProperty({ type: CheckoutDeliveryDto, nullable: true })
  delivery!: CheckoutDeliveryDto | null;
}

export class CheckoutBlockerDto {
  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String, enum: ['LINE', 'BRANCH', 'FULFILLMENT'] })
  scope!: 'LINE' | 'BRANCH' | 'FULFILLMENT';

  @ApiPropertyOptional({ type: Number })
  lineIndex?: number;
}

export class CheckoutNoticeDto {
  @ApiProperty({ type: String })
  code!: string;

  @ApiPropertyOptional({ type: Number })
  lineIndex?: number;
}

export class CheckoutCouponDto {
  @ApiProperty({ type: String, enum: ['APPLIED', 'NOT_APPLIED'] })
  status!: 'APPLIED' | 'NOT_APPLIED';
}

export class CheckoutQuoteDto {
  @ApiProperty({ type: CheckoutQuoteMetaDto })
  quote!: CheckoutQuoteMetaDto;

  @ApiProperty({ type: String, enum: ['GTQ'] })
  currency!: 'GTQ';

  @ApiProperty({ type: CheckoutBranchStateDto })
  branch!: CheckoutBranchStateDto;

  @ApiProperty({ type: CheckoutFulfillmentDto })
  fulfillment!: CheckoutFulfillmentDto;

  @ApiProperty({ type: [CheckoutQuoteLineDto] })
  lines!: CheckoutQuoteLineDto[];

  @ApiProperty({ type: String })
  subtotal!: string;

  @ApiProperty({ type: String })
  extrasTotal!: string;

  @ApiProperty({ type: String })
  discountTotal!: string;

  @ApiProperty({ type: String, nullable: true })
  deliveryFee!: string | null;

  @ApiProperty({ type: String, nullable: true })
  total!: string | null;

  @ApiProperty({ type: CheckoutCouponDto, nullable: true })
  coupon!: CheckoutCouponDto | null;

  @ApiProperty({ type: Boolean })
  canProceed!: boolean;

  @ApiProperty({ type: [CheckoutBlockerDto] })
  blockers!: CheckoutBlockerDto[];

  @ApiProperty({ type: [CheckoutNoticeDto] })
  notices!: CheckoutNoticeDto[];
}
