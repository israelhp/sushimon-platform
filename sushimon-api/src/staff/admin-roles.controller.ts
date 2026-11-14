import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { ReplaceRolePermissionsRequest } from './dto/staff-requests.dto.js';
import { AdminPermissionCatalog, AdminRoleDto, AdminRoleList } from './dto/staff-responses.dto.js';
import { RolesService } from './roles.service.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const BAD_REQUEST = { status: 400, description: 'Datos o parámetros inválidos' } as const;
const NOT_FOUND = { status: 404, description: 'No existe' } as const;

/** Roles y permisos (F03). No hay POST/PATCH/DELETE de roles: los roles personalizados están pendientes. */
@ApiTags('roles')
@ApiBearerAuth()
@Controller('admin/roles')
export class AdminRolesController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  @Get()
  @RequireStaff('roles.read')
  @ApiOperation({ operationId: 'listAdminRoles', summary: 'Roles y sus permisos' })
  @ApiOkResponse({ type: AdminRoleList })
  @ApiResponse(UNAUTHORIZED)
  list(): Promise<AdminRoleList> {
    return this.roles.list();
  }

  @Get(':id')
  @RequireStaff('roles.read')
  @ApiOperation({ operationId: 'getAdminRole', summary: 'Detalle de un rol' })
  @ApiOkResponse({ type: AdminRoleDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  getOne(@Param('id', ParseUUIDPipe) id: string): Promise<AdminRoleDto> {
    return this.roles.get(id);
  }

  @Put(':id/permissions')
  @HttpCode(200)
  @RequireStaff('roles.manage')
  @ApiOperation({
    operationId: 'replaceAdminRolePermissions',
    summary: 'Reemplaza los permisos de un rol',
  })
  @ApiOkResponse({ type: AdminRoleDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({ status: 409, description: 'El rol es del sistema y no es editable' })
  replacePermissions(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReplaceRolePermissionsRequest,
  ): Promise<AdminRoleDto> {
    return this.roles.replacePermissions(staff, id, body.permissions);
  }
}

@ApiTags('roles')
@ApiBearerAuth()
@Controller('admin/permissions')
export class AdminPermissionsController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  @Get()
  @RequireStaff('roles.read')
  @ApiOperation({
    operationId: 'listAdminPermissions',
    summary: 'Catálogo de permisos agrupado por módulo',
  })
  @ApiOkResponse({ type: AdminPermissionCatalog })
  @ApiResponse(UNAUTHORIZED)
  list(): Promise<AdminPermissionCatalog> {
    return this.roles.permissions();
  }
}
