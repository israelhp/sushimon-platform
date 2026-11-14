import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Principal } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { MeResponse } from '../identity/identity.dto.js';
import { CustomerProfileService, toCustomerDto } from './customer-profile.service.js';
import {
  CustomerStorefrontContextDto,
  UpdateCustomerProfileDto,
} from './dto/customer-profile.dto.js';

/**
 * Perfil propio del cliente. `GET /v1/me` (F01) sigue en IdentityModule; aquí solo se añaden la actualización
 * y el contexto agregado. Sin endpoints por id: el sujeto es siempre el del JWT.
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class CustomerProfileController {
  constructor(@Inject(CustomerProfileService) private readonly profiles: CustomerProfileService) {}

  @Patch()
  @ApiOperation({
    operationId: 'updateMe',
    summary: 'Actualiza nombre y teléfono del cliente autenticado',
  })
  @ApiBody({ type: UpdateCustomerProfileDto })
  @ApiOkResponse({ type: MeResponse })
  @ApiResponse({ status: 400, description: 'Datos inválidos o campo no permitido' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  async update(
    @CurrentUser() principal: Principal,
    @Body() body: UpdateCustomerProfileDto,
  ): Promise<MeResponse> {
    const view = await this.profiles.updateProfile(principal, body);
    return {
      authUserId: view.authUserId,
      email: view.email,
      customer: toCustomerDto(view.customer),
      isStaff: view.isStaff,
    };
  }

  @Get('storefront')
  @ApiOperation({
    operationId: 'getCustomerStorefront',
    summary: 'Contexto agregado de Mi cuenta',
  })
  @ApiOkResponse({ type: CustomerStorefrontContextDto })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  getStorefront(@CurrentUser() principal: Principal): Promise<CustomerStorefrontContextDto> {
    return this.profiles.getStorefront(principal);
  }
}
