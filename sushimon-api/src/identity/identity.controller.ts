import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '../auth/auth.types.js';
import { CurrentStaff, CurrentUser } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import type { StaffContext } from './identity.types.js';
import { AdminContextResponse, AuthContextResponse, MeResponse } from './identity.dto.js';
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
    const staffAuthorized = staff !== null;
    const mfaOk = principal.aal === 'aal2';
    const access = !staffAuthorized ? 'NOT_STAFF' : mfaOk ? 'GRANTED' : 'MFA_REQUIRED';
    return {
      authUserId: principal.authUserId,
      email: principal.email,
      provider: principal.provider,
      isCustomer,
      aal: principal.aal,
      staffAuthorized,
      mfaRequired: staffAuthorized && !mfaOk,
      access,
      // Roles, permisos y sucursales solo se revelan con la sesión aal2 (nada administrativo antes).
      staff: access === 'GRANTED' ? staff : null,
      backofficeAccess: access === 'GRANTED',
    };
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@RequireStaff()
@Controller('admin')
export class AdminController {
  @Get('me/context')
  @ApiOperation({
    operationId: 'getAdminContext',
    summary: 'Contexto administrativo del empleado (requiere aal2)',
  })
  @ApiOkResponse({ type: AdminContextResponse })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  getAdminContext(
    @CurrentUser() principal: Principal,
    @CurrentStaff() staff: StaffContext,
  ): AdminContextResponse {
    return { authUserId: principal.authUserId, email: principal.email, aal: 'aal2', staff };
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
