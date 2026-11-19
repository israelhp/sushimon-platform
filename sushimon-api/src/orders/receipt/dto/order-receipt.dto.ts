import { ApiProperty } from '@nestjs/swagger';
import {
  OrderDetailAddressDto,
  OrderDetailContactDto,
  OrderDetailLineDto,
  OrderDetailPaymentDto,
  OrderDetailPromotionDto,
} from '../../dto/order-responses.dto.js';

/** Esquemas de `GET /v1/orders/{id}/receipt` (contrato F23: `OrderReceipt`). Importes: cadenas `"85.00"` en GTQ. */

export class OrderReceiptBranchDto {
  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  address!: string;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
}

export class OrderReceiptFulfillmentDto {
  @ApiProperty({ type: String, enum: ['PICKUP', 'DELIVERY'] })
  type!: 'PICKUP' | 'DELIVERY';

  @ApiProperty({ type: String, enum: ['OWN', 'PEDIDOSYA'], nullable: true })
  provider!: 'OWN' | 'PEDIDOSYA' | null;
}

export class OrderReceiptDto {
  @ApiProperty({ type: String, enum: ['NOT_FISCAL'] })
  fiscalStatus!: 'NOT_FISCAL';

  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String })
  publicStatus!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: String, enum: ['America/Guatemala'] })
  timeZone!: 'America/Guatemala';

  @ApiProperty({ type: String, enum: ['GTQ'] })
  currency!: 'GTQ';

  @ApiProperty({ type: OrderReceiptBranchDto })
  branch!: OrderReceiptBranchDto;

  @ApiProperty({ type: OrderReceiptFulfillmentDto })
  fulfillment!: OrderReceiptFulfillmentDto;

  @ApiProperty({ type: OrderDetailAddressDto, nullable: true })
  address!: OrderDetailAddressDto | null;

  @ApiProperty({ type: OrderDetailContactDto })
  contact!: OrderDetailContactDto;

  @ApiProperty({ type: [OrderDetailLineDto] })
  lines!: OrderDetailLineDto[];

  @ApiProperty({ type: [OrderDetailPromotionDto] })
  promotions!: OrderDetailPromotionDto[];

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

  @ApiProperty({ type: String })
  total!: string;

  @ApiProperty({ type: OrderDetailPaymentDto })
  payment!: OrderDetailPaymentDto;
}
