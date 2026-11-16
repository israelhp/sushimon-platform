import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsArray,
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
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  PRICE_PATTERN,
  SEARCH_MAX,
  SKU_MAX,
  SLUG_MAX,
  SLUG_PATTERN,
} from '../product-policy.js';

/** Forma del SKU aceptada en la entrada (se guarda en mayúsculas). */
const SKU_INPUT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Imagen referenciada. La URL (https, ≤ 2048, sin espacios) y `altText` (≤ 200) se validan en la policy y fallan con 422
 * `PRODUCT_MEDIA_INVALID` (no 400): por eso aquí solo se exige la FORMA (cadena / cadena o null).
 */
export class ProductMediaInputDto {
  @ApiProperty({ type: String, description: 'URL https absoluta, ≤ 2048 caracteres.' })
  @IsString()
  url!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  altText?: string | null;
}

/** La forma (tipos, longitudes máximas) se valida aquí; la normalización y las reglas de dominio, en `product-policy.ts`. */
export class CreateProductRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ type: String, maxLength: SLUG_MAX, pattern: SLUG_PATTERN.source })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(SLUG_MAX)
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiPropertyOptional({ type: String, nullable: true, minLength: 1, maxLength: SKU_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(SKU_MAX)
  @Matches(SKU_INPUT_PATTERN)
  sku?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  @ApiProperty({ type: String, pattern: PRICE_PATTERN.source, example: '85.00' })
  @IsString()
  @Matches(PRICE_PATTERN)
  basePrice!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: () => [ProductMediaInputDto] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductMediaInputDto)
  media?: ProductMediaInputDto[];
}

/** Campos desconocidos => 400 (`forbidNonWhitelisted`); cuerpo sin campos => 400 (policy). */
export class UpdateProductRequest {
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

  @ApiPropertyOptional({ type: String, nullable: true, minLength: 1, maxLength: SKU_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(SKU_MAX)
  @Matches(SKU_INPUT_PATTERN)
  sku?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional({ type: String, pattern: PRICE_PATTERN.source })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(PRICE_PATTERN)
  basePrice?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: () => [ProductMediaInputDto],
    description: 'REEMPLAZA la lista completa (`[]` la vacía).',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductMediaInputDto)
  media?: ProductMediaInputDto[];
}

/** Solo dígitos: `''`, `1.5` o `1e2` no se convierten (quedan como string y `@IsInt` los rechaza => 400). */
const toStrictInt = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value;

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 200;

export class PageQuery {
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

export class ListStoreProductsQuery extends PageQuery {
  @ApiPropertyOptional({ type: String, maxLength: SLUG_MAX, pattern: SLUG_PATTERN.source })
  @IsOptional()
  @IsString()
  @MaxLength(SLUG_MAX)
  @Matches(SLUG_PATTERN)
  categorySlug?: string;

  @ApiPropertyOptional({ type: String, maxLength: SEARCH_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX)
  q?: string;
}

export class ListAdminProductsQuery extends PageQuery {
  @ApiPropertyOptional({ type: String, maxLength: SEARCH_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX)
  q?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Sin valor = todos.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: String, enum: ['name', 'basePrice', 'createdAt'], default: 'name' })
  @IsOptional()
  @IsIn(['name', 'basePrice', 'createdAt'])
  sort?: 'name' | 'basePrice' | 'createdAt';

  @ApiPropertyOptional({ type: String, enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

/** Slug público en la ruta: forma inválida => 400. */
export class ProductSlugParam {
  @ApiProperty({ type: String, maxLength: SLUG_MAX, pattern: SLUG_PATTERN.source })
  @IsString()
  @MaxLength(SLUG_MAX)
  @Matches(SLUG_PATTERN)
  slug!: string;
}
