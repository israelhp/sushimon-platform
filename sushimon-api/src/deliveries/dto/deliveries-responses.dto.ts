import { ApiProperty } from '@nestjs/swagger';
import { ORDER_STATUSES } from '../../orders/admin/order-transition.matrix.js';
import { DELIVERY_EVENTS, DELIVERY_STATUSES } from '../delivery-policy.js';

/** Esquemas de respuesta de `/v1/admin/deliveries` (contrato: `AdminDelivery*`; F28). Sin datos del cliente salvo `AdminDelivery`. */
const VEHICLES = ['MOTORCYCLE', 'BICYCLE', 'CAR', 'ON_FOOT'];
const ACTIONS = [
  'assign_rider',
  'reassign_rider',
  'unassign_rider',
  'mark_picked_up',
  'mark_delivered',
  'return_to_branch',
  'cancel',
];

export class AdminDeliveryActionStateDto {
  @ApiProperty({ type: String, enum: ACTIONS })
  action!: string;
  @ApiProperty({ type: Boolean })
  enabled!: boolean;
  @ApiProperty({ type: String, enum: ['NO_PERMISSION', 'ORDER_NOT_READY'], nullable: true })
  disabledReason!: string | null;
}

export class AdminDeliveryRiderDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: String, enum: VEHICLES, nullable: true })
  vehicleType!: string | null;
  @ApiProperty({ type: String, example: '+502****5678' })
  phoneMasked!: string;
}

export class AdminDeliveryOrderRefDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;
  @ApiProperty({ type: String, enum: ORDER_STATUSES })
  status!: string;
  @ApiProperty({ type: String, enum: ['OWN', 'PEDIDOSYA'], nullable: true })
  deliveryProvider!: string | null;
}

export class AdminDeliveryAddressDto {
  @ApiProperty({ type: String })
  municipalityName!: string;
  @ApiProperty({ type: String, nullable: true })
  zone!: string | null;
  @ApiProperty({ type: String })
  addressLine!: string;
  @ApiProperty({ type: String, nullable: true })
  referenceNote!: string | null;
}

export class AdminDeliveryCustomerDto {
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, example: '+50255501122' })
  phone!: string;
}

export class AdminDeliverySummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  orderId!: string;
  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;
  @ApiProperty({ type: String })
  branchName!: string;
  @ApiProperty({ type: String, enum: DELIVERY_STATUSES })
  status!: string;
  @ApiProperty({ type: String, enum: ORDER_STATUSES })
  orderStatus!: string;
  @ApiProperty({ type: String, nullable: true })
  municipalityName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  zone!: string | null;
  @ApiProperty({ type: AdminDeliveryRiderDto, nullable: true })
  rider!: AdminDeliveryRiderDto | null;
  @ApiProperty({ type: Boolean })
  riderOccupied!: boolean;
  @ApiProperty({ type: Boolean })
  awaitingReturn!: boolean;
  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  assignedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pickedUpAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  returnedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
  @ApiProperty({ type: [AdminDeliveryActionStateDto] })
  availableActions!: AdminDeliveryActionStateDto[];
}

export class AdminDeliveryHistoryEntryDto {
  @ApiProperty({ type: String, enum: DELIVERY_EVENTS })
  event!: string;
  @ApiProperty({ type: String, enum: DELIVERY_STATUSES, nullable: true })
  oldStatus!: string | null;
  @ApiProperty({ type: String, enum: DELIVERY_STATUSES })
  status!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  riderId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  riderName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  actorName!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;
}

export class AdminDeliveryDto extends AdminDeliverySummaryDto {
  @ApiProperty({ type: AdminDeliveryOrderRefDto })
  order!: AdminDeliveryOrderRefDto;
  @ApiProperty({ type: Boolean })
  contactVisible!: boolean;
  @ApiProperty({ type: AdminDeliveryCustomerDto, nullable: true })
  customer!: AdminDeliveryCustomerDto | null;
  @ApiProperty({ type: AdminDeliveryAddressDto, nullable: true })
  address!: AdminDeliveryAddressDto | null;
  @ApiProperty({ type: [AdminDeliveryHistoryEntryDto] })
  history!: AdminDeliveryHistoryEntryDto[];
  @ApiProperty({ type: Boolean })
  historyTruncated!: boolean;
}

export class AdminDeliveryPageDto {
  @ApiProperty({ type: [AdminDeliverySummaryDto] })
  items!: AdminDeliverySummaryDto[];
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;
}

export class AdminDeliveryTransitionDto {
  @ApiProperty({ type: String, enum: DELIVERY_STATUSES, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, enum: DELIVERY_STATUSES })
  to!: string;
  @ApiProperty({ type: String, enum: DELIVERY_EVENTS })
  event!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;
  @ApiProperty({ type: Boolean })
  replayed!: boolean;
  @ApiProperty({ type: Boolean })
  appliedByMe!: boolean;
}

export class AdminDeliveryCommandResultDto {
  @ApiProperty({ type: AdminDeliverySummaryDto })
  delivery!: AdminDeliverySummaryDto;
  @ApiProperty({ type: AdminDeliveryTransitionDto })
  transition!: AdminDeliveryTransitionDto;
}
