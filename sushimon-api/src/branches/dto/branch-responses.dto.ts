import { ApiProperty } from '@nestjs/swagger';

export class PublicBranchDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({
    type: String,
    description: 'Identificador de negocio estable (slug en minúsculas).',
  })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  address!: string;
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
  @ApiProperty({ type: Number, nullable: true, minimum: -90, maximum: 90 })
  latitude!: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: -180, maximum: 180 })
  longitude!: number | null;
}

export class PublicBranchListResponse {
  @ApiProperty({ type: [PublicBranchDto] })
  items!: PublicBranchDto[];
}

export class AdminBranchDto extends PublicBranchDto {
  @ApiProperty({
    type: Boolean,
    description: 'Estado ADMINISTRATIVO. No es "abierta ahora" (F08) ni "acepta pedidos".',
  })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class AdminBranchPage {
  @ApiProperty({ type: [AdminBranchDto] })
  items!: AdminBranchDto[];
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
  @ApiProperty({ type: Number })
  total!: number;
}
