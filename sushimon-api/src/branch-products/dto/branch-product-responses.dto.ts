import { ApiProperty } from '@nestjs/swagger';

export class AdminBranchProductStateDto {
  @ApiProperty({ type: String, format: 'uuid' }) branchId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String, example: '85.00' }) basePrice!: string;
  @ApiProperty({ type: String, nullable: true }) priceOverride!: string | null;
  @ApiProperty({ type: String, example: '85.00' }) effectivePrice!: string;
  @ApiProperty({ type: Boolean }) available!: boolean;
  @ApiProperty({ type: Boolean }) offered!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class AdminBranchProductCategoryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Boolean }) effectivelyVisible!: boolean;
}

export class AdminBranchProductRowDto extends AdminBranchProductStateDto {
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: () => AdminBranchProductCategoryDto })
  category!: AdminBranchProductCategoryDto;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Boolean }) publiclyVisible!: boolean;
}

export class AdminBranchProductPageDto {
  @ApiProperty({ type: String, format: 'uuid' }) branchId!: string;
  @ApiProperty({ type: () => [AdminBranchProductRowDto] }) items!: AdminBranchProductRowDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
}

export class AdminProductBranchRowDto extends AdminBranchProductStateDto {
  @ApiProperty({ type: String }) branchCode!: string;
  @ApiProperty({ type: String }) branchName!: string;
  @ApiProperty({ type: Boolean }) branchActive!: boolean;
}

export class AdminProductBranchesDto {
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String, example: '85.00' }) basePrice!: string;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Boolean }) publiclyVisible!: boolean;
  @ApiProperty({ type: () => [AdminProductBranchRowDto] }) items!: AdminProductBranchRowDto[];
}
