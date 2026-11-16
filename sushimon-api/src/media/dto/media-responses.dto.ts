import { ApiProperty } from '@nestjs/swagger';

export class AdminMediaAssetDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, enum: ['PRODUCT_IMAGE'] }) kind!: 'PRODUCT_IMAGE';
  @ApiProperty({ type: String, enum: ['PENDING', 'READY'] }) status!: 'PENDING' | 'READY';
  @ApiProperty({ type: String, format: 'uri', nullable: true }) url!: string | null;
  @ApiProperty({ type: String }) mimeType!: string;
  @ApiProperty({ type: Number, format: 'int64' }) sizeBytes!: number;
  @ApiProperty({ type: String }) checksumSha256!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) confirmedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) expiresAt!: string | null;
  @ApiProperty({ type: Number }) usageCount!: number;
  @ApiProperty({ type: String, enum: ['R2', 'MOCK'] }) storageMode!: 'R2' | 'MOCK';
}

export class AdminMediaUsageDto {
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productMediaId!: string;
}

export class AdminMediaAssetDetailDto extends AdminMediaAssetDto {
  @ApiProperty({ type: () => [AdminMediaUsageDto] }) usages!: AdminMediaUsageDto[];
}

export class AdminMediaAssetPageDto {
  @ApiProperty({ type: () => [AdminMediaAssetDto] }) items!: AdminMediaAssetDto[];
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) pageSize!: number;
  @ApiProperty({ type: Number }) total!: number;
}

export class AdminMediaUploadIntentDto {
  @ApiProperty({ type: String, format: 'uuid' }) assetId!: string;
  @ApiProperty({ type: Boolean }) deduplicated!: boolean;
  @ApiProperty({
    type: String,
    format: 'uri',
    nullable: true,
    description: 'URL PUT firmada de corta vida. Secreto: no guardar ni registrar.',
  })
  uploadUrl!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, nullable: true })
  headers!: Record<string, string> | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) expiresAt!: string | null;
  @ApiProperty({ type: String, enum: ['R2', 'MOCK'] }) storageMode!: 'R2' | 'MOCK';
  @ApiProperty({ type: () => AdminMediaAssetDto }) asset!: AdminMediaAssetDto;
}
