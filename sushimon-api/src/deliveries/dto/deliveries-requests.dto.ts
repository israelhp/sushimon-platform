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
} from 'class-validator';
import { INSTANT_PATTERN } from '../../branch-schedule/business-time.js';
import { DELIVERY_STATUSES, REASON_MAX, REASON_MIN } from '../delivery-policy.js';

export const DELIVERY_LIST_DEFAULT_LIMIT = 25;

/** `a,b` -> `['a','b']`; un valor repetido (`?status=a&status=b`) también se acepta. */
const csv = ({ value }: { value: unknown }): unknown => {
  const parts: unknown[] | null = Array.isArray(value)
    ? (value as unknown[])
    : typeof value === 'string'
      ? value.split(',')
      : null;
  return parts ? parts.map((p: unknown): unknown => (typeof p === 'string' ? p.trim() : p)) : value;
};

/**
 * La FORMA se valida aquí (`whitelist` + `forbidNonWhitelisted` global: `riderBranchId`, `status`, `version` y cualquier campo
 * desconocido => 400). Las reglas de dominio (motivo, estados, elegibilidad) viven en `delivery-policy.ts` y los servicios.
 */
export class ListAdminDeliveriesQuery {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    type: [String],
    enum: DELIVERY_STATUSES,
    description: 'Estados separados por comas; por defecto los abiertos.',
  })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsIn(DELIVERY_STATUSES, { each: true })
  status?: string[];

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  riderId?: string;

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
    maximum: 100,
    default: DELIVERY_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateAdminDeliveryRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  orderId!: string;
}

const VERSION_MAX = 2_147_483_647;

export class AdminDeliveryCommandRequest {
  @ApiProperty({
    type: Number,
    minimum: 1,
    description: 'La `version` de la entrega que la persona vio.',
  })
  @IsInt()
  @Min(1)
  @Max(VERSION_MAX)
  expectedVersion!: number;
}

export class AssignOwnRiderRequest extends AdminDeliveryCommandRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  riderId!: string;
}

/**
 * `reason` es OPCIONAL a nivel de forma a propósito (como F22): ausente/corto/con control es `DELIVERY_REASON_REQUIRED` (400 con
 * código estable) y lo decide el servicio tras recortar; un tipo no cadena es un 400 de validación estándar.
 */
export class UnassignRiderRequest extends AdminDeliveryCommandRequest {
  @ApiPropertyOptional({
    type: String,
    minLength: REASON_MIN,
    maxLength: REASON_MAX,
    description: 'Opcional. Texto INTERNO; no incluyas datos personales.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CancelAdminDeliveryRequest extends AdminDeliveryCommandRequest {
  @ApiProperty({
    type: String,
    minLength: REASON_MIN,
    maxLength: REASON_MAX,
    description: 'OBLIGATORIO. Texto INTERNO; no incluyas datos personales.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
