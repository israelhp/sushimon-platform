import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Cuerpos de `/v1/me/addresses`. `forbidNonWhitelisted` (ValidationPipe global) rechaza cualquier propiedad no
 * declarada aquí, incluido `isDefault` en PATCH (la predeterminada se cambia solo en /default). Las reglas finas
 * (normalización, longitudes exactas, duplicados) viven en `customer-address.policy.ts`.
 */
export class CreateCustomerAddressDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 40, example: 'Casa' })
  @IsString({ message: 'label: debe ser texto' })
  @MaxLength(200, { message: 'label: demasiado largo' })
  label!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID('all', { message: 'municipalityId: debe ser un UUID' })
  municipalityId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @IsString({ message: 'zone: debe ser texto o null' })
  @MaxLength(200, { message: 'zone: demasiado largo' })
  zone?: string | null;

  @ApiProperty({ type: String, minLength: 1, maxLength: 200 })
  @IsString({ message: 'addressLine: debe ser texto' })
  @MaxLength(1000, { message: 'addressLine: demasiado largo' })
  addressLine!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'referenceNote: debe ser texto o null' })
  @MaxLength(1000, { message: 'referenceNote: demasiado largo' })
  referenceNote?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -90, maximum: 90 })
  @IsOptional()
  @ValidateIf((o: { latitude?: unknown }) => o.latitude !== null)
  @IsNumber({}, { message: 'latitude: debe ser número o null' })
  latitude?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -180, maximum: 180 })
  @IsOptional()
  @ValidateIf((o: { longitude?: unknown }) => o.longitude !== null)
  @IsNumber({}, { message: 'longitude: debe ser número o null' })
  longitude?: number | null;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Si ya hay una predeterminada, true la reemplaza. La primera dirección queda predeterminada siempre.',
  })
  @IsOptional()
  @IsBoolean({ message: 'isDefault: debe ser booleano' })
  isDefault?: boolean;
}

/** PATCH parcial: omitido = sin cambios; `zone`/`referenceNote`/coordenadas admiten null para borrar. */
export class UpdateCustomerAddressDto {
  @ApiPropertyOptional({ type: String, maxLength: 40 })
  @IsOptional()
  @IsString({ message: 'label: debe ser texto' })
  @MaxLength(200, { message: 'label: demasiado largo' })
  label?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'municipalityId: debe ser un UUID' })
  municipalityId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @IsString({ message: 'zone: debe ser texto o null' })
  @MaxLength(200, { message: 'zone: demasiado largo' })
  zone?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'addressLine: debe ser texto' })
  @MaxLength(1000, { message: 'addressLine: demasiado largo' })
  addressLine?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'referenceNote: debe ser texto o null' })
  @MaxLength(1000, { message: 'referenceNote: demasiado largo' })
  referenceNote?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -90, maximum: 90 })
  @IsOptional()
  @ValidateIf((o: { latitude?: unknown }) => o.latitude !== null)
  @IsNumber({}, { message: 'latitude: debe ser número o null' })
  latitude?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: -180, maximum: 180 })
  @IsOptional()
  @ValidateIf((o: { longitude?: unknown }) => o.longitude !== null)
  @IsNumber({}, { message: 'longitude: debe ser número o null' })
  longitude?: number | null;
}

/** Referencia de catálogo (departamento o municipio), solo lectura. */
export class PlaceRefDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;
}

/** Respuesta de una dirección. Sin identificadores de otros clientes; sin cobertura ni tarifa. */
export class CustomerAddressDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({ type: PlaceRefDto })
  department!: PlaceRefDto;

  @ApiProperty({ type: PlaceRefDto })
  municipality!: PlaceRefDto;

  @ApiProperty({ type: String, nullable: true })
  zone!: string | null;

  @ApiProperty({ type: String })
  addressLine!: string;

  @ApiProperty({ type: String, nullable: true })
  referenceNote!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  latitude!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  longitude!: number | null;

  @ApiProperty({ type: Boolean })
  isDefault!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class CustomerAddressListDto {
  @ApiProperty({ type: [CustomerAddressDto] })
  items!: CustomerAddressDto[];
}
