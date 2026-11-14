import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { INSTANT_PATTERN } from '../business-time.js';

export const OPENS_AT_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const CLOSES_AT_PATTERN = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;
const VERSION_PATTERN = /^[0-9a-f]{64}$/;
const INSTANT_MESSAGE = 'debe ser un instante ISO 8601 con zona (Z o ±hh:mm)';

/** Intervalo semiabierto `[opensAt, closesAt)` en hora local. Las reglas de negocio viven en `schedule-policy`. */
export class HoursIntervalDto {
  @ApiProperty({ type: String, pattern: OPENS_AT_PATTERN.source, example: '11:00' })
  @IsString()
  @Matches(OPENS_AT_PATTERN, { message: 'opensAt debe tener formato HH:mm (00:00 a 23:59)' })
  opensAt!: string;

  @ApiProperty({ type: String, pattern: CLOSES_AT_PATTERN.source, example: '24:00' })
  @IsString()
  @Matches(CLOSES_AT_PATTERN, {
    message: 'closesAt debe tener formato HH:mm (00:00 a 23:59) o 24:00',
  })
  closesAt!: string;
}

export class HoursDayDto {
  @ApiProperty({
    type: Number,
    enum: [1, 2, 3, 4, 5, 6, 7],
    description: 'ISO 8601: 1 = lunes … 7 = domingo. NO es `Date.getDay()` (0 = domingo).',
  })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty({
    type: [HoursIntervalDto],
    maxItems: 6,
    description: 'Ordenados por `opensAt` en las respuestas. Vacío = sin atención ese día.',
  })
  @IsArray()
  @ArrayMaxSize(6, { message: 'máximo 6 intervalos por día' })
  @ValidateNested({ each: true })
  @Type(() => HoursIntervalDto)
  intervals!: HoursIntervalDto[];
}

export class ReplaceBranchHoursRequest {
  @ApiProperty({ type: String, pattern: VERSION_PATTERN.source })
  @IsString()
  @Matches(VERSION_PATTERN, { message: 'expectedVersion debe ser un SHA-256 hexadecimal' })
  expectedVersion!: string;

  @ApiProperty({
    type: [HoursDayDto],
    minItems: 7,
    maxItems: 7,
    description: 'Exactamente los 7 `weekday` 1..7, cada uno una vez, en cualquier orden.',
  })
  @IsArray()
  @ArrayMinSize(7, { message: 'days debe incluir los 7 días' })
  @ArrayMaxSize(7, { message: 'days debe incluir los 7 días' })
  @ValidateNested({ each: true })
  @Type(() => HoursDayDto)
  days!: HoursDayDto[];
}

export class CreateBranchClosureRequest {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'ISO 8601 CON zona (`Z` u offset como `-06:00`). Sin zona => 400. Se normaliza a UTC, truncado al segundo.',
  })
  @IsString()
  @Matches(INSTANT_PATTERN, { message: `startsAt ${INSTANT_MESSAGE}` })
  startsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Igual que `startsAt`; debe ser posterior.',
  })
  @IsString()
  @Matches(INSTANT_PATTERN, { message: `endsAt ${INSTANT_MESSAGE}` })
  endsAt!: string;

  // El límite de 200 caracteres se aplica DESPUÉS del trim (closure-policy); aquí solo un tope de payload.
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}

export class UpdateBranchClosureRequest {
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(INSTANT_PATTERN, { message: `startsAt ${INSTANT_MESSAGE}` })
  startsAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(INSTANT_PATTERN, { message: `endsAt ${INSTANT_MESSAGE}` })
  endsAt?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}

export const CLOSURE_STATUS_FILTERS = ['current', 'upcoming', 'active', 'past', 'all'] as const;

export class ListBranchClosuresQuery {
  @ApiPropertyOptional({ type: String, enum: CLOSURE_STATUS_FILTERS, default: 'current' })
  @IsOptional()
  @IsIn(CLOSURE_STATUS_FILTERS)
  status?: (typeof CLOSURE_STATUS_FILTERS)[number];

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Instante ISO 8601 con zona (Z u offset). Requiere `to` mayor si ambos se envían.',
  })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN, { message: `from ${INSTANT_MESSAGE}` })
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Instante ISO 8601 con zona (Z u offset).',
  })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN, { message: `to ${INSTANT_MESSAGE}` })
  to?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 10_000, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
