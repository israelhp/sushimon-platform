import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

/** `altText` > 200 falla con 422 `PRODUCT_MEDIA_INVALID` (policy), no con 400: aquí solo la forma. */
export class AttachProductMediaRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  assetId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  altText?: string | null;
}

export class UpdateProductMediaRequest {
  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  altText!: string | null;
}

export class ReorderProductMediaRequest {
  @ApiProperty({ type: [String], maxItems: 8, description: 'Ids de `product_media`.' })
  @IsArray()
  @ArrayMaxSize(8)
  @IsUUID('all', { each: true })
  orderedIds!: string[];
}
