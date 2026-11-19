import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { OrderDetailModifierDto } from '../../dto/order-responses.dto.js';

export const REORDER_ISSUE_CODES = [
  'PRODUCT_REMOVED',
  'PRODUCT_INACTIVE',
  'PRODUCT_OUT_OF_STOCK',
  'BRANCH_UNAVAILABLE',
  'OPTION_REMOVED',
  'OPTION_INACTIVE',
  'GROUP_RULE_CHANGED',
  'REQUIRED_SELECTION_MISSING',
  'PRICE_CHANGED',
  'QUANTITY_ADJUSTED',
  'NOTE_DROPPED',
] as const;
export type ReorderIssueCode = (typeof REORDER_ISSUE_CODES)[number];
export type ReorderIssueSeverity = 'info' | 'warning' | 'blocking';
export type ReorderLineStatus = 'AVAILABLE' | 'NEEDS_CONFIGURATION' | 'UNAVAILABLE';
export const REORDER_BRANCH_REASONS = [
  'OPEN',
  'INACTIVE',
  'OUTSIDE_BUSINESS_HOURS',
  'EXCEPTIONAL_CLOSURE',
  'SCHEDULE_NOT_CONFIGURED',
] as const;

/** Cuerpo opcional (`{}` o ausente = sucursal del pedido original). La lista blanca global rechaza cualquier otro campo (400). */
export class OrderReorderRequestDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'branchId: debe ser un UUID' })
  branchId?: string;
}

export class OrderReorderIssueDto {
  @ApiProperty({ type: String, enum: REORDER_ISSUE_CODES })
  code!: ReorderIssueCode;

  @ApiProperty({ type: String, enum: ['info', 'warning', 'blocking'] })
  severity!: ReorderIssueSeverity;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  groupId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  groupName!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  optionId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  optionName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  previousUnitPrice!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  currentUnitPrice!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  from!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  to!: number | null;
}

export class OrderReorderOriginalLineDto {
  @ApiProperty({ type: String })
  productName!: string;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: String })
  unitPrice!: string;

  @ApiProperty({ type: String })
  extrasPerUnit!: string;

  @ApiProperty({ type: [OrderDetailModifierDto] })
  modifiers!: OrderDetailModifierDto[];

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
}

export class OrderReorderCurrentDto {
  @ApiProperty({ type: String })
  unitPrice!: string;

  @ApiProperty({ type: String })
  extrasPerUnit!: string;
}

export class CartSelectionDto {
  @ApiProperty({ type: String, format: 'uuid' })
  groupId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  optionId!: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 1 })
  quantity!: 1;
}

/** `CartQuoteLineInput` (F18/F19): SOLO ids y cantidad. */
export class CartQuoteLineDto {
  @ApiProperty({ type: String, format: 'uuid' })
  productId!: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 99 })
  quantity!: number;

  @ApiProperty({ type: [CartSelectionDto] })
  selections!: CartSelectionDto[];
}

export class OrderReorderOptionDisplayDto {
  @ApiProperty({ type: String, format: 'uuid' })
  groupId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  optionId!: string;

  @ApiProperty({ type: String })
  groupName!: string;

  @ApiProperty({ type: String })
  optionName!: string;

  @ApiProperty({ type: String })
  extraPrice!: string;
}

export class OrderReorderCandidateDisplayDto {
  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ type: String })
  unitPrice!: string;

  @ApiProperty({ type: [OrderReorderOptionDisplayDto] })
  options!: OrderReorderOptionDisplayDto[];
}

export class OrderReorderCandidateDto {
  @ApiProperty({ type: CartQuoteLineDto })
  line!: CartQuoteLineDto;

  @ApiProperty({ type: String })
  slug!: string;

  @ApiProperty({ type: String, nullable: true, maxLength: 140 })
  note!: string | null;

  @ApiProperty({ type: OrderReorderCandidateDisplayDto })
  display!: OrderReorderCandidateDisplayDto;
}

export class OrderReorderLineDto {
  @ApiProperty({ type: Number })
  lineNo!: number;

  @ApiProperty({ type: String, enum: ['AVAILABLE', 'NEEDS_CONFIGURATION', 'UNAVAILABLE'] })
  status!: ReorderLineStatus;

  @ApiProperty({ type: OrderReorderOriginalLineDto })
  original!: OrderReorderOriginalLineDto;

  @ApiProperty({ type: OrderReorderCurrentDto, nullable: true })
  current!: OrderReorderCurrentDto | null;

  @ApiProperty({ type: [OrderReorderIssueDto] })
  issues!: OrderReorderIssueDto[];

  @ApiProperty({ type: OrderReorderCandidateDto, nullable: true })
  candidate!: OrderReorderCandidateDto | null;
}

export class OrderReorderBranchDto {
  @ApiProperty({ type: String, format: 'uuid' })
  originalBranchId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  requestedBranchId!: string;

  @ApiProperty({ type: Boolean })
  sameBranch!: boolean;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: Boolean })
  active!: boolean;

  @ApiProperty({ type: Boolean })
  acceptingOrders!: boolean;

  @ApiProperty({ type: String, enum: REORDER_BRANCH_REASONS })
  reason!: (typeof REORDER_BRANCH_REASONS)[number];

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextOpensAt!: string | null;
}

export class OrderReorderSummaryDto {
  @ApiProperty({ type: Number })
  lines!: number;

  @ApiProperty({ type: Number })
  available!: number;

  @ApiProperty({ type: Number })
  needsConfiguration!: number;

  @ApiProperty({ type: Number })
  unavailable!: number;

  @ApiProperty({ type: Number })
  priceChanged!: number;

  @ApiProperty({ type: Number })
  units!: number;

  @ApiProperty({ type: String })
  estimatedSubtotal!: string;

  @ApiProperty({ type: Boolean })
  canAddAny!: boolean;
}

export class OrderReorderSourceDto {
  @ApiProperty({ type: String, example: 'MON-001042' })
  displayNumber!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String, enum: ['PICKUP', 'DELIVERY'] })
  fulfillmentType!: 'PICKUP' | 'DELIVERY';

  @ApiProperty({ type: String, enum: ['OWN', 'PEDIDOSYA'], nullable: true })
  deliveryProvider!: 'OWN' | 'PEDIDOSYA' | null;

  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;
}

export class OrderReorderPreviewDto {
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: OrderReorderSourceDto })
  source!: OrderReorderSourceDto;

  @ApiProperty({ type: OrderReorderBranchDto })
  branch!: OrderReorderBranchDto;

  @ApiProperty({ type: [OrderReorderLineDto] })
  lines!: OrderReorderLineDto[];

  @ApiProperty({ type: OrderReorderSummaryDto })
  summary!: OrderReorderSummaryDto;
}
