import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
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
  MinLength,
} from 'class-validator';
import { INSTANT_PATTERN } from '../../../branch-schedule/business-time.js';
import { ORDER_STATUSES } from '../order-transition.matrix.js';

export const ADMIN_LIST_DEFAULT_LIMIT = 25;
export const ADMIN_BOARD_DEFAULT_LIMIT = 30;
export const ADMIN_REASON_MIN = 3;
export const ADMIN_REASON_MAX = 280;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
/** `a,b` -> `['a','b']`; un valor repetido (`?status=a&status=b`) también se acepta. */
const csv = ({ value }: { value: unknown }): unknown => {
  const parts: unknown[] | null = Array.isArray(value)
    ? (value as unknown[])
    : typeof value === 'string'
      ? value.split(',')
      : null;
  return parts ? parts.map((p: unknown): unknown => (typeof p === 'string' ? p.trim() : p)) : value;
};

export class ListAdminOrdersQuery {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @ApiPropertyOptional({ type: [String], enum: ORDER_STATUSES })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMaxSize(9)
  @ArrayUnique()
  @IsIn(ORDER_STATUSES, { each: true })
  status?: string[];

  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 40 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  q?: string;

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

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 50, default: ADMIN_LIST_DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class BoardAdminOrdersQuery {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 50,
    default: ADMIN_BOARD_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AdminOrderCommandRequest {
  @ApiProperty({ type: String, enum: ORDER_STATUSES })
  @IsIn(ORDER_STATUSES)
  expectedStatus!: string;
}

/**
 * `reject` y `cancel`. `reason` es OPCIONAL a nivel de forma a propósito: ausente/vacío/corto es `ORDER_REASON_REQUIRED`
 * (400 con código estable) y lo decide el servicio tras recortar; un tipo no cadena es un 400 de validación estándar.
 */
export class AdminOrderReasonRequest extends AdminOrderCommandRequest {
  @ApiProperty({ type: String, minLength: ADMIN_REASON_MIN, maxLength: ADMIN_REASON_MAX })
  @IsOptional()
  @IsString()
  reason?: string;
}
