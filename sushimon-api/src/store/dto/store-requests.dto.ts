import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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
} from 'class-validator';
import { BANNER_LOCALES } from '../../banners/banners.types.js';
import { toBoolean, toStrictInt } from '../../products/dto/product-requests.dto.js';
import { SLUG_MAX, SLUG_PATTERN } from '../../products/product-policy.js';
import {
  MENU_MAX_PAGE,
  MENU_MAX_PAGE_SIZE,
  SEARCH_DEFAULT_PAGE_SIZE,
  SEARCH_MAX,
  SEARCH_MAX_PAGE,
  SEARCH_MAX_PAGE_SIZE,
} from '../store-policy.js';

/** Un UUID en mayúsculas es el MISMO recurso: se normaliza para que la clave de caché (URL) sea única. */
const lowerUuid = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

const BRANCH_ID_DOC = { type: String, format: 'uuid' } as const;
const SLUG_DOC = { type: String, maxLength: SLUG_MAX, pattern: SLUG_PATTERN.source } as const;

/** `GET /store/bootstrap`. */
export class StoreBootstrapQuery {
  @ApiPropertyOptional(BRANCH_ID_DOC)
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('all')
  branchId?: string;

  @ApiPropertyOptional({ type: String, enum: BANNER_LOCALES, default: 'es' })
  @IsOptional()
  @IsIn(BANNER_LOCALES)
  locale?: 'es' | 'en';
}

/** `GET /store/products/:slug?branchId=`. */
export class StoreProductDetailQuery {
  @ApiPropertyOptional(BRANCH_ID_DOC)
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('all')
  branchId?: string;
}

/** `GET /store/menu`. */
export class StoreMenuQuery {
  @ApiPropertyOptional(BRANCH_ID_DOC)
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('all')
  branchId?: string;

  @ApiPropertyOptional(SLUG_DOC)
  @IsOptional()
  @IsString()
  @MaxLength(SLUG_MAX)
  @Matches(SLUG_PATTERN)
  categorySlug?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: '`true` = solo disponibles (exige `branchId`). `false` o ausente = todos.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ type: String, enum: ['menu', 'name', 'price'], default: 'menu' })
  @IsOptional()
  @IsIn(['menu', 'name', 'price'])
  sort?: 'menu' | 'name' | 'price';

  @ApiPropertyOptional({ type: String, enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: MENU_MAX_PAGE, default: 1 })
  @IsOptional()
  @Transform(toStrictInt)
  @IsInt()
  @Min(1)
  @Max(MENU_MAX_PAGE)
  page?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: MENU_MAX_PAGE_SIZE, default: 100 })
  @IsOptional()
  @Transform(toStrictInt)
  @IsInt()
  @Min(1)
  @Max(MENU_MAX_PAGE_SIZE)
  pageSize?: number;
}

/** `GET /store/search`. `q` se normaliza y valida en la policy (recorte, 2..80, sin control/bidi/invisibles). */
export class StoreSearchQuery {
  @ApiProperty({ type: String, minLength: 2, maxLength: SEARCH_MAX })
  @IsString()
  @MaxLength(4 * SEARCH_MAX) // cota barata antes de normalizar; el límite real (80 tras recortar) lo aplica la policy
  q!: string;

  @ApiPropertyOptional(BRANCH_ID_DOC)
  @IsOptional()
  @Transform(lowerUuid)
  @IsUUID('all')
  branchId?: string;

  @ApiPropertyOptional(SLUG_DOC)
  @IsOptional()
  @IsString()
  @MaxLength(SLUG_MAX)
  @Matches(SLUG_PATTERN)
  categorySlug?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: '`true` = solo disponibles (exige `branchId`). `false` o ausente = todos.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: SEARCH_MAX_PAGE, default: 1 })
  @IsOptional()
  @Transform(toStrictInt)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_PAGE)
  page?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: SEARCH_MAX_PAGE_SIZE,
    default: SEARCH_DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Transform(toStrictInt)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_PAGE_SIZE)
  pageSize?: number;
}
