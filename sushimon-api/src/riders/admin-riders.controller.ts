import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import {
  ADMIN_RIDERS_COMMAND_THROTTLE,
  ADMIN_RIDERS_READ_THROTTLE,
} from '../common/throttle/app-throttler.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import {
  CreateRiderRequest,
  ListAdminRidersQuery,
  UpdateRiderAvailabilityRequest,
  UpdateRiderRequest,
  UpdateRiderStatusRequest,
} from './dto/riders-requests.dto.js';
import { AdminRiderDto, AdminRiderPageDto } from './dto/riders-responses.dto.js';
import { RidersCommandsService } from './riders-commands.service.js';
import { RidersQueriesService } from './riders-queries.service.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const FORBIDDEN = {
  status: 403,
  description:
    'No es personal activo, falta el permiso, la sesión no es aal2 (`MFA_REQUIRED`) o `RIDER_ACTION_FORBIDDEN`',
} as const;
const NOT_FOUND = {
  status: 404,
  description: 'RIDER_NOT_FOUND (inexistente o fuera de alcance: misma respuesta)',
} as const;
const BAD_REQUEST = { status: 400, description: 'Forma o parámetros inválidos' } as const;
const RATE = { status: 429, description: 'RATE_LIMITED' } as const;
const BUSY = { status: 503, description: 'RIDERS_BUSY (reintentable)' } as const;

/**
 * Motoristas propios del backoffice (F27, spec 028, ADR-0031). `@RequireStaff` con SU permiso en cada operación (`riders.read`
 * en lecturas; `riders.create`/`riders.update` en escrituras; `riders.assign` NO se usa), siempre con `aal2`. El alcance por
 * sucursal se aplica en los servicios (en SQL). `Cache-Control: private, no-store` en toda respuesta (middleware de
 * `RidersModule`). Los controladores solo delegan: sin lógica de negocio. El actor sale SIEMPRE del JWT.
 */
@ApiTags('admin-riders')
@ApiBearerAuth()
@Controller('admin/riders')
export class AdminRidersController {
  constructor(
    @Inject(RidersQueriesService) private readonly queries: RidersQueriesService,
    @Inject(RidersCommandsService) private readonly commands: RidersCommandsService,
  ) {}

  @Get()
  @RequireStaff('riders.read')
  @Throttle(ADMIN_RIDERS_READ_THROTTLE)
  @ApiOperation({
    operationId: 'listAdminRiders',
    summary: 'Motoristas propios (backoffice, paginado)',
  })
  @ApiOkResponse({ type: AdminRiderPageDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  list(
    @CurrentStaff() staff: StaffContext,
    @Query() query: ListAdminRidersQuery,
  ): Promise<AdminRiderPageDto> {
    return this.queries.list(staff, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireStaff('riders.create')
  @Throttle(ADMIN_RIDERS_COMMAND_THROTTLE)
  @ApiOperation({ operationId: 'createAdminRider', summary: 'Da de alta un motorista propio' })
  @ApiBody({ type: CreateRiderRequest })
  @ApiCreatedResponse({ type: AdminRiderDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 409, description: 'RIDER_PHONE_TAKEN' })
  @ApiResponse({ status: 422, description: 'BRANCH_NOT_AVAILABLE' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateRiderRequest,
  ): Promise<AdminRiderDto> {
    return this.commands.create(staff, body);
  }

  @Get(':id')
  @RequireStaff('riders.read')
  @Throttle(ADMIN_RIDERS_READ_THROTTLE)
  @ApiOperation({ operationId: 'getAdminRider', summary: 'Detalle de un motorista propio' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AdminRiderDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  get(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminRiderDto> {
    return this.queries.get(staff, id);
  }

  @Patch(':id')
  @RequireStaff('riders.update')
  @Throttle(ADMIN_RIDERS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'updateAdminRider',
    summary: 'Edita datos de un motorista o lo traslada de sucursal',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: UpdateRiderRequest })
  @ApiOkResponse({ type: AdminRiderDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({
    status: 409,
    description:
      'RIDER_VERSION_CONFLICT (con `current`), RIDER_PHONE_TAKEN o RIDER_HAS_ACTIVE_DELIVERY',
  })
  @ApiResponse({ status: 422, description: 'BRANCH_NOT_AVAILABLE' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRiderRequest,
  ): Promise<AdminRiderDto> {
    return this.commands.update(staff, id, body);
  }

  @Patch(':id/status')
  @RequireStaff('riders.update')
  @Throttle(ADMIN_RIDERS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'updateAdminRiderStatus',
    summary: 'Activa o desactiva un motorista (idempotente)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: UpdateRiderStatusRequest })
  @ApiOkResponse({ type: AdminRiderDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({ status: 409, description: 'RIDER_HAS_ACTIVE_DELIVERY' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  setStatus(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRiderStatusRequest,
  ): Promise<AdminRiderDto> {
    return this.commands.setStatus(staff, id, body);
  }

  @Patch(':id/availability')
  @RequireStaff('riders.update')
  @Throttle(ADMIN_RIDERS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'updateAdminRiderAvailability',
    summary: 'Marca la disponibilidad manual de un motorista (idempotente)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: UpdateRiderAvailabilityRequest })
  @ApiOkResponse({ type: AdminRiderDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({ status: 409, description: 'RIDER_INACTIVE o RIDER_HAS_ACTIVE_DELIVERY' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  setAvailability(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRiderAvailabilityRequest,
  ): Promise<AdminRiderDto> {
    return this.commands.setAvailability(staff, id, body);
  }
}
