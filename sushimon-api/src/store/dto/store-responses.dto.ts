import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BranchAvailabilityDto } from '../../branch-schedule/dto/branch-schedule-responses.dto.js';
import { StoreBannerDto } from '../../banners/dto/banner-responses.dto.js';
import { PublicBranchDto } from '../../branches/dto/branch-responses.dto.js';
import {
  PublicProductCategoryRefDto,
  PublicProductDetailDto,
  PublicProductMediaDto,
} from '../../products/dto/product-responses.dto.js';
import { StorePromotionDto } from '../../promotions/dto/promotion-responses.dto.js';

export class StoreProductPromoDto {
  @ApiProperty({ type: String, format: 'uuid' }) promotionId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Boolean }) isHappyHour!: boolean;
  @ApiProperty({ type: Boolean }) dineInOnly!: boolean;
  @ApiProperty({ type: String, example: '85.00' }) regularPrice!: string;
  @ApiProperty({ type: String, example: '68.00' }) promoPrice!: string;
}

export class StoreBranchMenuItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String, example: '85.00', description: 'Precio EFECTIVO en la sucursal.' })
  price!: string;
  @ApiProperty({ type: Boolean, nullable: true }) available!: boolean | null;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 160 }) summary!: string | null;
  @ApiProperty({ type: () => PublicProductMediaDto, nullable: true })
  image!: PublicProductMediaDto | null;
  @ApiProperty({ type: () => PublicProductCategoryRefDto })
  category!: PublicProductCategoryRefDto;
  @ApiProperty({ type: () => StoreProductPromoDto, nullable: true })
  promo!: StoreProductPromoDto | null;
}

export class StoreBranchMenuDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) branchId!: string | null;
  @ApiProperty({ type: () => [StoreBranchMenuItemDto] }) items!: StoreBranchMenuItemDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) nextChangeAt!: string | null;
}

export class StoreSearchPageDto extends StoreBranchMenuDto {}

export class StoreBootstrapCategoryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: Boolean }) hasChildren!: boolean;
}

export class StoreBootstrapDto {
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) nextChangeAt!: string | null;
  @ApiProperty({ type: String, enum: ['es', 'en'] }) locale!: 'es' | 'en';
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) branchId!: string | null;
  @ApiProperty({ type: () => PublicBranchDto, nullable: true }) branch!: PublicBranchDto | null;
  @ApiProperty({ type: () => BranchAvailabilityDto, nullable: true })
  availability!: BranchAvailabilityDto | null;
  @ApiProperty({ type: () => [StoreBootstrapCategoryDto] })
  categories!: StoreBootstrapCategoryDto[];
  @ApiProperty({ type: () => [StoreBranchMenuItemDto] }) featured!: StoreBranchMenuItemDto[];
  @ApiProperty({ type: () => [StorePromotionDto] }) promotions!: StorePromotionDto[];
  @ApiProperty({ type: () => [StoreBannerDto] }) banners!: StoreBannerDto[];
  @ApiProperty({ type: Number }) productCount!: number;
  @ApiProperty({ type: [String], enum: ['availability', 'featured', 'promotions', 'banners'] })
  degraded!: ('availability' | 'featured' | 'promotions' | 'banners')[];
}

/** Ficha pública F11/F12 + (con `branchId`) oferta y promociones de F17. */
export class StoreProductOfferDto {
  @ApiProperty({ type: String, format: 'uuid' }) branchId!: string;
  @ApiProperty({ type: String, example: '85.00' }) price!: string;
  @ApiProperty({ type: Boolean }) available!: boolean;
}

export class StoreProductDetailDto extends PublicProductDetailDto {
  @ApiPropertyOptional({ type: () => StoreProductOfferDto }) offer?: StoreProductOfferDto;
  @ApiPropertyOptional({ type: () => [StoreProductPromoDto], maxItems: 3 })
  promotions?: StoreProductPromoDto[];
  @ApiPropertyOptional({ type: String, format: 'date-time' }) generatedAt?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  nextChangeAt?: string | null;
}
