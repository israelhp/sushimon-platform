import { ApiProperty } from '@nestjs/swagger';
import {
  OrderDetailAddressDto,
  OrderDetailLineDto,
  OrderDetailPaymentDto,
  OrderDetailPromotionDto,
} from '../../dto/order-responses.dto.js';
import { ORDER_STATUSES } from '../order-transition.matrix.js';

/** Esquemas de respuesta de `/v1/admin/orders` (contrato: `AdminOrder*`). Importes: cadenas decimales GTQ. */

const ACTIONS = [
  'accept',
  'reject',
  'start_preparing',
  'mark_ready',
  'complete',
  'cancel',
  'dispatch',
];

export class AdminOrderActionStateDto {
  @ApiProperty({ type: String, enum: ACTIONS })
  action!: string;

  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({
    type: String,
    enum: ['NO_PERMISSION', 'DISPATCH_NOT_AVAILABLE', 'PROVIDER_BLOCKED_EXTERNAL'],
    nullable: true,
  })
  disabledReason!: string | null;
}

export class AdminOrderSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: Number, format: 'int64' })
  orderNumber!: number;

  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;

  @ApiProperty({ type: String, enum: ORDER_STATUSES })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;

  @ApiProperty({ type: String })
  branchName!: string;

  @ApiProperty({ type: String, enum: ['PICKUP', 'DELIVERY'] })
  fulfillmentType!: 'PICKUP' | 'DELIVERY';

  @ApiProperty({ type: String, enum: ['OWN', 'PEDIDOSYA'], nullable: true })
  deliveryProvider!: 'OWN' | 'PEDIDOSYA' | null;

  @ApiProperty({ type: String })
  customerName!: string;

  @ApiProperty({ type: Number })
  itemCount!: number;

  @ApiProperty({ type: String, example: '185.00' })
  total!: string;

  @ApiProperty({ type: String, enum: ['cash', 'bank_transfer'], nullable: true })
  paymentMethodPreference!: 'cash' | 'bank_transfer' | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  scheduledFor!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: [AdminOrderActionStateDto] })
  availableActions!: AdminOrderActionStateDto[];
}

export class AdminOrderPageDto {
  @ApiProperty({ type: [AdminOrderSummaryDto] })
  items!: AdminOrderSummaryDto[];

  @ApiProperty({ type: String, nullable: true, maxLength: 200 })
  nextCursor!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;
}

export class AdminOrderBoardSummaryDto {
  @ApiProperty({ type: Number })
  pending!: number;

  @ApiProperty({ type: Number })
  active!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  oldestPendingAt!: string | null;
}

export class AdminOrderBoardColumnDto {
  @ApiProperty({ type: String, enum: ORDER_STATUSES })
  status!: string;

  @ApiProperty({ type: Number })
  count!: number;

  @ApiProperty({ type: Boolean })
  hasMore!: boolean;

  @ApiProperty({ type: [AdminOrderSummaryDto] })
  items!: AdminOrderSummaryDto[];
}

export class AdminOrderBoardDto {
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  branchId!: string | null;

  @ApiProperty({ type: Number, enum: [24] })
  terminalWindowHours!: 24;

  @ApiProperty({ type: Number })
  pollAfterSeconds!: number;

  @ApiProperty({ type: AdminOrderBoardSummaryDto })
  summary!: AdminOrderBoardSummaryDto;

  @ApiProperty({ type: [AdminOrderBoardColumnDto] })
  columns!: AdminOrderBoardColumnDto[];
}

export class AdminOrderHistoryEntryDto {
  @ApiProperty({ type: Number })
  seq!: number;

  @ApiProperty({ type: String, enum: ORDER_STATUSES })
  status!: string;

  @ApiProperty({ type: String, enum: ORDER_STATUSES, nullable: true })
  previousStatus!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;

  @ApiProperty({ type: String, nullable: true })
  actorName!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 500 })
  reason!: string | null;
}

export class AdminOrderContactDto {
  @ApiProperty({ type: String })
  fullName!: string;

  @ApiProperty({ type: String, example: '+50255551234' })
  phone!: string;
}

export class AdminOrderDetailDto extends AdminOrderSummaryDto {
  @ApiProperty({ type: String, enum: ['GTQ'] })
  currency!: 'GTQ';

  @ApiProperty({ type: [OrderDetailLineDto] })
  lines!: OrderDetailLineDto[];

  @ApiProperty({ type: [OrderDetailPromotionDto] })
  promotions!: OrderDetailPromotionDto[];

  @ApiProperty({ type: OrderDetailAddressDto, nullable: true })
  address!: OrderDetailAddressDto | null;

  @ApiProperty({ type: AdminOrderContactDto })
  contact!: AdminOrderContactDto;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ type: String })
  subtotal!: string;

  @ApiProperty({ type: String })
  extrasTotal!: string;

  @ApiProperty({ type: String })
  discountTotal!: string;

  @ApiProperty({ type: String })
  deliveryFee!: string;

  @ApiProperty({ type: OrderDetailPaymentDto })
  payment!: OrderDetailPaymentDto;

  @ApiProperty({ type: [AdminOrderHistoryEntryDto] })
  history!: AdminOrderHistoryEntryDto[];

  @ApiProperty({ type: Boolean })
  historyTruncated!: boolean;
}

export class AdminOrderTransitionDto {
  @ApiProperty({ type: String, enum: ORDER_STATUSES })
  from!: string;

  @ApiProperty({ type: String, enum: ORDER_STATUSES })
  to!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;

  @ApiProperty({ type: Boolean })
  replayed!: boolean;

  @ApiProperty({ type: Boolean })
  appliedByMe!: boolean;
}

export class AdminOrderTransitionResultDto {
  @ApiProperty({ type: AdminOrderSummaryDto })
  order!: AdminOrderSummaryDto;

  @ApiProperty({ type: AdminOrderTransitionDto })
  transition!: AdminOrderTransitionDto;

  @ApiProperty({ type: [String], enum: ['payment_review', 'delivery_cancellation'] })
  pendingActions!: ('payment_review' | 'delivery_cancellation')[];
}
