import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PageQuery, toBoolean } from '../../products/dto/product-requests.dto.js';
import { SEARCH_MAX } from '../../products/product-policy.js';
import { PRICE_PATTERN } from '../branch-product-policy.js';

export class ListAdminBranchProductsQuery extends PageQuery {
  @ApiPropertyOptional({ type: String, maxLength: SEARCH_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX)
  q?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'Sin valor = todos.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ type: Boolean, description: 'Sin valor = todos.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasOverride?: boolean;
}

/** Solo la FORMA (cadena `^[0-9]{1,6}\.[0-9]{2}$` o `null`); `"0.00"` => 422 en la policy. */
export class SetBranchProductPricingRequest {
  @ApiProperty({
    type: String,
    nullable: true,
    pattern: PRICE_PATTERN.source,
    example: '85.00',
    description: 'Cadena decimal GTQ o `null` para eliminar el override.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(PRICE_PATTERN)
  priceOverride!: string | null;
}

export class SetProductAvailabilityRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  available!: boolean;
}
