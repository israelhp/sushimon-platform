import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { INSTANT_PATTERN } from '../../branch-schedule/business-time.js';
import { PageQuery } from '../../products/dto/product-requests.dto.js';
import { SEARCH_MAX } from '../../products/product-policy.js';
import {
  CTA_LABEL_MAX,
  IMAGE_ALT_MAX,
  MAX_BRANCH_IDS,
  REASON_MAX,
  SORT_ORDER_MAX,
  SUBTITLE_MAX,
  TITLE_MAX,
} from '../banner-policy.js';
import { BANNER_CTA_TYPES, BANNER_LOCALES } from '../banners.types.js';

const SCOPES = ['ALL', 'SELECTED'] as const;
const LIFECYCLES = ['INACTIVE', 'SCHEDULED', 'PUBLISHED', 'EXPIRED'] as const;
const SORTS = ['priority', 'startsAt', 'endsAt', 'createdAt'] as const;
const CODE_INPUT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Textos de un idioma: cada campo es opcional y `null`/en blanco = ausente. Longitudes en caracteres. */
export class BannerTextDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: TITLE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(TITLE_MAX)
  title?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: SUBTITLE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SUBTITLE_MAX)
  subtitle?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: CTA_LABEL_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(CTA_LABEL_MAX)
  ctaLabel?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: IMAGE_ALT_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(IMAGE_ALT_MAX)
  imageAlt?: string | null;
}

export class BannerTranslationsInputDto {
  @ApiProperty({ type: () => BannerTextDto })
  @IsObject()
  @ValidateNested()
  @Type(() => BannerTextDto)
  es!: BannerTextDto;

  @ApiPropertyOptional({ type: () => BannerTextDto, nullable: true })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BannerTextDto)
  en?: BannerTextDto | null;
}

export class BannerTranslationsPatchDto {
  @ApiPropertyOptional({ type: () => BannerTextDto })
  @ValidateIf((_, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => BannerTextDto)
  es?: BannerTextDto;

  @ApiPropertyOptional({ type: () => BannerTextDto, nullable: true })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BannerTextDto)
  en?: BannerTextDto | null;
}

/**
 * Destino estructurado. `type` es un enum cerrado (`EXTERNAL` => 400). `page` es `string` a propósito: una página fuera
 * de la lista blanca es una regla de negocio (422 `BANNER_CTA_INVALID`), no de forma.
 */
export class BannerCtaDto {
  @ApiProperty({ type: String, enum: BANNER_CTA_TYPES })
  @IsIn(BANNER_CTA_TYPES)
  type!: 'NONE' | 'MENU' | 'PROMOTIONS' | 'CATEGORY' | 'PRODUCT' | 'PAGE';

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('all')
  categoryId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('all')
  productId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 40,
    description: 'CAREERS | TRACK_ORDER | INCIDENTS; otro valor => 422 BANNER_CTA_INVALID.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  page?: string | null;
}

export class CreateBannerRequest {
  @ApiProperty({ type: String, minLength: 3, maxLength: 64, pattern: CODE_INPUT_PATTERN.source })
  @Transform(trimString)
  @IsString()
  @Matches(CODE_INPUT_PATTERN)
  code!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('all')
  imageAssetId!: string;

  @ApiProperty({ type: () => BannerTranslationsInputDto })
  @IsObject()
  @ValidateNested()
  @Type(() => BannerTranslationsInputDto)
  translations!: BannerTranslationsInputDto;

  @ApiProperty({ type: () => BannerCtaDto })
  @IsObject()
  @ValidateNested()
  @Type(() => BannerCtaDto)
  cta!: BannerCtaDto;

  @ApiProperty({ type: String, enum: SCOPES })
  @IsIn(SCOPES)
  branchScope!: 'ALL' | 'SELECTED';

  @ApiPropertyOptional({ type: [String], maxItems: MAX_BRANCH_IDS })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_BRANCH_IDS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds?: string[];

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('all')
  promotionId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN)
  startsAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN)
  endsAt?: string | null;

  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: SORT_ORDER_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(SORT_ORDER_MAX)
  sortOrder?: number;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;
}

/** `expectedVersion` obligatorio; el resto es parcial. `code` y `active` NO se aceptan (`forbidNonWhitelisted` => 400). */
export class UpdateBannerRequest {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID('all')
  imageAssetId?: string;

  @ApiPropertyOptional({ type: () => BannerTranslationsPatchDto })
  @ValidateIf((_, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => BannerTranslationsPatchDto)
  translations?: BannerTranslationsPatchDto;

  @ApiPropertyOptional({ type: () => BannerCtaDto })
  @ValidateIf((_, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => BannerCtaDto)
  cta?: BannerCtaDto;

  @ApiPropertyOptional({ type: String, enum: SCOPES })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(SCOPES)
  branchScope?: 'ALL' | 'SELECTED';

  @ApiPropertyOptional({ type: [String], maxItems: MAX_BRANCH_IDS })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_BRANCH_IDS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds?: string[];

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('all')
  promotionId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN)
  startsAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN)
  endsAt?: string | null;

  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: SORT_ORDER_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(SORT_ORDER_MAX)
  sortOrder?: number;
}

export class UpdateBannerStatusRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiPropertyOptional({ type: String, maxLength: REASON_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(REASON_MAX)
  reason?: string;
}

export class ReorderBannersRequest {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  orderedIds!: string[];
}

export class ListAdminBannersQuery extends PageQuery {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @ApiPropertyOptional({ type: String, enum: LIFECYCLES })
  @IsOptional()
  @IsIn(LIFECYCLES)
  lifecycle?: 'INACTIVE' | 'SCHEDULED' | 'PUBLISHED' | 'EXPIRED';

  @ApiPropertyOptional({ type: String, maxLength: SEARCH_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX)
  q?: string;

  @ApiPropertyOptional({ type: String, enum: SORTS, default: 'priority' })
  @IsOptional()
  @IsIn(SORTS)
  sort?: 'priority' | 'startsAt' | 'endsAt' | 'createdAt';

  @ApiPropertyOptional({ type: String, enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class StoreBannersQuery {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @ApiPropertyOptional({ type: String, enum: BANNER_LOCALES, default: 'es' })
  @IsOptional()
  @IsIn(BANNER_LOCALES)
  locale?: 'es' | 'en';
}
