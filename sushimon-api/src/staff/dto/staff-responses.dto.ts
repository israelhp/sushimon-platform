import { ApiProperty } from '@nestjs/swagger';

export class RoleRefDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
}

export class BranchRefDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  code!: string;
}

export class StaffRefDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  fullName!: string;
}

export class StaffAssignmentViewDto {
  @ApiProperty({ type: RoleRefDto })
  role!: RoleRefDto;
  @ApiProperty({ type: BranchRefDto, nullable: true, description: 'null = alcance global.' })
  branch!: BranchRefDto | null;
  @ApiProperty({ type: Boolean })
  effective!: boolean;
}

/** Nunca incluye `authUserId`. */
export class AdminStaffDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: String })
  email!: string;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, enum: ['PENDING_LINK', 'LINKED'] })
  identityStatus!: 'PENDING_LINK' | 'LINKED';
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  linkedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: StaffRefDto, nullable: true })
  createdBy!: StaffRefDto | null;
  @ApiProperty({ type: [StaffAssignmentViewDto] })
  assignments!: StaffAssignmentViewDto[];
  @ApiProperty({ type: Boolean })
  manageable!: boolean;
}

export class AdminStaffPage {
  @ApiProperty({ type: [AdminStaffDto] })
  items!: AdminStaffDto[];
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
  @ApiProperty({ type: Number })
  total!: number;
}

export class PermissionRefDto {
  @ApiProperty({ type: String, example: 'orders.accept' })
  code!: string;
  @ApiProperty({ type: String })
  description!: string;
  @ApiProperty({ type: String })
  module!: string;
}

export class AdminRoleDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Boolean })
  isSystem!: boolean;
  @ApiProperty({ type: [PermissionRefDto] })
  permissions!: PermissionRefDto[];
  @ApiProperty({ type: Number })
  assignedStaffCount!: number;
}

export class AdminRoleList {
  @ApiProperty({ type: [AdminRoleDto] })
  items!: AdminRoleDto[];
}

export class PermissionEntryDto {
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  description!: string;
}

export class AdminPermissionModuleDto {
  @ApiProperty({ type: String })
  module!: string;
  @ApiProperty({ type: [PermissionEntryDto] })
  permissions!: PermissionEntryDto[];
}

export class AdminPermissionCatalog {
  @ApiProperty({ type: [AdminPermissionModuleDto] })
  items!: AdminPermissionModuleDto[];
}
