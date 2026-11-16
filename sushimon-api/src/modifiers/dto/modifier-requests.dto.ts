import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EXTRA_PRICE_PATTERN, NAME_MAX } from '../modifier-policy.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 200;
const SEARCH_MAX = 80;

/** Solo dígitos: `''`, `1.5` o `1e2` no se convierten (quedan como string y `@IsInt` los rechaza => 400). */
const toStrictInt = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value;

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

const PRICE_DOC = { type: String, pattern: EXTRA_PRICE_PATTERN.source, example: '5.00' } as const;

export class ListModifierGroupsQuery {
  @ApiPropertyOptional({ type: String, maxLength: SEARCH_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX)
  q?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Sin valor = todos.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: MAX_PAGE, default: 1 })
  @IsOptional()
  @Transform(toStrictInt)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Transform(toStrictInt)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

export class ModifierOptionInputDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiPropertyOptional(PRICE_DOC)
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(EXTRA_PRICE_PATTERN)
  extraPrice?: string;
}

/** Solo la FORMA (tipos); rangos y relación de min/max => 422 en la policy. */
export class CreateModifierGroupRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ type: Number, description: 'Por defecto 0.' })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  minSelect?: number;

  @ApiPropertyOptional({ type: Number, description: 'Por defecto 1.' })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  maxSelect?: number;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: () => [ModifierOptionInputDto] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ModifierOptionInputDto)
  options?: ModifierOptionInputDto[];
}

export class UpdateModifierGroupRequest {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: NAME_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  minSelect?: number;

  @ApiPropertyOptional({ type: Number })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  maxSelect?: number;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class CreateModifierRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiPropertyOptional(PRICE_DOC)
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(EXTRA_PRICE_PATTERN)
  extraPrice?: string;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class UpdateModifierRequest {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: NAME_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name?: string;

  @ApiPropertyOptional(PRICE_DOC)
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(EXTRA_PRICE_PATTERN)
  extraPrice?: string;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class ReorderModifiersRequest {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 30 })
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID(undefined, { each: true })
  orderedIds!: string[];
}

export class ReplaceProductModifierGroupsRequest {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  groupIds!: string[];
}
