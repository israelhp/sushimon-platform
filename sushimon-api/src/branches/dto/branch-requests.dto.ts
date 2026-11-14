import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ADDRESS_MAX,
  CODE_MAX,
  CODE_MIN,
  NAME_MAX,
  PHONE_MAX,
  REASON_MAX,
} from '../branch-policy.js';

const coordinate = { allowNaN: false, allowInfinity: false } as const;

/**
 * La forma (tipos, longitudes máximas) se valida aquí; la normalización (trim, minúsculas, colapso de espacios)
 * y las reglas de dominio viven en `branch-policy.ts`.
 */
export class CreateBranchRequest {
  @ApiProperty({ type: String, minLength: CODE_MIN, maxLength: CODE_MAX })
  @IsString()
  @MinLength(CODE_MIN)
  @MaxLength(CODE_MAX)
  code!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: ADDRESS_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(ADDRESS_MAX)
  address!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: PHONE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(PHONE_MAX)
  phone?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber(coordinate)
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber(coordinate)
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** `code`, `active` y `createdAt` no están declarados: `forbidNonWhitelisted` los rechaza (400). */
export class UpdateBranchRequest {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: NAME_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: ADDRESS_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(ADDRESS_MAX)
  address?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: PHONE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(PHONE_MAX)
  phone?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber(coordinate)
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber(coordinate)
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}

export class UpdateBranchStatusRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiPropertyOptional({
    type: String,
    maxLength: REASON_MAX,
    description: 'Obligatorio al desactivar; opcional al activar.',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(REASON_MAX)
  reason?: string;
}

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListAdminBranchesQuery {
  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description: 'Busca por nombre o código (contiene, sin distinguir mayúsculas).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Filtra por estado administrativo.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: String, enum: ['name', 'code', 'createdAt'], default: 'name' })
  @IsOptional()
  @IsIn(['name', 'code', 'createdAt'])
  sort?: 'name' | 'code' | 'createdAt';

  @ApiPropertyOptional({ type: String, enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 1_000_000, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
