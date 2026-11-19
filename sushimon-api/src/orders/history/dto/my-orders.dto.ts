import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { INSTANT_PATTERN } from '../../../branch-schedule/business-time.js';
import { ORDER_STATUSES } from '../../admin/order-transition.matrix.js';

export const MY_ORDERS_DEFAULT_LIMIT = 20;
export const MY_ORDERS_MAX_LIMIT = 50;

/** `a,b` -> `['a','b']`; un valor repetido (`?status=a&status=b`) también se acepta (mismo criterio que F22). */
export const csvUnique = ({ value }: { value: unknown }): unknown => {
  const parts: unknown[] | null = Array.isArray(value)
    ? (value as unknown[])
    : typeof value === 'string'
      ? value.split(',')
      : null;
  // Los repetidos se DEDUPLICAN (no es un error): `pending,pending` equivale a `pending`.
  return parts
    ? [...new Set(parts.map((p: unknown): unknown => (typeof p === 'string' ? p.trim() : p)))]
    : value;
};

/** Consulta de `GET /v1/me/orders`. NO existe `customerId`: la lista blanca global lo rechaza (400). */
export class ListMyOrdersQuery {
  @ApiPropertyOptional({ type: String, maxLength: 120, description: 'Estados separados por comas' })
  @IsOptional()
  @Transform(csvUnique)
  @IsArray()
  @ArrayMaxSize(9)
  @IsIn(ORDER_STATUSES, { each: true })
  status?: string[];

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN, { message: 'from debe ser ISO 8601 con zona' })
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN, { message: 'to debe ser ISO 8601 con zona' })
  to?: string;

  @ApiPropertyOptional({ type: String, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MY_ORDERS_MAX_LIMIT,
    default: MY_ORDERS_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MY_ORDERS_MAX_LIMIT)
  limit?: number;
}

export class MyOrderSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: Number, format: 'int64' })
  orderNumber!: number;

  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String })
  publicStatus!: string;

  @ApiProperty({ type: Boolean })
  terminal!: boolean;

  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;

  @ApiProperty({ type: String })
  branchName!: string;

  @ApiProperty({ type: String, enum: ['PICKUP', 'DELIVERY'] })
  fulfillmentType!: 'PICKUP' | 'DELIVERY';

  @ApiProperty({ type: String, enum: ['OWN', 'PEDIDOSYA'], nullable: true })
  deliveryProvider!: 'OWN' | 'PEDIDOSYA' | null;

  @ApiProperty({ type: Number, description: 'Unidades (suma de cantidades)' })
  itemCount!: number;

  @ApiProperty({ type: String, example: '165.00' })
  total!: string;

  @ApiProperty({ type: String, enum: ['GTQ'] })
  currency!: 'GTQ';

  @ApiProperty({ type: String, enum: ['cash', 'bank_transfer'], nullable: true })
  paymentMethodPreference!: 'cash' | 'bank_transfer' | null;

  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class MyOrderPageDto {
  @ApiProperty({ type: [MyOrderSummaryDto] })
  items!: MyOrderSummaryDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;
}
