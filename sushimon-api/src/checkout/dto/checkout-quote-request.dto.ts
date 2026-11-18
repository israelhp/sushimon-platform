import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  ValidateIf,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_LINE_QUANTITY } from '../checkout-policy.js';

/**
 * Cuerpo de `POST /v1/checkout/quote` (contrato: `CheckoutQuoteRequest`). Lista blanca estricta en TODOS los niveles
 * (`forbidNonWhitelisted` global + `@ValidateNested`/`@Type`): cualquier propiedad de precio, tarifa, descuento o total
 * => 400. NO hay `@ArrayMaxSize` en `lines`/`selections`: los topes de cantidad de la cotización se aplican en
 * `assertQuoteLimits` para responder 400 `QUOTE_LIMITS_EXCEEDED` (código estable), no un 400 genérico.
 */

const MONEY = /^[0-9]{1,9}\.[0-9]{2}$/;

/**
 * Opcional SIN admitir `null`: solo se omite el campo AUSENTE. (`@IsOptional()` también deja pasar `null`, que llegaría a
 * los servicios como valor inesperado.) `null` solo se permite donde el contrato lo declara nullable (`zone`).
 */
const OptionalNotNull = (): PropertyDecorator => ValidateIf((_o, v) => v !== undefined);

export class CartSelectionInputDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('all', { message: 'groupId: debe ser un UUID' })
  groupId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('all', { message: 'optionId: debe ser un UUID' })
  optionId!: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 1 })
  @IsInt({ message: 'quantity: debe ser entero' })
  @Min(1, { message: 'quantity: debe ser 1' })
  @Max(1, { message: 'quantity: debe ser 1' })
  quantity!: number;
}

export class CartLineInputDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('all', { message: 'productId: debe ser un UUID' })
  productId!: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: MAX_LINE_QUANTITY })
  @IsInt({ message: 'quantity: debe ser entero' })
  @Min(1, { message: 'quantity: mínimo 1' })
  @Max(MAX_LINE_QUANTITY, { message: `quantity: máximo ${MAX_LINE_QUANTITY}` })
  quantity!: number;

  @ApiProperty({ type: [CartSelectionInputDto] })
  @IsArray({ message: 'selections: debe ser un arreglo' })
  @ValidateNested({ each: true })
  @Type(() => CartSelectionInputDto)
  selections!: CartSelectionInputDto[];
}

export class CartQuoteInputDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('all', { message: 'branchId: debe ser un UUID' })
  branchId!: string;

  @ApiProperty({ type: [CartLineInputDto], minItems: 1, maxItems: 30 })
  @IsArray({ message: 'lines: debe ser un arreglo' })
  @ArrayMinSize(1, { message: 'lines: al menos una línea' })
  @ValidateNested({ each: true })
  @Type(() => CartLineInputDto)
  lines!: CartLineInputDto[];
}

export class CheckoutFulfillmentInputDto {
  @ApiProperty({ type: String, enum: ['PICKUP', 'DELIVERY'] })
  @IsIn(['PICKUP', 'DELIVERY'], { message: 'type: debe ser PICKUP o DELIVERY' })
  type!: 'PICKUP' | 'DELIVERY';

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @OptionalNotNull()
  @IsUUID('all', { message: 'customerAddressId: debe ser un UUID' })
  customerAddressId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @OptionalNotNull()
  @IsUUID('all', { message: 'municipalityId: debe ser un UUID' })
  municipalityId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @IsString({ message: 'zone: debe ser texto o null' })
  @MaxLength(60, { message: 'zone: máximo 60 caracteres' })
  zone?: string | null;

  @ApiPropertyOptional({ type: String, enum: ['PEDIDOSYA', 'OWN'] })
  @OptionalNotNull()
  @IsIn(['PEDIDOSYA', 'OWN'], { message: 'deliveryProvider: debe ser PEDIDOSYA u OWN' })
  deliveryProvider?: 'PEDIDOSYA' | 'OWN';
}

export class CheckoutClientLineViewDto {
  @ApiProperty({ type: Number, minimum: 0, maximum: 29 })
  @IsInt({ message: 'index: debe ser entero' })
  @Min(0, { message: 'index: mínimo 0' })
  @Max(29, { message: 'index: máximo 29' })
  index!: number;

  @ApiProperty({ type: String, example: '85.00' })
  @IsString({ message: 'unitPrice: debe ser texto' })
  @Matches(MONEY, { message: 'unitPrice: formato decimal de 2 posiciones' })
  unitPrice!: string;
}

export class CheckoutClientViewDto {
  @ApiPropertyOptional({ type: [CheckoutClientLineViewDto], maxItems: 30 })
  @OptionalNotNull()
  @IsArray({ message: 'lines: debe ser un arreglo' })
  @ArrayMaxSize(30, { message: 'lines: máximo 30' })
  @ValidateNested({ each: true })
  @Type(() => CheckoutClientLineViewDto)
  lines?: CheckoutClientLineViewDto[];

  @ApiPropertyOptional({ type: String, example: '170.00' })
  @OptionalNotNull()
  @IsString({ message: 'total: debe ser texto' })
  @Matches(MONEY, { message: 'total: formato decimal de 2 posiciones' })
  total?: string;
}

export class CheckoutQuoteRequestDto {
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

  @ApiPropertyOptional({ type: CheckoutClientViewDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => CheckoutClientViewDto)
  clientView?: CheckoutClientViewDto;
}
