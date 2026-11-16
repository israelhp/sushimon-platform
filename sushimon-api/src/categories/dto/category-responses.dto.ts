import { ApiProperty } from '@nestjs/swagger';
import { MAX_CATEGORIES } from '../category-policy.js';

export class PublicCategoryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ type: () => [PublicCategoryDto], description: 'Hijas visibles (vacío en hojas).' })
  children!: PublicCategoryDto[];
}

export class PublicCategoryTreeDto {
  @ApiProperty({ type: [PublicCategoryDto] })
  items!: PublicCategoryDto[];
}

export class AdminCategoryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentId!: string | null;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ type: Number, minimum: 0 })
  sortOrder!: number;
  @ApiProperty({ type: Boolean, description: 'Estado propio (administrativo).' })
  active!: boolean;
  @ApiProperty({ type: Boolean, description: 'Ella y todos sus ancestros activos.' })
  effectivelyVisible!: boolean;
  @ApiProperty({ type: Number, minimum: 1, maximum: 3 })
  depth!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AdminCategoryListDto {
  @ApiProperty({ type: [AdminCategoryDto], maxItems: MAX_CATEGORIES })
  items!: AdminCategoryDto[];
  @ApiProperty({ type: Number, minimum: 0 })
  total!: number;
}
