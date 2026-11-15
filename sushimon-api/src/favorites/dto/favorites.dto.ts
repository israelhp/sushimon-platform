import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_FAVORITES_PAGE_SIZE,
  MAX_FAVORITES_PAGE,
  MAX_FAVORITES_PAGE_SIZE,
} from '../favorites.constants.js';

/** Solo dígitos: `''`, `1.5` o `1e2` no se convierten (quedan como string y `@IsInt` los rechaza => 400). */
const toStrictInt = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value;

export class ListFavoritesQuery {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: MAX_FAVORITES_PAGE, default: 1 })
  @IsOptional()
  @Transform(toStrictInt)
  @IsInt()
  @Min(1)
  @Max(MAX_FAVORITES_PAGE)
  page?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: MAX_FAVORITES_PAGE_SIZE,
    default: DEFAULT_FAVORITES_PAGE_SIZE,
    description:
      '0 = solo `favoriteProductIds`/`total` (sin `items` ni consulta al catálogo). Máximo 50.',
  })
  @IsOptional()
  @Transform(toStrictInt)
  @IsInt()
  @Min(0)
  @Max(MAX_FAVORITES_PAGE_SIZE)
  pageSize?: number;
}

/** PUT/DELETE no aceptan parámetros de consulta: una lista blanca vacía rechaza cualquiera (`customerId`, etc.) con 400. */
export class NoQuery {}

export class FavoriteProductSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) nameEn!: string | null;
  @ApiProperty({ type: String, format: 'uri', nullable: true }) imageUrl!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
}

export class FavoriteItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) addedAt!: string;
  @ApiProperty({
    type: String,
    enum: ['ACTIVE', 'INACTIVE', 'UNAVAILABLE', 'REMOVED', 'UNKNOWN'],
  })
  status!: string;
  @ApiProperty({ type: FavoriteProductSummaryDto, nullable: true })
  product!: FavoriteProductSummaryDto | null;
}

export class CustomerFavoritesDto {
  @ApiProperty({ type: [FavoriteItemDto] }) items!: FavoriteItemDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: [String], format: 'uuid' }) favoriteProductIds!: string[];
  @ApiProperty({ type: Number }) limit!: number;
  @ApiProperty({ type: String, enum: ['AVAILABLE', 'UNAVAILABLE'] }) catalogStatus!: string;
}
