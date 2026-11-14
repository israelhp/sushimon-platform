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
import { BranchesCommandsService } from './branches-commands.service.js';
import { BranchesQueryService } from './branches-query.service.js';
import { AdminBranchDto, AdminBranchPage } from './dto/branch-responses.dto.js';
import {
  CreateBranchRequest,
  ListAdminBranchesQuery,
  UpdateBranchRequest,
  UpdateBranchStatusRequest,
} from './dto/branch-requests.dto.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const NOT_FOUND = { status: 404, description: 'No existe o fuera de alcance' } as const;

/** Backoffice de sucursales: JWT (global) → personal activo con permiso `branches` → aal2. Sin DELETE. */
@ApiTags('branches')
@ApiBearerAuth()
@RequireStaff('branches')
@Controller('admin/branches')
export class AdminBranchesController {
  constructor(
    @Inject(BranchesQueryService) private readonly queries: BranchesQueryService,
    @Inject(BranchesCommandsService) private readonly commands: BranchesCommandsService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listAdminBranches',
    summary: 'Sucursales del backoffice (activas e inactivas, paginado)',
  })
  @ApiOkResponse({ type: AdminBranchPage })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  @ApiResponse(UNAUTHORIZED)
  list(
    @CurrentStaff() staff: StaffContext,
    @Query() query: ListAdminBranchesQuery,
  ): Promise<AdminBranchPage> {
    return this.queries.listAdmin(staff, query);
  }

  @Post()
  @ApiOperation({ operationId: 'createAdminBranch', summary: 'Crea una sucursal' })
  @ApiCreatedResponse({ type: AdminBranchDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 409, description: 'Ya existe una sucursal con ese código' })
  create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateBranchRequest,
  ): Promise<AdminBranchDto> {
    return this.commands.create(staff, body);
  }

  @Get(':id')
  @ApiOperation({
    operationId: 'getAdminBranch',
    summary: 'Detalle administrativo de una sucursal',
  })
  @ApiOkResponse({ type: AdminBranchDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  getOne(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminBranchDto> {
    return this.queries.getAdminById(staff, id);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminBranch',
    summary: 'Actualiza datos básicos de una sucursal',
  })
  @ApiOkResponse({ type: AdminBranchDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos o campos no permitidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBranchRequest,
  ): Promise<AdminBranchDto> {
    return this.commands.update(staff, id, body);
  }

  @Patch(':id/status')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminBranchStatus',
    summary: 'Activa o desactiva una sucursal (estado administrativo)',
  })
  @ApiOkResponse({ type: AdminBranchDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos (p. ej. desactivar sin motivo)' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  changeStatus(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBranchStatusRequest,
  ): Promise<AdminBranchDto> {
    return this.commands.changeStatus(staff, id, body);
  }
}
