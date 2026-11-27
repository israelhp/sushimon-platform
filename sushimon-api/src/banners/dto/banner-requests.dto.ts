import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { toStrictInt } from '../../products/dto/product-requests.dto.js';
import { IMAGE_ALT_MAX } from '../banner-policy.js';

const IMAGE_ALT_DOC = {
  type: String,
  minLength: 1,
  maxLength: IMAGE_ALT_MAX,
  description:
    'Texto alternativo (accesibilidad), un solo idioma. Longitud fuera de 1..120 => 400; en blanco tras recortar => 422 BANNER_ALT_INVALID.',
} as const;

/** `POST /admin/banners`. `forbidNonWhitelisted`: cualquier otro campo (code, cta, fechas, …) => 400. */
export class CreateBannerRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('all')
  imageAssetId!: string;

  @ApiProperty(IMAGE_ALT_DOC)
  @IsString()
  @MinLength(1)
  @MaxLength(IMAGE_ALT_MAX)
  imageAlt!: string;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** `PATCH /admin/banners/:id`: `expectedVersion` obligatorio; el resto es parcial (lo omitido no se toca). */
export class UpdateBannerRequest {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  imageAssetId?: string;

  @ApiPropertyOptional(IMAGE_ALT_DOC)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(IMAGE_ALT_MAX)
  imageAlt?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** `DELETE /admin/banners/:id?expectedVersion=N` (no lleva cuerpo; mismo patrón de versión que `PATCH`). */
export class DeleteBannerQuery {
  @ApiProperty({ type: Number, minimum: 1 })
  @Transform(toStrictInt)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

/** Operaciones sin parámetros de consulta: con `forbidNonWhitelisted` cualquier parámetro => 400 (una sola clave de caché). */
export class NoQuery {}
