import { ApiProperty } from '@nestjs/swagger';
import { OrderDetailPaymentDto } from './order-responses.dto.js';

/** Esquemas de respuesta de `GET /v1/orders/{id}/tracking` (contrato: `OrderTracking*`, `OrderPublicStatus`; F21, spec 022). */

export const ORDER_PUBLIC_STATUSES = [
  'received',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type OrderPublicStatusCode = (typeof ORDER_PUBLIC_STATUSES)[number];

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

export class OrderTrackingStepDto {
  @ApiProperty({ type: String, enum: ORDER_PUBLIC_STATUSES })
  phase!: OrderPublicStatusCode;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reachedAt!: string | null;
}

export class OrderTrackingEventDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 50 })
  seq!: number;

  @ApiProperty({ type: String, enum: LIFECYCLE_STATUSES })
  status!: string;

  @ApiProperty({ type: String, enum: ORDER_PUBLIC_STATUSES })
  publicStatus!: OrderPublicStatusCode;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;
}

export class OrderTrackingDeliveryDto {
  @ApiProperty({ type: String, enum: ['OWN', 'PEDIDOSYA'] })
  provider!: 'OWN' | 'PEDIDOSYA';

  @ApiProperty({ type: String, nullable: true, description: 'Reservado F28/F29; siempre null.' })
  status!: string | null;
}

export class OrderTrackingDto {
  @ApiProperty({ type: String, format: 'uuid' })
  orderId!: string;

  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;

  @ApiProperty({ type: String, enum: ['PICKUP', 'DELIVERY'] })
  fulfillmentType!: 'PICKUP' | 'DELIVERY';

  @ApiProperty({ type: String, enum: LIFECYCLE_STATUSES })
  status!: string;

  @ApiProperty({ type: String, enum: ORDER_PUBLIC_STATUSES })
  publicStatus!: OrderPublicStatusCode;

  @ApiProperty({ type: Boolean })
  terminal!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: [OrderTrackingStepDto], maxItems: 8 })
  steps!: OrderTrackingStepDto[];

  @ApiProperty({ type: [OrderTrackingEventDto], maxItems: 50 })
  events!: OrderTrackingEventDto[];

  @ApiProperty({ type: Boolean })
  eventsTruncated!: boolean;

  @ApiProperty({ type: OrderTrackingDeliveryDto, nullable: true })
  delivery!: OrderTrackingDeliveryDto | null;

  @ApiProperty({
    type: OrderDetailPaymentDto,
    description:
      'F24: método y estado de pago reales (efectivo `PENDING|PAID`); independiente del estado del pedido y fuera del timeline.',
  })
  payment!: OrderDetailPaymentDto;

  @ApiProperty({ type: Number, minimum: 5, maximum: 300, nullable: true })
  pollAfterSeconds!: number | null;
}
