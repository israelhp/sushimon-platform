import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PromotionScheduleSlotDto } from './promotion-requests.dto.js';

const KIND = ['PERCENT', 'FIXED_AMOUNT'] as const;
const SCOPE = ['ALL', 'SELECTED'] as const;

export class StorePromotionItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String, example: '85.00' }) regularPrice!: string;
  @ApiProperty({ type: String, example: '72.25', description: 'Precio INDICATIVO a cantidad 1.' })
  promoPrice!: string;
}

export class StorePromotionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: Boolean }) requiresCode!: boolean;
  @ApiProperty({ type: Boolean }) isHappyHour!: boolean;
  @ApiProperty({ type: Boolean }) dineInOnly!: boolean;
  @ApiProperty({ type: String, enum: ['live', 'upcoming'] }) state!: 'live' | 'upcoming';
  @ApiPropertyOptional({ type: String, enum: KIND }) kind?: 'PERCENT' | 'FIXED_AMOUNT';
  @ApiPropertyOptional({ type: String, example: '15.00' }) value?: string;
  @ApiProperty({ type: String, format: 'date-time' }) validFrom!: string;
  @ApiProperty({ type: String, format: 'date-time' }) validUntil!: string;
  @ApiProperty({ type: () => [PromotionScheduleSlotDto] }) schedule!: PromotionScheduleSlotDto[];
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  nextStartsAt?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  nextEndsAt?: string | null;
  @ApiProperty({ type: String, enum: SCOPE }) productScope!: 'ALL' | 'SELECTED';
  @ApiPropertyOptional({ type: [String] }) productIds?: string[];
  @ApiPropertyOptional({ type: () => [StorePromotionItemDto] }) items?: StorePromotionItemDto[];
}

export class StorePromotionListDto {
  @ApiProperty({ type: String, format: 'uuid' }) branchId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) nextChangeAt!: string | null;
  @ApiProperty({ type: Boolean }) truncated!: boolean;
  @ApiProperty({ type: () => [StorePromotionDto] }) items!: StorePromotionDto[];
}

export class AdminPromotionBranchRefDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class AdminPromotionProductRefDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) slug!: string;
}

export class AdminPromotionSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) code!: string | null;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, enum: KIND }) kind!: 'PERCENT' | 'FIXED_AMOUNT';
  @ApiProperty({ type: String, example: '15.00' }) value!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: string;
  @ApiProperty({ type: Boolean }) dineInOnly!: boolean;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: String, enum: ['INACTIVE', 'SCHEDULED', 'RUNNING', 'EXPIRED'] })
  lifecycle!: 'INACTIVE' | 'SCHEDULED' | 'RUNNING' | 'EXPIRED';
  @ApiProperty({ type: Boolean }) liveNow!: boolean;
  @ApiProperty({ type: String, enum: SCOPE }) branchScope!: 'ALL' | 'SELECTED';
  @ApiProperty({ type: () => [AdminPromotionBranchRefDto] })
  branches!: AdminPromotionBranchRefDto[];
  @ApiProperty({ type: String, enum: SCOPE }) productScope!: 'ALL' | 'SELECTED';
  @ApiProperty({ type: Number }) productCount!: number;
  @ApiProperty({ type: Number }) scheduleCount!: number;
  @ApiProperty({ type: Boolean }) editable!: boolean;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class AdminPromotionDto extends AdminPromotionSummaryDto {
  @ApiProperty({ type: () => [AdminPromotionProductRefDto] })
  products!: AdminPromotionProductRefDto[];
  @ApiProperty({ type: () => [PromotionScheduleSlotDto] }) schedule!: PromotionScheduleSlotDto[];
}

export class AdminPromotionPageDto {
  @ApiProperty({ type: () => [AdminPromotionSummaryDto] }) items!: AdminPromotionSummaryDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
}
