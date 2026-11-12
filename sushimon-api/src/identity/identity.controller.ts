import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AuthContextResponse, MeResponse } from './identity.dto.js';
import { IdentityService } from './identity.service.js';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Get('context')
  @ApiOperation({
    operationId: 'getAuthContext',
    summary: 'Contexto de identidad y autorización del token actual',
  })
  @ApiOkResponse({ type: AuthContextResponse })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido, expirado o de otro emisor' })
  async getContext(@CurrentUser() principal: Principal): Promise<AuthContextResponse> {
    const [staff, isCustomer] = await Promise.all([
      this.identity.getStaffContext(principal),
      this.identity.hasCustomer(principal.authUserId),
    ]);
    return {
      authUserId: principal.authUserId,
      email: principal.email,
      provider: principal.provider,
      isCustomer,
      staff,
      backofficeAccess: staff !== null,
    };
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Get()
  @ApiOperation({ operationId: 'getMe', summary: 'Perfil del cliente autenticado' })
  @ApiOkResponse({ type: MeResponse })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  async getMe(@CurrentUser() principal: Principal): Promise<MeResponse> {
    const [customer, staff] = await Promise.all([
      this.identity.ensureCustomer(principal),
      this.identity.getStaffContext(principal),
    ]);
    return {
      authUserId: principal.authUserId,
      email: principal.email,
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        email: customer.email,
        phone: customer.phone,
        createdAt: customer.createdAt.toISOString(),
      },
      isStaff: staff !== null,
    };
  }
}
