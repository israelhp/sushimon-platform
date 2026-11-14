import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EMAIL_MAX, FULL_NAME_MAX, REASON_MAX } from '../staff-policy.js';

/** La forma se valida aquí; normalización y reglas de dominio viven en `staff-policy.ts`. */
export class StaffAssignmentInputDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  roleId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null = global (solo con el rol admin y solo otorgable con alcance global).',
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  branchId!: string | null;
}

const ASSIGNMENTS_MAX = 20;

export class CreateStaffRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: FULL_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(FULL_NAME_MAX)
  fullName!: string;

  @ApiProperty({ type: String, format: 'email', maxLength: EMAIL_MAX })
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  @ApiProperty({
    type: [StaffAssignmentInputDto],
    minItems: 1,
    maxItems: ASSIGNMENTS_MAX,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ASSIGNMENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => StaffAssignmentInputDto)
  assignments!: StaffAssignmentInputDto[];
}

/** `authUserId`, `active` y demás no están declarados: `forbidNonWhitelisted` los rechaza (400). */
export class UpdateStaffRequest {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: FULL_NAME_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(FULL_NAME_MAX)
  fullName?: string;

  @ApiPropertyOptional({ type: String, format: 'email', maxLength: EMAIL_MAX })
  @ValidateIf((_, v) => v !== undefined)
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email?: string;
}

export class UpdateStaffStatusRequest {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  active!: boolean;

  @ApiPropertyOptional({
    type: String,
    maxLength: REASON_MAX,
    description: 'Obligatorio al desactivar.',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(REASON_MAX)
  reason?: string;
}

export class ReplaceStaffAssignmentsRequest {
  @ApiProperty({ type: [StaffAssignmentInputDto], minItems: 1, maxItems: ASSIGNMENTS_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ASSIGNMENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => StaffAssignmentInputDto)
  assignments!: StaffAssignmentInputDto[];
}

export class ReplaceRolePermissionsRequest {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100, uniqueItems: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z_]+\.[a-z_]+$/, { each: true })
  permissions!: string[];
}

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class ListAdminStaffQuery {
  @ApiPropertyOptional({ type: String, maxLength: 100, description: 'Nombre o correo (contiene).' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: String, enum: ['PENDING_LINK', 'LINKED'] })
  @IsOptional()
  @IsIn(['PENDING_LINK', 'LINKED'])
  identityStatus?: 'PENDING_LINK' | 'LINKED';

  @ApiPropertyOptional({
    type: String,
    enum: ['fullName', 'email', 'createdAt'],
    default: 'fullName',
  })
  @IsOptional()
  @IsIn(['fullName', 'email', 'createdAt'])
  sort?: 'fullName' | 'email' | 'createdAt';

  @ApiPropertyOptional({ type: String, enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 1_000_000, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
