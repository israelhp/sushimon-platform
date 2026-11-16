import { ApiProperty } from '@nestjs/swagger';

export class PublicModifierOptionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, example: '5.00', description: 'Cadena decimal con 2 decimales.' })
  extraPrice!: string;
}

export class PublicModifierGroupDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number, minimum: 0, maximum: 20 }) minSelect!: number;
  @ApiProperty({ type: Number, minimum: 1, maximum: 20 }) maxSelect!: number;
  @ApiProperty({ type: Boolean, description: 'Derivado: `minSelect >= 1`.' }) required!: boolean;
  @ApiProperty({ type: () => [PublicModifierOptionDto] }) options!: PublicModifierOptionDto[];
}

export class AdminModifierDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) groupId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, example: '5.00' }) extraPrice!: string;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Number, minimum: 0, maximum: 29 }) sortOrder!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class AdminModifierListDto {
  @ApiProperty({ type: () => [AdminModifierDto] }) items!: AdminModifierDto[];
}

export class AdminModifierGroupSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number, minimum: 0, maximum: 20 }) minSelect!: number;
  @ApiProperty({ type: Number, minimum: 1, maximum: 20 }) maxSelect!: number;
  @ApiProperty({ type: Boolean, description: 'Derivado: `minSelect >= 1`.' }) required!: boolean;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Number, minimum: 0 }) optionCount!: number;
  @ApiProperty({ type: Number, minimum: 0 }) activeOptionCount!: number;
  @ApiProperty({ type: Number, minimum: 0 }) productCount!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class AdminModifierGroupDto extends AdminModifierGroupSummaryDto {
  @ApiProperty({ type: () => [AdminModifierDto] }) options!: AdminModifierDto[];
}

export class AdminModifierGroupPageDto {
  @ApiProperty({ type: () => [AdminModifierGroupSummaryDto] })
  items!: AdminModifierGroupSummaryDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
}

export class AdminProductModifiersDto {
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: () => [AdminModifierGroupDto] }) groups!: AdminModifierGroupDto[];
}
