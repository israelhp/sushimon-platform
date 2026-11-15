import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CustomerProfileDto } from '../../identity/identity.dto.js';

/**
 * Cuerpo de PATCH /v1/me. `forbidNonWhitelisted` rechaza cualquier otra propiedad (identidad, correo, roles…).
 * `phone: null` borra el teléfono; omitido = sin cambios. Las reglas finas (formato, longitud de caracteres)
 * viven en `customer-profile.policy.ts`, no aquí.
 */
export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({ type: String, minLength: 2, maxLength: 120 })
  @ValidateIf((o: UpdateCustomerProfileDto) => o.fullName !== undefined)
  @IsString({ message: 'fullName: debe ser texto' })
  @MaxLength(240, { message: 'fullName: demasiado largo' })
  fullName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20 })
  @IsOptional()
  @IsString({ message: 'phone: debe ser texto o null' })
  @MaxLength(20, { message: 'phone: demasiado largo' })
  phone?: string | null;
}

export class CustomerStorefrontContextDto {
  @ApiProperty({ type: String, format: 'uuid' })
  authUserId!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  provider!: string | null;

  @ApiProperty({ type: String, format: 'uri', nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ type: CustomerProfileDto })
  customer!: CustomerProfileDto;

  @ApiProperty({ type: Boolean })
  isStaff!: boolean;

  @ApiProperty({
    type: [String],
    enum: ['addresses', 'favorites', 'orders'],
    description: 'Secciones sin contrato todavía (F05, F06, F23). No llevan contadores.',
  })
  pendingSections!: Array<'addresses' | 'favorites' | 'orders'>;
}
