import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MONEY_INPUT_MESSAGE, MONEY_INPUT_PATTERN, ZONE_LABEL_INPUT_MAX } from '../zone-policy.js';

const MONEY_PATTERN_SOURCE = '^(0|[1-9][0-9]{0,4})(\\.[0-9]{1,2})?$';

/** La forma se valida aquí; la normalización de `zoneLabel` y la aritmética de `baseFee` viven en `zone-policy`. */
export class CreateDeliveryZoneRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  municipalityId!: string;

  // El límite de 60 caracteres se aplica DESPUÉS de normalizar (zone-policy); aquí solo un tope de payload.
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 60,
    description:
      'Máx. 60 caracteres tras normalizar. `null`, ausente o en blanco = cobertura general del municipio.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ZONE_LABEL_INPUT_MAX)
  zoneLabel?: string | null;

  @ApiProperty({ type: String, pattern: MONEY_PATTERN_SOURCE, example: '15.00' })
  @IsString()
  @Matches(MONEY_INPUT_PATTERN, { message: MONEY_INPUT_MESSAGE })
  baseFee!: string;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDeliveryZoneRequest {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(ZONE_LABEL_INPUT_MAX)
  zoneLabel?: string | null;

  @ApiPropertyOptional({ type: String, pattern: MONEY_PATTERN_SOURCE })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(MONEY_INPUT_PATTERN, { message: MONEY_INPUT_MESSAGE })
  baseFee?: string;
}

export class UpdateDeliveryZoneStatusRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiPropertyOptional({ type: String, maxLength: 200 })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class UpdateBranchDeliverySettingsRequest {
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  ownDeliveryZonesEnabled?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  pedidosyaEnabled?: boolean;
}

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export const ZONE_SORTS = ['municipality', 'baseFee', 'createdAt'] as const;

export class ListDeliveryZonesQuery {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  municipalityId?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Sin valor = todas.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: String, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ type: String, enum: ZONE_SORTS, default: 'municipality' })
  @IsOptional()
  @IsIn(ZONE_SORTS)
  sort?: (typeof ZONE_SORTS)[number];

  @ApiPropertyOptional({ type: String, enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 10000, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class DeliveryCoverageCheckRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  municipalityId!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 60,
    description: 'Zona opcional (texto libre; se normaliza igual que `zoneLabel`).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ZONE_LABEL_INPUT_MAX)
  zone?: string | null;
}
