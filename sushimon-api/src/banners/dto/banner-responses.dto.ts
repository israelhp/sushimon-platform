import { ApiProperty } from '@nestjs/swagger';

// ---------- público ----------

export class StoreBannerImageDto {
  @ApiProperty({
    type: String,
    format: 'uri',
    description: 'URL pública permanente; nunca firmada.',
  })
  url!: string;
  @ApiProperty({ type: String }) mimeType!: string;
}

export class StoreBannerDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: () => StoreBannerImageDto }) image!: StoreBannerImageDto;
  @ApiProperty({ type: String, description: 'Texto alternativo de la imagen (un solo idioma).' })
  alt!: string;
}

export class StoreBannerListDto {
  @ApiProperty({ type: () => [StoreBannerDto], maxItems: 5 }) items!: StoreBannerDto[];
}

// ---------- admin ----------

export class AdminBannerImageDto {
  @ApiProperty({ type: String, format: 'uuid' }) assetId!: string;
  @ApiProperty({ type: String, format: 'uri', nullable: true }) url!: string | null;
  @ApiProperty({ type: String }) mimeType!: string;
  @ApiProperty({ type: Number, format: 'int64' }) sizeBytes!: number;
}

export class AdminBannerDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: () => AdminBannerImageDto }) image!: AdminBannerImageDto;
  @ApiProperty({ type: String }) imageAlt!: string;
  @ApiProperty({ type: Boolean }) active!: boolean;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class AdminBannerListDto {
  @ApiProperty({ type: () => [AdminBannerDto], maxItems: 5 }) items!: AdminBannerDto[];
  @ApiProperty({ type: Number, enum: [5] }) limit!: 5;
}
