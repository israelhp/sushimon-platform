import { ApiProperty } from '@nestjs/swagger';

/** Esquemas de respuesta de `/v1/admin/riders` (contrato: `AdminRiderSummary`, `AdminRider`, `AdminRiderPage`; F27). */
const VEHICLES = ['MOTORCYCLE', 'BICYCLE', 'CAR', 'ON_FOOT'];

export class AdminRiderSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;
  @ApiProperty({ type: String })
  branchName!: string;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: String, example: '+502****5678' })
  phoneMasked!: string;
  @ApiProperty({ type: String, enum: VEHICLES, nullable: true })
  vehicleType!: 'MOTORCYCLE' | 'BICYCLE' | 'CAR' | 'ON_FOOT' | null;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, enum: ['AVAILABLE', 'UNAVAILABLE'] })
  availability!: 'AVAILABLE' | 'UNAVAILABLE';
  @ApiProperty({ type: Boolean })
  busy!: boolean;
  @ApiProperty({ type: Boolean })
  busyKnown!: boolean;
  @ApiProperty({ type: String, enum: ['INACTIVE', 'UNAVAILABLE', 'BUSY', 'AVAILABLE'] })
  operationalState!: 'INACTIVE' | 'UNAVAILABLE' | 'BUSY' | 'AVAILABLE';
  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AdminRiderDto extends AdminRiderSummaryDto {
  @ApiProperty({ type: String, example: '+50255501122' })
  phone!: string;
  @ApiProperty({ type: String, nullable: true })
  licensePlate!: string | null;
}

export class AdminRiderPageDto {
  @ApiProperty({ type: [AdminRiderSummaryDto] })
  items!: AdminRiderSummaryDto[];
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
  @ApiProperty({ type: Number })
  total!: number;
}
