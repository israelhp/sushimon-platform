import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CartQuoteInputDto,
  CheckoutFulfillmentInputDto,
} from '../../checkout/dto/checkout-quote-request.dto.js';

/**
 * Cuerpo de `POST /v1/orders` (contrato: `OrderCreateRequest`). Lista blanca estricta en TODOS los niveles
 * (`forbidNonWhitelisted` global): cualquier campo económico (`price`, `total`, `deliveryFee`, `discount`), de estado
 * (`status`, `paid`), de cobertura o de identidad (`customerId`) => 400. Opcionales SIN `null` (`OptionalNotNull`).
 */
const OptionalNotNull = (): PropertyDecorator => ValidateIf((_o, v) => v !== undefined);

/**
 * F24 (spec 025, ADR-0030): SOLO efectivo. `bank_transfer`, `card` y cualquier otro valor => 400 de validación (el 422
 * `PAYMENT_METHOD_UNAVAILABLE` de F20 queda retirado). Ausente => se guarda `NULL` (el pago es efectivo igualmente).
 */
export const PAYMENT_PREFERENCES = ['cash'] as const;

export class OrderContactInputDto {
  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 120 })
  @OptionalNotNull()
  @IsString({ message: 'contact.fullName: debe ser texto' })
  @MaxLength(120, { message: 'contact.fullName: máximo 120 caracteres' })
  fullName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 20, example: '+502 5555 1234' })
  @OptionalNotNull()
  @IsString({ message: 'contact.phone: debe ser texto' })
  @MaxLength(20, { message: 'contact.phone: máximo 20 caracteres' })
  phone?: string;

  @ApiPropertyOptional({ type: String, format: 'email', maxLength: 254 })
  @OptionalNotNull()
  @IsString({ message: 'contact.email: debe ser texto' })
  @MaxLength(254, { message: 'contact.email: máximo 254 caracteres' })
  @IsEmail({}, { message: 'contact.email: correo inválido' })
  email?: string;
}

export class OrderDeliveryAddressInputDto {
  @ApiProperty({ type: String, minLength: 5, maxLength: 200 })
  @IsString({ message: 'deliveryAddress.addressLine: debe ser texto' })
  @MinLength(5, { message: 'deliveryAddress.addressLine: mínimo 5 caracteres' })
  @MaxLength(200, { message: 'deliveryAddress.addressLine: máximo 200 caracteres' })
  addressLine!: string;

  @ApiPropertyOptional({ type: String, maxLength: 200 })
  @OptionalNotNull()
  @IsString({ message: 'deliveryAddress.referenceNote: debe ser texto' })
  @MaxLength(200, { message: 'deliveryAddress.referenceNote: máximo 200 caracteres' })
  referenceNote?: string;
}

export class OrderCreateRequestDto {
  @ApiProperty({ type: CartQuoteInputDto })
  @IsDefined({ message: 'cart: es obligatorio' })
  @ValidateNested()
  @Type(() => CartQuoteInputDto)
  cart!: CartQuoteInputDto;

  @ApiProperty({ type: CheckoutFulfillmentInputDto })
  @IsDefined({ message: 'fulfillment: es obligatorio' })
  @ValidateNested()
  @Type(() => CheckoutFulfillmentInputDto)
  fulfillment!: CheckoutFulfillmentInputDto;

  @ApiPropertyOptional({ type: String, maxLength: 64 })
  @OptionalNotNull()
  @IsString({ message: 'couponCode: debe ser texto' })
  @MaxLength(64, { message: 'couponCode: máximo 64 caracteres' })
  couponCode?: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 1024 })
  @IsString({ message: 'quoteToken: es obligatorio' })
  @MinLength(1, { message: 'quoteToken: es obligatorio' })
  @MaxLength(1024, { message: 'quoteToken: máximo 1024 caracteres' })
  quoteToken!: string;

  @ApiPropertyOptional({ type: OrderContactInputDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => OrderContactInputDto)
  contact?: OrderContactInputDto;

  @ApiPropertyOptional({ type: OrderDeliveryAddressInputDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => OrderDeliveryAddressInputDto)
  deliveryAddress?: OrderDeliveryAddressInputDto;

  @ApiPropertyOptional({ type: String, maxLength: 280 })
  @OptionalNotNull()
  @IsString({ message: 'notes: debe ser texto' })
  @MaxLength(280, { message: 'notes: máximo 280 caracteres' })
  notes?: string;

  @ApiPropertyOptional({ type: String, enum: PAYMENT_PREFERENCES })
  @OptionalNotNull()
  @IsIn(PAYMENT_PREFERENCES, { message: 'paymentMethodPreference: valor no válido' })
  paymentMethodPreference?: (typeof PAYMENT_PREFERENCES)[number];
}
