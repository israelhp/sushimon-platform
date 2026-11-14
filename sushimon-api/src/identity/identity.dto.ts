import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthStaffAssignmentDto {
  @ApiProperty({ type: String, enum: ['admin', 'manager', 'kitchen'] })
  role!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  branchId!: string | null;
}

export class AuthStaffContextDto {
  @ApiProperty({ type: String, format: 'uuid' })
  staffId!: string;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: [AuthStaffAssignmentDto] })
  assignments!: AuthStaffAssignmentDto[];
  @ApiProperty({ type: [String] })
  permissions!: string[];
  @ApiProperty({ type: Boolean })
  allBranches!: boolean;
  @ApiProperty({ type: [String], format: 'uuid' })
  branchIds!: string[];
}

export class AuthContextResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  authUserId!: string;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true })
  provider!: string | null;
  @ApiProperty({ type: Boolean })
  isCustomer!: boolean;
  @ApiPropertyOptional({ type: AuthStaffContextDto, nullable: true })
  staff!: AuthStaffContextDto | null;
  @ApiProperty({ type: Boolean })
  backofficeAccess!: boolean;
}

export class CustomerProfileDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class MeResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  authUserId!: string;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: CustomerProfileDto })
  customer!: CustomerProfileDto;
  @ApiProperty({ type: Boolean })
  isStaff!: boolean;
}
