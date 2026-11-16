import { ApiProperty } from '@nestjs/swagger';
import { PublicModifierGroupDto } from '../../modifiers/dto/modifier-responses.dto.js';

export class PublicProductCategoryRefDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class PublicProductMediaDto {
  @ApiProperty({ type: String, format: 'uri' }) url!: string;
  @ApiProperty({ type: String, nullable: true }) altText!: string | null;
}

export class PublicProductDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, example: '85.00', description: 'Cadena decimal con 2 decimales.' })
  basePrice!: string;
  @ApiProperty({ type: () => PublicProductCategoryRefDto }) category!: PublicProductCategoryRefDto;
  @ApiProperty({ type: () => [PublicProductMediaDto] }) media!: PublicProductMediaDto[];
}

export class PublicProductDetailDto extends PublicProductDto {
  @ApiProperty({ type: () => [PublicProductCategoryRefDto], description: 'Raíz → padre.' })
  categoryAncestors!: PublicProductCategoryRefDto[];
  @ApiProperty({
    type: () => [PublicModifierGroupDto],
    description: 'F12: grupos de modificadores ofrecibles (vacío si no hay).',
  })
  modifierGroups!: PublicModifierGroupDto[];
}

export class PublicProductPageDto {
  @ApiProperty({ type: () => [PublicProductDto] }) items!: PublicProductDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
}

export class AdminProductCategoryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Boolean }) effectivelyVisible!: boolean;
}

export class AdminProductMediaDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uri' }) url!: string;
  @ApiProperty({ type: String, nullable: true }) altText!: string | null;
  @ApiProperty({ type: Number, minimum: 0 }) sortOrder!: number;
}

export class AdminProductDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: String }) slug!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, example: '85.00' }) basePrice!: string;
  @ApiProperty({ type: String, format: 'uuid' }) categoryId!: string;
  @ApiProperty({ type: () => AdminProductCategoryDto }) category!: AdminProductCategoryDto;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Boolean }) publiclyVisible!: boolean;
  @ApiProperty({ type: () => [AdminProductMediaDto] }) media!: AdminProductMediaDto[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class AdminProductPageDto {
  @ApiProperty({ type: () => [AdminProductDto] }) items!: AdminProductDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
}
