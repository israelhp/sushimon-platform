import { ApiProperty } from '@nestjs/swagger';

/** Esquemas de respuesta de `/v1/orders` (contrato: `OrderDetail`, `OrderCreated`…). Importes: cadenas `"85.00"` en GTQ. */

export class OrderDetailModifierDto {
  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, example: '5.00' })
  extraPrice!: string;
}

export class OrderDetailLineDto {
  @ApiProperty({ type: String })
  productName!: string;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: String })
  unitPrice!: string;

  @ApiProperty({ type: [OrderDetailModifierDto] })
  modifiers!: OrderDetailModifierDto[];

  @ApiProperty({ type: String })
  extrasPerUnit!: string;

  @ApiProperty({ type: String })
  lineSubtotal!: string;

  @ApiProperty({ type: String })
  discount!: string;

  @ApiProperty({ type: String })
  lineTotal!: string;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
}

export class OrderDetailPromotionDto {
  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  amount!: string;
}

export class OrderDetailAddressDto {
  @ApiProperty({ type: String })
  municipalityName!: string;

  @ApiProperty({ type: String, nullable: true })
  zone!: string | null;

  @ApiProperty({ type: String })
  addressLine!: string;

  @ApiProperty({ type: String, nullable: true })
  referenceNote!: string | null;
}

export class OrderDetailContactDto {
  @ApiProperty({ type: String })
  fullName!: string;

  @ApiProperty({ type: String, example: '****1234' })
  phoneMasked!: string;
}

/** Pago con vocabulario PÚBLICO (F24): siempre efectivo; sin empleado, historial ni auditoría. */
export class OrderDetailPaymentDto {
  @ApiProperty({ type: String, enum: ['CASH'] })
  method!: 'CASH';

  @ApiProperty({ type: String, enum: ['PENDING', 'PAID'] })
  status!: 'PENDING' | 'PAID';

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt!: string | null;
}

export class OrderDetailDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: Number, format: 'int64' })
  orderNumber!: number;

  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;

  @ApiProperty({ type: String, enum: ['PICKUP', 'DELIVERY'] })
  fulfillmentType!: 'PICKUP' | 'DELIVERY';

  @ApiProperty({ type: String, enum: ['OWN', 'PEDIDOSYA'], nullable: true })
  deliveryProvider!: 'OWN' | 'PEDIDOSYA' | null;

  @ApiProperty({ type: String, enum: ['GTQ'] })
  currency!: 'GTQ';

  @ApiProperty({ type: [OrderDetailLineDto] })
  lines!: OrderDetailLineDto[];

  @ApiProperty({ type: [OrderDetailPromotionDto] })
  promotions!: OrderDetailPromotionDto[];

  @ApiProperty({ type: OrderDetailAddressDto, nullable: true })
  address!: OrderDetailAddressDto | null;

  @ApiProperty({ type: OrderDetailContactDto })
  contact!: OrderDetailContactDto;

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

  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class OrderGuestAccessDto {
  @ApiProperty({ type: String, pattern: '^smo_[A-Za-z0-9_-]{43}$' })
  guestToken!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

export class OrderCreatedDto {
  @ApiProperty({ type: OrderDetailDto })
  order!: OrderDetailDto;

  @ApiProperty({ type: OrderGuestAccessDto, nullable: true })
  access!: OrderGuestAccessDto | null;
}
