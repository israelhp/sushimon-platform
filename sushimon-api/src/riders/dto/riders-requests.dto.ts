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
import { PHONE_RE, REASON_MAX } from '../rider-policy.js';
import { RIDER_VEHICLE_TYPES } from '../riders.types.js';

/**
 * La FORMA se valida aquí (`whitelist` + `forbidNonWhitelisted` global: `active`, `availability`, `version`, `name_key` y
 * cualquier campo desconocido => 400). Normalización y reglas de dominio viven en `rider-policy.ts`.
 */
const VEHICLES = [...RIDER_VEHICLE_TYPES];
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateRiderRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ type: String, minLength: 2, maxLength: 80 })
  @IsString()
  @MaxLength(200)
  fullName!: string;

  @ApiProperty({ type: String, pattern: '^\\+502[0-9]{8}$' })
  @IsString()
  @Matches(PHONE_RE)
  phone!: string;

  @ApiPropertyOptional({ type: String, enum: VEHICLES, nullable: true })
  @IsOptional()
  @IsIn(VEHICLES)
  vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR' | 'ON_FOOT' | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 12 })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  licensePlate?: string | null;
}

export class UpdateRiderRequest {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 80 })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional({ type: String, pattern: '^\\+502[0-9]{8}$' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(PHONE_RE)
  phone?: string;

  @ApiPropertyOptional({ type: String, enum: VEHICLES, nullable: true })
  @IsOptional()
  @IsIn(VEHICLES)
  vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR' | 'ON_FOOT' | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 12 })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  licensePlate?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  branchId?: string;
}

export class UpdateRiderStatusRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiPropertyOptional({ type: String, maxLength: REASON_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(REASON_MAX)
  reason?: string;
}

export class UpdateRiderAvailabilityRequest {
  @ApiProperty({ type: String, enum: ['AVAILABLE', 'UNAVAILABLE'] })
  @IsIn(['AVAILABLE', 'UNAVAILABLE'])
  availability!: 'AVAILABLE' | 'UNAVAILABLE';
}

export class ListAdminRidersQuery {
  @ApiPropertyOptional({ type: String, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: String, enum: ['AVAILABLE', 'UNAVAILABLE', 'BUSY'] })
  @IsOptional()
  @IsIn(['AVAILABLE', 'UNAVAILABLE', 'BUSY'])
  availability?: 'AVAILABLE' | 'UNAVAILABLE' | 'BUSY';

  @ApiPropertyOptional({
    type: String,
    enum: ['fullName', 'createdAt', 'updatedAt'],
    default: 'fullName',
  })
  @IsOptional()
  @IsIn(['fullName', 'createdAt', 'updatedAt'])
  sort?: 'fullName' | 'createdAt' | 'updatedAt';

  @ApiPropertyOptional({ type: String, enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

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
