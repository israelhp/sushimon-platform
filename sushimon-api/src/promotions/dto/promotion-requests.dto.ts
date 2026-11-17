import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
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
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { INSTANT_PATTERN } from '../../branch-schedule/business-time.js';
import { PageQuery, toBoolean } from '../../products/dto/product-requests.dto.js';
import { SEARCH_MAX } from '../../products/product-policy.js';
import { MONEY_PATTERN } from '../promotion-money.js';
import {
  DESCRIPTION_MAX,
  MAX_BRANCH_IDS,
  MAX_PRODUCT_IDS,
  MAX_SLOTS,
  NAME_MAX,
  REASON_MAX,
} from '../promotion-policy.js';
import { PROMOTION_KINDS } from '../promotions.types.js';

const SCOPES = ['ALL', 'SELECTED'] as const;
const CODE_INPUT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;
const CLOCK_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const CLOCK_END_PATTERN = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PromotionScheduleSlotDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 7, description: 'Día ISO (1 = lunes … 7).' })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty({ type: String, pattern: CLOCK_PATTERN.source, example: '15:00' })
  @IsString()
  @Matches(CLOCK_PATTERN)
  startsAt!: string;

  @ApiProperty({ type: String, pattern: CLOCK_END_PATTERN.source, example: '18:00' })
  @IsString()
  @Matches(CLOCK_END_PATTERN)
  endsAt!: string;
}

export class CreatePromotionRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 3,
    maxLength: 32,
    pattern: CODE_INPUT_PATTERN.source,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Matches(CODE_INPUT_PATTERN)
  code?: string | null;

  @ApiProperty({ type: String, enum: PROMOTION_KINDS })
  @IsIn(PROMOTION_KINDS)
  kind!: 'PERCENT' | 'FIXED_AMOUNT';

  @ApiProperty({ type: String, pattern: MONEY_PATTERN.source, example: '15.00' })
  @IsString()
  @Matches(MONEY_PATTERN)
  value!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Instante con zona.' })
  @IsString()
  @Matches(INSTANT_PATTERN)
  startsAt!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Exclusivo.' })
  @IsString()
  @Matches(INSTANT_PATTERN)
  endsAt!: string;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  dineInOnly?: boolean;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  active?: boolean;

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

  @ApiProperty({ type: String, enum: SCOPES })
  @IsIn(SCOPES)
  productScope!: 'ALL' | 'SELECTED';

  @ApiPropertyOptional({ type: [String], maxItems: MAX_PRODUCT_IDS })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_IDS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  productIds?: string[];

  @ApiPropertyOptional({ type: () => [PromotionScheduleSlotDto], maxItems: MAX_SLOTS })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_SLOTS)
  @ValidateNested({ each: true })
  @Type(() => PromotionScheduleSlotDto)
  schedule?: PromotionScheduleSlotDto[];
}

/** `expectedVersion` obligatorio; el resto es parcial. Campos desconocidos => 400 (`forbidNonWhitelisted`). */
export class UpdatePromotionRequest {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: NAME_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 3,
    maxLength: 32,
    pattern: CODE_INPUT_PATTERN.source,
  })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString()
  @Matches(CODE_INPUT_PATTERN)
  code?: string | null;

  @ApiPropertyOptional({ type: String, enum: PROMOTION_KINDS })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(PROMOTION_KINDS)
  kind?: 'PERCENT' | 'FIXED_AMOUNT';

  @ApiPropertyOptional({ type: String, pattern: MONEY_PATTERN.source })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(MONEY_PATTERN)
  value?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(INSTANT_PATTERN)
  startsAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(INSTANT_PATTERN)
  endsAt?: string;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  dineInOnly?: boolean;

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

  @ApiPropertyOptional({ type: String, enum: SCOPES })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(SCOPES)
  productScope?: 'ALL' | 'SELECTED';

  @ApiPropertyOptional({ type: [String], maxItems: MAX_PRODUCT_IDS })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_IDS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  productIds?: string[];

  @ApiPropertyOptional({ type: () => [PromotionScheduleSlotDto], maxItems: MAX_SLOTS })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_SLOTS)
  @ValidateNested({ each: true })
  @Type(() => PromotionScheduleSlotDto)
  schedule?: PromotionScheduleSlotDto[];
}

export class UpdatePromotionStatusRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiPropertyOptional({ type: String, maxLength: REASON_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(REASON_MAX)
  reason?: string;
}

export class ListAdminPromotionsQuery extends PageQuery {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    type: String,
    enum: ['active', 'inactive', 'scheduled', 'running', 'expired'],
  })
  @IsOptional()
  @IsIn(['active', 'inactive', 'scheduled', 'running', 'expired'])
  status?: 'active' | 'inactive' | 'scheduled' | 'running' | 'expired';

  @ApiPropertyOptional({ type: String, enum: PROMOTION_KINDS })
  @IsOptional()
  @IsIn(PROMOTION_KINDS)
  kind?: 'PERCENT' | 'FIXED_AMOUNT';

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN)
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsString()
  @Matches(INSTANT_PATTERN)
  to?: string;

  @ApiPropertyOptional({ type: String, maxLength: SEARCH_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    enum: ['startsAt', 'endsAt', 'name', 'createdAt'],
    default: 'startsAt',
  })
  @IsOptional()
  @IsIn(['startsAt', 'endsAt', 'name', 'createdAt'])
  sort?: 'startsAt' | 'endsAt' | 'name' | 'createdAt';

  @ApiPropertyOptional({ type: String, enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class StorePromotionsQuery {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({ type: String, enum: ['live', 'upcoming'], default: 'live' })
  @IsOptional()
  @IsIn(['live', 'upcoming'])
  state?: 'live' | 'upcoming';

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'F17: `true` = sin `items` ni `productIds` (no lee productos).',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  compact?: boolean;
}
