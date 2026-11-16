import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  DESCRIPTION_MAX,
  MAX_CATEGORIES,
  NAME_MAX,
  SLUG_MAX,
  SLUG_PATTERN,
} from '../category-policy.js';

/**
 * La forma (tipos, longitudes máximas) se valida aquí; la normalización (NFC, recorte, colapso de espacios) y las
 * reglas de dominio viven en `category-policy.ts`.
 */
export class CreateCategoryRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: SLUG_MAX,
    pattern: SLUG_PATTERN.source,
    description: 'Opcional: si falta se genera desde `name` y se desambigua.',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(SLUG_MAX)
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;
}

/** Campos desconocidos => 400 (`forbidNonWhitelisted`); cuerpo sin campos => 400 (policy). */
export class UpdateCategoryRequest {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: NAME_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ type: String, maxLength: SLUG_MAX, pattern: SLUG_PATTERN.source })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(SLUG_MAX)
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class ReorderCategoriesRequest {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentId!: string | null;

  @ApiProperty({ type: [String], maxItems: MAX_CATEGORIES })
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES)
  @IsUUID('all', { each: true })
  orderedIds!: string[];
}

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListAdminCategoriesQuery {
  @ApiPropertyOptional({ type: Boolean, description: 'Sin valor = todas.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Solo hijos directos.' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ type: String, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
