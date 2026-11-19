import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

/** Esquemas de `/v1/admin/orders/{id}/payment…` (contrato: `AdminOrderPayment*`, `AdminCashPayment*`, `PaymentReception`, F24). */

const BLOCKED_REASONS = [
  'ALREADY_PAID',
  'ORDER_CLOSED',
  'PROVIDER_BLOCKED_EXTERNAL',
  'AMOUNT_ZERO',
  'LEGACY_PAYMENT_METHOD',
  'NO_PERMISSION',
];
const LIFECYCLE_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];

export class AdminOrderPaymentRegistrationDto {
  @ApiProperty({ type: Boolean })
  allowed!: boolean;

  @ApiProperty({ type: String, enum: BLOCKED_REASONS, nullable: true })
  blockedReason!: string | null;
}

export class AdminOrderPaymentSummaryDto {
  @ApiProperty({ type: String, enum: ['CASH'] })
  method!: 'CASH';

  @ApiProperty({ type: String, enum: ['PENDING', 'PAID'] })
  status!: 'PENDING' | 'PAID';

  @ApiProperty({ type: String, example: '185.00' })
  amountDue!: string;

  @ApiProperty({ type: String, example: '185.00' })
  outstanding!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt!: string | null;

  @ApiProperty({ type: Boolean })
  possibleRefundReview!: boolean;

  @ApiProperty({ type: AdminOrderPaymentRegistrationDto })
  registration!: AdminOrderPaymentRegistrationDto;
}

export class PaymentReceptionDto {
  @ApiProperty({ type: String, example: '185.00' })
  amountApplied!: string;

  @ApiProperty({ type: String, example: '200.00' })
  tendered!: string;

  @ApiProperty({ type: String, example: '15.00' })
  change!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  receivedAt!: string;

  @ApiProperty({ type: String, enum: ['STAFF'] })
  collectorType!: 'STAFF';

  @ApiProperty({ type: String, nullable: true })
  collectorName!: string | null;

  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;

  @ApiProperty({ type: String, enum: ['BRANCH', 'OWN_DELIVERY'] })
  context!: 'BRANCH' | 'OWN_DELIVERY';
}

export class AdminOrderPaymentDto extends AdminOrderPaymentSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  orderId!: string;

  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;

  @ApiProperty({ type: String, enum: LIFECYCLE_STATUSES })
  orderStatus!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;

  @ApiProperty({ type: String, enum: ['PICKUP', 'DELIVERY'] })
  fulfillmentType!: 'PICKUP' | 'DELIVERY';

  @ApiProperty({ type: String, enum: ['OWN', 'PEDIDOSYA'], nullable: true })
  deliveryProvider!: 'OWN' | 'PEDIDOSYA' | null;

  @ApiProperty({ type: String, enum: ['GTQ'] })
  currency!: 'GTQ';

  @ApiProperty({ type: String, enum: ['BRANCH', 'OWN_DELIVERY'], nullable: true })
  collectionContext!: 'BRANCH' | 'OWN_DELIVERY' | null;

  @ApiProperty({ type: PaymentReceptionDto, nullable: true })
  reception!: PaymentReceptionDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;
}

/**
 * Cuerpo de `registerAdminOrderCashPayment`. Solo estos dos campos (`forbidNonWhitelisted` => 400 con `staffId`, `branchId`,
 * `change`, `receivedAt`, `collectorType`…). El VALOR se valida en el servicio para devolver el código estable
 * (`PAYMENT_AMOUNT_INVALID` / `PAYMENT_CONFIRMATION_REQUIRED`) y no un 400 genérico: aquí solo se declaran como conocidos.
 */
export class AdminCashPaymentRequest {
  @ApiProperty({ type: String, pattern: '^[0-9]{1,9}(\\.[0-9]{1,2})?$', example: '200.00' })
  @IsOptional()
  tendered?: unknown;

  @ApiProperty({ type: Boolean, enum: [true] })
  @IsOptional()
  receivedConfirmed?: unknown;
}

export class AdminCashPaymentResultDto {
  @ApiProperty({ type: AdminOrderPaymentDto })
  payment!: AdminOrderPaymentDto;

  @ApiProperty({ type: Boolean })
  replayed!: boolean;

  @ApiProperty({ type: Boolean })
  appliedByMe!: boolean;
}

export class AdminPaymentEventDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 20 })
  seq!: number;

  @ApiProperty({ type: String, enum: ['CREATED', 'CASH_RECEIVED'] })
  type!: 'CREATED' | 'CASH_RECEIVED';

  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;

  @ApiProperty({ type: String, nullable: true })
  actorName!: string | null;

  @ApiProperty({ type: String, example: '185.00' })
  amountDue!: string;

  @ApiProperty({ type: String, nullable: true })
  tendered!: string | null;

  @ApiProperty({ type: String, nullable: true })
  change!: string | null;
}

export class AdminPaymentHistoryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  orderId!: string;

  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;

  @ApiProperty({ type: [AdminPaymentEventDto], maxItems: 20 })
  items!: AdminPaymentEventDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;
}
