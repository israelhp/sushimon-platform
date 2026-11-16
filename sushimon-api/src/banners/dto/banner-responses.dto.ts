import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SCOPE = ['ALL', 'SELECTED'] as const;
const CTA_TYPES = ['NONE', 'MENU', 'PROMOTIONS', 'CATEGORY', 'PRODUCT', 'PAGE'] as const;
const PAGES = ['CAREERS', 'TRACK_ORDER', 'INCIDENTS'] as const;
const LIFECYCLE = ['INACTIVE', 'SCHEDULED', 'PUBLISHED', 'EXPIRED'] as const;
const HIDDEN = ['PROMOTION_NOT_LIVE', 'CTA_TARGET_INACTIVE', 'IMAGE_UNAVAILABLE'] as const;
const FIELDS = ['title', 'subtitle', 'ctaLabel', 'imageAlt'] as const;

type CtaType = (typeof CTA_TYPES)[number];
type Page = (typeof PAGES)[number];

// ---------- público ----------

export class StoreBannerImageDto {
  @ApiProperty({
    type: String,
    format: 'uri',
    description: 'URL pública permanente; nunca firmada.',
  })
  url!: string;
  @ApiProperty({ type: String }) mimeType!: string;
}

export class StoreBannerCtaDto {
  @ApiProperty({ type: String, enum: CTA_TYPES }) type!: CtaType;
  @ApiPropertyOptional({ type: String, nullable: true }) categorySlug?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) productId?: string | null;
  @ApiPropertyOptional({ type: String, enum: PAGES, nullable: true }) page?: Page | null;
}

export class StoreBannerDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String, nullable: true }) subtitle!: string | null;
  @ApiProperty({ type: String, nullable: true }) ctaLabel!: string | null;
  @ApiProperty({ type: String }) imageAlt!: string;
  @ApiProperty({ type: () => StoreBannerImageDto }) image!: StoreBannerImageDto;
  @ApiProperty({ type: () => StoreBannerCtaDto }) cta!: StoreBannerCtaDto;
  @ApiProperty({ type: [String], enum: FIELDS }) fallbackFields!: (typeof FIELDS)[number][];
}

export class StoreBannerListDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) branchId!: string | null;
  @ApiProperty({ type: String, enum: ['es', 'en'] }) locale!: 'es' | 'en';
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) nextChangeAt!: string | null;
  @ApiProperty({ type: () => [StoreBannerDto] }) items!: StoreBannerDto[];
}

// ---------- admin ----------

export class AdminBannerBranchRefDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class AdminBannerPromotionRefDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, enum: ['INACTIVE', 'SCHEDULED', 'RUNNING', 'EXPIRED'] })
  lifecycle!: 'INACTIVE' | 'SCHEDULED' | 'RUNNING' | 'EXPIRED';
}

export class AdminBannerImageDto {
  @ApiProperty({ type: String, format: 'uuid' }) assetId!: string;
  @ApiProperty({ type: String, format: 'uri', nullable: true }) url!: string | null;
  @ApiProperty({ type: String }) mimeType!: string;
  @ApiProperty({ type: Number, format: 'int64' }) sizeBytes!: number;
}

export class AdminBannerCtaDto {
  @ApiProperty({ type: String, enum: CTA_TYPES }) type!: CtaType;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) productId!: string | null;
  @ApiProperty({ type: String, enum: PAGES, nullable: true }) page!: Page | null;
  @ApiProperty({ type: String, nullable: true }) targetLabel!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) targetActive!: boolean | null;
}

export class AdminBannerTextDto {
  @ApiPropertyOptional({ type: String, nullable: true }) title!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) subtitle!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) ctaLabel!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) imageAlt!: string | null;
}

export class AdminBannerTranslationsDto {
  @ApiProperty({ type: () => AdminBannerTextDto }) es!: AdminBannerTextDto;
  @ApiProperty({ type: () => AdminBannerTextDto, nullable: true }) en!: AdminBannerTextDto | null;
}

export class AdminBannerSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: () => AdminBannerImageDto }) image!: AdminBannerImageDto;
  @ApiProperty({ type: () => AdminBannerCtaDto }) cta!: AdminBannerCtaDto;
  @ApiProperty({ type: String, enum: SCOPE }) branchScope!: 'ALL' | 'SELECTED';
  @ApiProperty({ type: () => [AdminBannerBranchRefDto] }) branches!: AdminBannerBranchRefDto[];
  @ApiProperty({ type: () => AdminBannerPromotionRefDto, nullable: true })
  promotion!: AdminBannerPromotionRefDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endsAt!: string | null;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Number }) sortOrder!: number;
  @ApiProperty({ type: String, enum: LIFECYCLE }) lifecycle!: (typeof LIFECYCLE)[number];
  @ApiProperty({ type: Boolean }) visibleNow!: boolean;
  @ApiProperty({ type: String, enum: HIDDEN, nullable: true })
  hiddenReason!: (typeof HIDDEN)[number] | null;
  @ApiProperty({ type: Boolean }) hasEnglish!: boolean;
  @ApiProperty({ type: Boolean }) editable!: boolean;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class AdminBannerDto extends AdminBannerSummaryDto {
  @ApiProperty({ type: () => AdminBannerTranslationsDto })
  translations!: AdminBannerTranslationsDto;
}

export class AdminBannerPageDto {
  @ApiProperty({ type: () => [AdminBannerSummaryDto] }) items!: AdminBannerSummaryDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
}

export class AdminBannerOrderItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: Number }) sortOrder!: number;
  @ApiProperty({ type: Number }) version!: number;
}

export class AdminBannerOrderDto {
  @ApiProperty({ type: () => [AdminBannerOrderItemDto] }) items!: AdminBannerOrderItemDto[];
}
