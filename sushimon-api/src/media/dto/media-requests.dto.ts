import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQuery, toBoolean } from '../../products/dto/product-requests.dto.js';

export const MEDIA_KINDS = ['PRODUCT_IMAGE'] as const;
export const MEDIA_STATUSES = ['PENDING', 'READY'] as const;

/** Forma del intent. El MIME y el tamaño fallan con 422 (regla de negocio), no con 400: aquí solo la forma. */
export class CreateMediaUploadIntentRequest {
  @ApiProperty({ type: String, enum: MEDIA_KINDS })
  @IsIn(MEDIA_KINDS)
  kind!: 'PRODUCT_IMAGE';

  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @MaxLength(100)
  mimeType!: string;

  @ApiProperty({ type: Number, format: 'int64', minimum: 1 })
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @ApiProperty({ type: String, pattern: '^[0-9a-f]{64}$' })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  checksumSha256!: string;
}

export class CompleteMediaUploadRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  assetId!: string;
}

export class ListAdminMediaQuery extends PageQuery {
  @ApiPropertyOptional({ type: String, enum: MEDIA_KINDS })
  @IsOptional()
  @IsIn(MEDIA_KINDS)
  kind?: 'PRODUCT_IMAGE';

  @ApiPropertyOptional({ type: String, enum: MEDIA_STATUSES })
  @IsOptional()
  @IsIn(MEDIA_STATUSES)
  status?: 'PENDING' | 'READY';

  @ApiPropertyOptional({
    type: Boolean,
    description: '`true` = solo sin usos; `false` = solo usados; sin valor = todos.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unreferenced?: boolean;
}
