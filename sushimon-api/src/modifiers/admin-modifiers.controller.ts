import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { AdminModifiersService } from './admin-modifiers.service.js';
import {
  CreateModifierGroupRequest,
  CreateModifierRequest,
  DEFAULT_PAGE_SIZE,
  ListModifierGroupsQuery,
  ReorderModifiersRequest,
  ReplaceProductModifierGroupsRequest,
  UpdateModifierGroupRequest,
  UpdateModifierRequest,
} from './dto/modifier-requests.dto.js';
import {
  AdminModifierDto,
  AdminModifierGroupDto,
  AdminModifierGroupPageDto,
  AdminModifierListDto,
  AdminProductModifiersDto,
} from './dto/modifier-responses.dto.js';
import { ModifiersQueryService } from './modifiers-query.service.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const BAD_REQUEST = { status: 400, description: 'Datos inválidos o campos no permitidos' } as const;
const BUSY = { status: 503, description: 'MODIFIERS_BUSY (reintentable)' } as const;
const GROUP_NOT_FOUND = { status: 404, description: 'MODIFIER_GROUP_NOT_FOUND' } as const;
const PRODUCT_NOT_FOUND = { status: 404, description: 'PRODUCT_NOT_FOUND' } as const;

/**
 * Backoffice de modificadores (F12): JWT → personal activo con el permiso de CADA operación → aal2. Lectura:
 * `catalog.read` (cualquier alcance). Escrituras: `catalog.create`/`catalog.update` con alcance GLOBAL (se comprueba en
 * el servicio, antes de leer). Sin DELETE: se desactiva. La respuesta lleva `no-store` (middleware de `/v1/admin`).
 */
@ApiTags('modifiers')
@ApiBearerAuth()
@Controller('admin')
export class AdminModifiersController {
  constructor(
    @Inject(ModifiersQueryService) private readonly queries: ModifiersQueryService,
    @Inject(AdminModifiersService) private readonly commands: AdminModifiersService,
  ) {}

  @Get('modifier-groups')
  @RequireStaff('catalog.read')
  @ApiOperation({
    operationId: 'listAdminModifierGroups',
    summary: 'Grupos de modificadores (paginado, activos e inactivos)',
  })
  @ApiOkResponse({ type: AdminModifierGroupPageDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  @ApiResponse(UNAUTHORIZED)
  listGroups(@Query() query: ListModifierGroupsQuery): Promise<AdminModifierGroupPageDto> {
    return this.queries.listGroups({
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
    });
  }

  @Post('modifier-groups')
  @RequireStaff('catalog.create')
  @ApiOperation({
    operationId: 'createAdminModifierGroup',
    summary: 'Crea un grupo de modificadores (opcionalmente con sus opciones)',
  })
  @ApiCreatedResponse({ type: AdminModifierGroupDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 409, description: 'MODIFIER_GROUP_NAME_TAKEN o MODIFIER_NAME_TAKEN' })
  @ApiResponse({ status: 422, description: 'MODIFIER_LIMITS_INVALID o MODIFIER_LIMIT_REACHED' })
  @ApiResponse(BUSY)
  createGroup(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateModifierGroupRequest,
  ): Promise<AdminModifierGroupDto> {
    return this.commands.createGroup(staff, body);
  }

  @Get('modifier-groups/:id')
  @RequireStaff('catalog.read')
  @ApiOperation({
    operationId: 'getAdminModifierGroup',
    summary: 'Detalle de un grupo con todas sus opciones',
  })
  @ApiOkResponse({ type: AdminModifierGroupDto })
  @ApiResponse({ status: 400, description: 'UUID inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(GROUP_NOT_FOUND)
  getGroup(@Param('id', ParseUUIDPipe) id: string): Promise<AdminModifierGroupDto> {
    return this.queries.getGroup(id);
  }

  @Patch('modifier-groups/:id')
  @RequireStaff('catalog.update')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminModifierGroup',
    summary: 'Edita un grupo (nombre, límites, activar/desactivar)',
  })
  @ApiOkResponse({ type: AdminModifierGroupDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(GROUP_NOT_FOUND)
  @ApiResponse({ status: 409, description: 'MODIFIER_GROUP_NAME_TAKEN' })
  @ApiResponse({ status: 422, description: 'MODIFIER_LIMITS_INVALID' })
  @ApiResponse(BUSY)
  updateGroup(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateModifierGroupRequest,
  ): Promise<AdminModifierGroupDto> {
    return this.commands.updateGroup(staff, id, body);
  }

  @Post('modifier-groups/:id/modifiers')
  @RequireStaff('catalog.create')
  @ApiOperation({ operationId: 'createAdminModifier', summary: 'Crea una opción en un grupo' })
  @ApiCreatedResponse({ type: AdminModifierDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(GROUP_NOT_FOUND)
  @ApiResponse({ status: 409, description: 'MODIFIER_NAME_TAKEN' })
  @ApiResponse({ status: 422, description: 'MODIFIER_LIMIT_REACHED' })
  @ApiResponse(BUSY)
  createModifier(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateModifierRequest,
  ): Promise<AdminModifierDto> {
    return this.commands.createOption(staff, id, body);
  }

  @Put('modifier-groups/:id/modifiers/reorder')
  @RequireStaff('catalog.update')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'reorderAdminModifiers',
    summary: 'Reordena las opciones de un grupo',
  })
  @ApiOkResponse({ type: AdminModifierListDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(GROUP_NOT_FOUND)
  @ApiResponse({ status: 422, description: 'MODIFIER_REORDER_MISMATCH' })
  @ApiResponse(BUSY)
  reorder(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReorderModifiersRequest,
  ): Promise<AdminModifierListDto> {
    return this.commands.reorderOptions(staff, id, body.orderedIds);
  }

  @Patch('modifiers/:id')
  @RequireStaff('catalog.update')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminModifier',
    summary: 'Edita una opción (nombre, precio extra, activar/desactivar)',
  })
  @ApiOkResponse({ type: AdminModifierDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: 'MODIFIER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'MODIFIER_NAME_TAKEN' })
  @ApiResponse({ status: 422, description: 'MODIFIER_GROUP_UNSATISFIABLE' })
  @ApiResponse(BUSY)
  updateModifier(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateModifierRequest,
  ): Promise<AdminModifierDto> {
    return this.commands.updateOption(staff, id, body);
  }

  @Get('products/:id/modifiers')
  @RequireStaff('catalog.read')
  @ApiOperation({
    operationId: 'getAdminProductModifiers',
    summary: 'Grupos de modificadores asociados a un producto (con opciones)',
  })
  @ApiOkResponse({ type: AdminProductModifiersDto })
  @ApiResponse({ status: 400, description: 'UUID inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(PRODUCT_NOT_FOUND)
  getProductModifiers(@Param('id', ParseUUIDPipe) id: string): Promise<AdminProductModifiersDto> {
    return this.queries.getProductModifiers(id);
  }

  @Put('products/:id/modifier-groups')
  @RequireStaff('catalog.update')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'replaceAdminProductModifierGroups',
    summary: 'Reemplaza la lista de grupos asociados a un producto',
  })
  @ApiOkResponse({ type: AdminProductModifiersDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(PRODUCT_NOT_FOUND)
  @ApiResponse({
    status: 422,
    description: 'MODIFIER_GROUP_INVALID o MODIFIER_LIMIT_REACHED',
  })
  @ApiResponse(BUSY)
  replaceProductGroups(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReplaceProductModifierGroupsRequest,
  ): Promise<AdminProductModifiersDto> {
    return this.commands.replaceProductGroups(staff, id, body.groupIds);
  }
}
