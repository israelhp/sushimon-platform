import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
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
import type { Response } from 'express';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import {
  ADMIN_DELIVERIES_COMMAND_THROTTLE,
  ADMIN_DELIVERIES_READ_THROTTLE,
} from '../common/throttle/app-throttler.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import {
  AdminDeliveryCommandRequest,
  AssignOwnRiderRequest,
  CancelAdminDeliveryRequest,
  CreateAdminDeliveryRequest,
  ListAdminDeliveriesQuery,
  UnassignRiderRequest,
} from './dto/deliveries-requests.dto.js';
import {
  AdminDeliveryCommandResultDto,
  AdminDeliveryDto,
  AdminDeliveryPageDto,
} from './dto/deliveries-responses.dto.js';
import { DeliveriesCommandsService } from './deliveries-commands.service.js';
import { DeliveriesQueriesService } from './deliveries-queries.service.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const FORBIDDEN = {
  status: 403,
  description:
    'No es personal activo, falta el permiso, la sesión no es aal2 (`MFA_REQUIRED`) o `DELIVERY_ACTION_FORBIDDEN`',
} as const;
const NOT_FOUND = {
  status: 404,
  description:
    'DELIVERY_NOT_FOUND (inexistente o fuera de alcance: misma respuesta) o RIDER_NOT_FOUND',
} as const;
const BAD_REQUEST = {
  status: 400,
  description:
    'Forma o parámetros inválidos, `DELIVERY_REASON_REQUIRED` o `DELIVERY_CURSOR_INVALID`',
} as const;
const RATE = { status: 429, description: 'RATE_LIMITED' } as const;
const BUSY = { status: 503, description: 'DELIVERIES_BUSY (reintentable)' } as const;
const STATE_CONFLICT = {
  status: 409,
  description: 'DELIVERY_STATE_CONFLICT u ORDER_STATE_CONFLICT (con `current`)',
} as const;
const ORDER_INVALID = {
  status: 422,
  description: 'ORDER_TRANSITION_INVALID (la matriz del pedido rechaza la transición)',
} as const;
const ID = { name: 'id', type: String, format: 'uuid' } as const;

/**
 * Entregas propias del backoffice (F28, spec 029, ADR-0032). `@RequireStaff` con SU permiso en cada operación (`deliveries.read`
 * en lecturas; `deliveries.assign`/`deliveries.update` en comandos; asignar exige además `riders.assign`), siempre con `aal2`.
 * El alcance por sucursal y el permiso del comando EN la sucursal de la entrega se aplican en los servicios (en SQL). `Cache-Control:
 * private, no-store` en toda respuesta (middleware de `DeliveriesModule`). Los controladores solo delegan: sin lógica de negocio. El
 * actor sale SIEMPRE del JWT. Sin `DELETE` ni `PATCH`.
 */
@ApiTags('admin-deliveries')
@ApiBearerAuth()
@Controller('admin/deliveries')
export class AdminDeliveriesController {
  constructor(
    @Inject(DeliveriesQueriesService) private readonly queries: DeliveriesQueriesService,
    @Inject(DeliveriesCommandsService) private readonly commands: DeliveriesCommandsService,
  ) {}

