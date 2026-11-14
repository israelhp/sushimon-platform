import {
  Body,
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { BranchClosuresService } from './branch-closures.service.js';
import { BranchHoursService } from './branch-hours.service.js';
import {
  CreateBranchClosureRequest,
  ListBranchClosuresQuery,
  ReplaceBranchHoursRequest,
  UpdateBranchClosureRequest,
} from './dto/branch-schedule-requests.dto.js';
import {
  AdminBranchHoursDto,
  BranchClosureDto,
  BranchClosureListDto,
} from './dto/branch-schedule-responses.dto.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const NOT_FOUND = { status: 404, description: 'No existe o fuera de alcance' } as const;
const BAD_REQUEST = { status: 400, description: 'Forma de la solicitud inválida' } as const;

/**
 * Backoffice de horarios y cierres (F08). JWT (global) → personal activo con el permiso de CADA operación → aal2.
 * El alcance por sucursal se resuelve en los servicios con el permiso específico; fuera de alcance = 404.
 * `no-store` en toda respuesta lo aplica el middleware del prefijo `/v1/admin`.
 */
@ApiTags('branch-schedule')
@ApiBearerAuth()
@Controller('admin/branches')
export class AdminBranchScheduleController {
  constructor(
    @Inject(BranchHoursService) private readonly hours: BranchHoursService,
    @Inject(BranchClosuresService) private readonly closures: BranchClosuresService,
  ) {}

  @Get(':id/hours')
  @RequireStaff('branches.read')
  @ApiOperation({
    operationId: 'getAdminBranchHours',
    summary: 'Horario semanal de una sucursal (backoffice)',
  })
  @ApiOkResponse({ type: AdminBranchHoursDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  getHours(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminBranchHoursDto> {
    return this.hours.getAdmin(staff, id);
  }

  @Put(':id/hours')
  @RequireStaff('branches.manage_hours')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'replaceAdminBranchHours',
    summary: 'Reemplaza el horario semanal completo (7 días)',
  })
  @ApiOkResponse({ type: AdminBranchHoursDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({ status: 409, description: 'HOURS_VERSION_CONFLICT' })
  @ApiResponse({ status: 422, description: 'SCHEDULE_INVALID' })
  replaceHours(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReplaceBranchHoursRequest,
  ): Promise<AdminBranchHoursDto> {
    return this.hours.replace(staff, id, body);
  }

  @Get(':id/closures')
  @RequireStaff('branches.read')
  @ApiOperation({
    operationId: 'listAdminBranchClosures',
    summary: 'Cierres extraordinarios de una sucursal (paginado)',
  })
  @ApiOkResponse({ type: BranchClosureListDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  listClosures(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListBranchClosuresQuery,
  ): Promise<BranchClosureListDto> {
    return this.closures.list(staff, id, query);
  }

  @Post(':id/closures')
  @RequireStaff('branches.manage_hours')
  @ApiOperation({
    operationId: 'createAdminBranchClosure',
    summary: 'Crea un cierre extraordinario',
  })
  @ApiCreatedResponse({ type: BranchClosureDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({ status: 409, description: 'CLOSURE_OVERLAP' })
  @ApiResponse({ status: 422, description: 'CLOSURE_RANGE_INVALID' })
  createClosure(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateBranchClosureRequest,
  ): Promise<BranchClosureDto> {
    return this.closures.create(staff, id, body);
  }

  @Patch(':id/closures/:closureId')
  @RequireStaff('branches.manage_hours')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminBranchClosure',
    summary: 'Edita, acorta o termina un cierre',
  })
  @ApiOkResponse({ type: BranchClosureDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: 'Sucursal o cierre inexistente o fuera de alcance' })
  @ApiResponse({ status: 409, description: 'CLOSURE_NOT_EDITABLE o CLOSURE_OVERLAP' })
  @ApiResponse({ status: 422, description: 'CLOSURE_RANGE_INVALID' })
  updateClosure(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('closureId', ParseUUIDPipe) closureId: string,
    @Body() body: UpdateBranchClosureRequest,
  ): Promise<BranchClosureDto> {
    return this.closures.update(staff, id, closureId, body);
  }

  @Delete(':id/closures/:closureId')
  @RequireStaff('branches.manage_hours')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteAdminBranchClosure',
    summary: 'Cancela (elimina) un cierre futuro',
  })
  @ApiNoContentResponse({ description: 'Cierre eliminado' })
  @ApiResponse({ status: 400, description: 'Identificador no UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: 'Sucursal o cierre inexistente o fuera de alcance' })
  @ApiResponse({ status: 409, description: 'CLOSURE_NOT_DELETABLE' })
  async deleteClosure(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('closureId', ParseUUIDPipe) closureId: string,
  ): Promise<void> {
    await this.closures.remove(staff, id, closureId);
  }
}
