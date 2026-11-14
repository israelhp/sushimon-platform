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
import { AdminStaffDto, AdminStaffPage } from './dto/staff-responses.dto.js';
import {
  CreateStaffRequest,
  ListAdminStaffQuery,
  ReplaceStaffAssignmentsRequest,
  UpdateStaffRequest,
  UpdateStaffStatusRequest,
} from './dto/staff-requests.dto.js';
import { StaffCommandsService } from './staff-commands.service.js';
import { StaffQueriesService } from './staff-queries.service.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const NOT_FOUND = { status: 404, description: 'No existe o fuera de alcance' } as const;
const CONFLICT = { status: 409, description: 'Conflicto con el estado actual' } as const;
const BAD_REQUEST = { status: 400, description: 'Datos o parámetros inválidos' } as const;

/**
 * Backoffice de personal: JWT (global) → personal activo con el permiso de CADA operación → aal2. El alcance
 * por sucursal y las reglas anti-escalada (subconjunto, dominio, autoedición, último administrador) viven en
 * los servicios. Sin DELETE. Nunca se expone `authUserId`.
 */
@ApiTags('staff')
@ApiBearerAuth()
@Controller('admin/staff')
export class AdminStaffController {
  constructor(
    @Inject(StaffQueriesService) private readonly queries: StaffQueriesService,
    @Inject(StaffCommandsService) private readonly commands: StaffCommandsService,
  ) {}

  @Get()
  @RequireStaff('staff.read')
  @ApiOperation({ operationId: 'listAdminStaff', summary: 'Empleados del backoffice (paginado)' })
  @ApiOkResponse({ type: AdminStaffPage })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  list(
    @CurrentStaff() staff: StaffContext,
    @Query() query: ListAdminStaffQuery,
  ): Promise<AdminStaffPage> {
    return this.queries.list(staff, query);
  }

  @Post()
  @RequireStaff('staff.create', 'staff.assign_roles')
  @ApiOperation({
    operationId: 'createAdminStaff',
    summary: 'Preautoriza a un empleado (sin crear cuenta de Auth)',
  })
  @ApiCreatedResponse({ type: AdminStaffDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 409, description: 'Ya existe un empleado con ese correo' })
  create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateStaffRequest,
  ): Promise<AdminStaffDto> {
    return this.commands.create(staff, body);
  }

  @Get(':id')
  @RequireStaff('staff.read')
  @ApiOperation({ operationId: 'getAdminStaff', summary: 'Detalle de un empleado' })
  @ApiOkResponse({ type: AdminStaffDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  getOne(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminStaffDto> {
    return this.queries.get(staff, id);
  }

  @Patch(':id')
  @HttpCode(200)
  @RequireStaff('staff.update')
  @ApiOperation({
    operationId: 'updateAdminStaff',
    summary: 'Edita nombre o correo de un empleado',
  })
  @ApiOkResponse({ type: AdminStaffDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(CONFLICT)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStaffRequest,
  ): Promise<AdminStaffDto> {
    return this.commands.update(staff, id, body);
  }

  @Patch(':id/status')
  @HttpCode(200)
  @RequireStaff('staff.disable')
  @ApiOperation({
    operationId: 'updateAdminStaffStatus',
    summary: 'Activa o desactiva a un empleado',
  })
  @ApiOkResponse({ type: AdminStaffDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(CONFLICT)
  changeStatus(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStaffStatusRequest,
  ): Promise<AdminStaffDto> {
    return this.commands.changeStatus(staff, id, body);
  }

  @Put(':id/assignments')
  @HttpCode(200)
  @RequireStaff('staff.assign_roles')
  @ApiOperation({
    operationId: 'replaceAdminStaffAssignments',
    summary: 'Reemplaza TODAS las asignaciones de un empleado',
  })
  @ApiOkResponse({ type: AdminStaffDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(CONFLICT)
  replaceAssignments(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReplaceStaffAssignmentsRequest,
  ): Promise<AdminStaffDto> {
    return this.commands.replaceAssignments(staff, id, body);
  }
}