  @Get()
  @RequireStaff('deliveries.read')
  @Throttle(ADMIN_DELIVERIES_READ_THROTTLE)
  @ApiOperation({
    operationId: 'listAdminDeliveries',
    summary: 'Entregas propias del backoffice (paginado por cursor, ligero)',
  })
  @ApiOkResponse({ type: AdminDeliveryPageDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({
    status: 404,
    description: 'BRANCH_NOT_FOUND (filtro `branchId` fuera de alcance)',
  })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  list(
    @CurrentStaff() staff: StaffContext,
    @Query() query: ListAdminDeliveriesQuery,
  ): Promise<AdminDeliveryPageDto> {
    return this.queries.list(staff, query);
  }

  @Post()
  @RequireStaff('deliveries.assign')
  @Throttle(ADMIN_DELIVERIES_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'createAdminDelivery',
    summary: 'Crea (o reabre) la entrega propia de un pedido elegible',
  })
  @ApiBody({ type: CreateAdminDeliveryRequest })
  @ApiCreatedResponse({ type: AdminDeliveryCommandResultDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND (inexistente o fuera de alcance)' })
  @ApiResponse({ status: 409, description: 'ORDER_STATE_CONFLICT o DELIVERY_STATE_CONFLICT' })
  @ApiResponse({ status: 422, description: 'DELIVERY_ORDER_NOT_ELIGIBLE (ver `violations`)' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  async create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateAdminDeliveryRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminDeliveryCommandResultDto> {
    const outcome = await this.commands.create(staff, body.orderId);
    // 201 al crear o reabrir; 200 con `transition.replayed=true` si ya existía abierta.
    res.status(outcome.transition.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return outcome;
  }

  @Get(':id')
  @RequireStaff('deliveries.read')
  @Throttle(ADMIN_DELIVERIES_READ_THROTTLE)
  @ApiOperation({
    operationId: 'getAdminDelivery',
    summary: 'Detalle de una entrega propia (con historial)',
  })
  @ApiParam(ID)
  @ApiOkResponse({ type: AdminDeliveryDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  get(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminDeliveryDto> {
    return this.queries.detail(staff, id);
  }

  @Post(':id/assign-own-rider')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('deliveries.assign', 'riders.assign')
  @Throttle(ADMIN_DELIVERIES_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'assignOwnRiderToAdminDelivery',
    summary: 'Asigna (o reasigna antes de la recogida) un motorista propio',
  })
  @ApiParam(ID)
  @ApiBody({ type: AssignOwnRiderRequest })
  @ApiOkResponse({ type: AdminDeliveryCommandResultDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(STATE_CONFLICT)
  @ApiResponse({
    status: 422,
    description: 'RIDER_NOT_ELIGIBLE o DELIVERY_ORDER_NOT_ELIGIBLE (ver `violations`)',
  })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  assign(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AssignOwnRiderRequest,
  ): Promise<AdminDeliveryCommandResultDto> {
    return this.commands.assign(staff, id, body);
  }

  @Post(':id/unassign-rider')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('deliveries.assign')
  @Throttle(ADMIN_DELIVERIES_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'unassignRiderFromAdminDelivery',
    summary: 'Quita el motorista (assigned a pending; el motorista queda libre)',
  })
  @ApiParam(ID)
  @ApiBody({ type: UnassignRiderRequest })
  @ApiOkResponse({ type: AdminDeliveryCommandResultDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(STATE_CONFLICT)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  unassign(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UnassignRiderRequest,
  ): Promise<AdminDeliveryCommandResultDto> {
    return this.commands.execute(staff, 'unassign', id, body);
  }

  @Post(':id/mark-picked-up')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('deliveries.update')
  @Throttle(ADMIN_DELIVERIES_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'markAdminDeliveryPickedUp',
    summary: 'Confirma la recogida (entrega assigned a picked_up y pedido ready a on_the_way)',
  })
  @ApiParam(ID)
  @ApiBody({ type: AdminDeliveryCommandRequest })
  @ApiOkResponse({ type: AdminDeliveryCommandResultDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(STATE_CONFLICT)
  @ApiResponse(ORDER_INVALID)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  markPickedUp(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminDeliveryCommandRequest,
  ): Promise<AdminDeliveryCommandResultDto> {
    return this.commands.execute(staff, 'mark_picked_up', id, body);
  }

  @Post(':id/mark-delivered')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('deliveries.update')
  @Throttle(ADMIN_DELIVERIES_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'markAdminDeliveryDelivered',
    summary:
      'Confirma la entrega al cliente (picked_up a delivered y pedido on_the_way a delivered)',
  })
  @ApiParam(ID)
  @ApiBody({ type: AdminDeliveryCommandRequest })
  @ApiOkResponse({ type: AdminDeliveryCommandResultDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(STATE_CONFLICT)
  @ApiResponse(ORDER_INVALID)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  markDelivered(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminDeliveryCommandRequest,
  ): Promise<AdminDeliveryCommandResultDto> {
    return this.commands.execute(staff, 'mark_delivered', id, body);
  }

  @Post(':id/return-to-branch')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('deliveries.update')
  @Throttle(ADMIN_DELIVERIES_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'returnAdminDeliveryToBranch',
    summary: 'Registra el retorno del motorista (delivered a returned; libera al motorista)',
  })
  @ApiParam(ID)
  @ApiBody({ type: AdminDeliveryCommandRequest })
  @ApiOkResponse({ type: AdminDeliveryCommandResultDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(STATE_CONFLICT)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  returnToBranch(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminDeliveryCommandRequest,
  ): Promise<AdminDeliveryCommandResultDto> {
    return this.commands.execute(staff, 'return_to_branch', id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('deliveries.update')
  @Throttle(ADMIN_DELIVERIES_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'cancelAdminDelivery',
    summary: 'Cancela una entrega aún no recogida (pending o assigned; motivo obligatorio)',
  })
  @ApiParam(ID)
  @ApiBody({ type: CancelAdminDeliveryRequest })
  @ApiOkResponse({ type: AdminDeliveryCommandResultDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse(STATE_CONFLICT)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  cancel(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CancelAdminDeliveryRequest,
  ): Promise<AdminDeliveryCommandResultDto> {
    return this.commands.execute(staff, 'cancel', id, body);
  }
}
