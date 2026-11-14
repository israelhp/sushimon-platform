import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

export class AuthStaffAssignmentDto {
  @ApiProperty({ type: String, enum: ['admin', 'manager', 'kitchen', 'staff'] })
  role!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  branchId!: string | null;
}

export class BranchRefDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  code!: string;
}

export class GrantScopeDto {
  @ApiProperty({ type: Boolean })
  allBranches!: boolean;
  @ApiProperty({ type: [String], format: 'uuid' })
  branchIds!: string[];
}

@ApiExtraModels(GrantScopeDto)
export class AuthStaffContextDto {
  @ApiProperty({ type: String, format: 'uuid' })
  staffId!: string;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: [AuthStaffAssignmentDto] })
  assignments!: AuthStaffAssignmentDto[];
  @ApiProperty({ type: [String], description: 'Unión de permisos (solo UI; no autoriza).' })
  permissions!: string[];
  @ApiProperty({ type: Boolean, deprecated: true })
  allBranches!: boolean;
  @ApiProperty({ type: [String], format: 'uuid', deprecated: true })
  branchIds!: string[];
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(GrantScopeDto) },
    description: 'Permiso -> alcance. Solo asignaciones efectivas.',
  })
  grants!: Record<string, GrantScopeDto>;
  @ApiProperty({ type: [BranchRefDto] })
  branches!: BranchRefDto[];
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
  @ApiProperty({ type: String, enum: ['aal1', 'aal2'] })
  aal!: 'aal1' | 'aal2';
  @ApiProperty({ type: Boolean })
  staffAuthorized!: boolean;
  @ApiProperty({ type: Boolean })
  mfaRequired!: boolean;
  @ApiProperty({ type: String, enum: ['NOT_STAFF', 'MFA_REQUIRED', 'GRANTED'] })
  access!: 'NOT_STAFF' | 'MFA_REQUIRED' | 'GRANTED';
  @ApiPropertyOptional({ type: AuthStaffContextDto, nullable: true })
  staff!: AuthStaffContextDto | null;
  @ApiProperty({ type: Boolean })
  backofficeAccess!: boolean;
}

export class AdminContextResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  authUserId!: string;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, enum: ['aal2'] })
  aal!: 'aal2';
  @ApiProperty({ type: AuthStaffContextDto })
  staff!: AuthStaffContextDto;
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
