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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentStaff } from '../../auth/current-user.decorator.js';
import { RequireStaff } from '../../auth/staff.guard.js';
import {
  ADMIN_ORDERS_COMMAND_THROTTLE,
  ADMIN_ORDERS_READ_THROTTLE,
} from '../../common/throttle/app-throttler.guard.js';
import type { StaffContext } from '../../identity/identity.types.js';
import { AdminOrdersCommandsService } from './admin-orders-commands.service.js';
import { AdminOrdersQueryService } from './admin-orders-query.service.js';
import {
  AdminOrderCommandRequest,
  AdminOrderReasonRequest,
  BoardAdminOrdersQuery,
  ListAdminOrdersQuery,
} from './dto/admin-orders-requests.dto.js';
import {
  AdminOrderBoardDto,
  AdminOrderDetailDto,
  AdminOrderPageDto,
  AdminOrderTransitionResultDto,
} from './dto/admin-orders-responses.dto.js';
import type { OrderCommand } from './order-transition.matrix.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const FORBIDDEN = {
  status: 403,
  description:
    'No es personal activo, falta el permiso o la sesión no es aal2 (MFA_REQUIRED); ORDER_ACTION_FORBIDDEN',
} as const;
const RATE = { status: 429, description: 'RATE_LIMITED' } as const;
const BUSY = { status: 503, description: 'ORDERS_BUSY (reintentable)' } as const;

/**
 * Backoffice de pedidos (F22, spec 023, ADR-0028). `@RequireStaff` con SU permiso en cada operación (nunca a nivel de
 * clase); el alcance por sucursal se aplica en los servicios. `board` se declara ANTES de `:id`. `no-store` lo fija el
 * middleware de `/v1/admin`.
 */
@ApiTags('admin-orders')
@ApiBearerAuth()
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    @Inject(AdminOrdersQueryService) private readonly queries: AdminOrdersQueryService,
    @Inject(AdminOrdersCommandsService) private readonly commands: AdminOrdersCommandsService,
  ) {}

  @Get()
  @RequireStaff('orders.read')
  @Throttle(ADMIN_ORDERS_READ_THROTTLE)
  @ApiOperation({
    operationId: 'listAdminOrders',
    summary: 'Pedidos del backoffice (paginado por cursor)',
  })
  @ApiOkResponse({ type: AdminOrderPageDto })
  @ApiResponse({
    status: 400,
    description: 'Parámetros inválidos, rango excesivo o ORDER_CURSOR_INVALID',
  })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  list(
    @CurrentStaff() staff: StaffContext,
    @Query() query: ListAdminOrdersQuery,
  ): Promise<AdminOrderPageDto> {
    return this.queries.list(staff, query);
  }

  @Get('board')
  @RequireStaff('orders.read')
  @Throttle(ADMIN_ORDERS_READ_THROTTLE)
  @ApiOperation({
    operationId: 'getAdminOrderBoard',
    summary: 'Tablero de pedidos agregado por estado',
  })
  @ApiOkResponse({ type: AdminOrderBoardDto })
  @ApiResponse({ status: 400, description: 'Parámetros inválidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  board(
    @CurrentStaff() staff: StaffContext,
    @Query() query: BoardAdminOrdersQuery,
  ): Promise<AdminOrderBoardDto> {
    return this.queries.board(staff, query);
  }

  @Get(':id')
  @RequireStaff('orders.read')
  @Throttle(ADMIN_ORDERS_READ_THROTTLE)
  @ApiOperation({
    operationId: 'getAdminOrder',
    summary: 'Detalle completo de un pedido para el personal',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AdminOrderDetailDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND (inexistente o fuera de alcance)' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  detail(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminOrderDetailDto> {
    return this.queries.detail(staff, id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('orders.accept')
  @Throttle(ADMIN_ORDERS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'acceptAdminOrder',
    summary: 'Acepta un pedido (pending -> accepted)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: AdminOrderCommandRequest })
  @ApiOkResponse({ type: AdminOrderTransitionResultDto })
  @ApiResponse({ status: 400, description: 'Identificador o cuerpo inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ORDER_STATE_CONFLICT (con `current`)' })
  @ApiResponse({ status: 422, description: 'ORDER_TRANSITION_INVALID (con `current`)' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  accept(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminOrderCommandRequest,
  ): Promise<AdminOrderTransitionResultDto> {
    return this.run(staff, 'accept', id, body);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('orders.reject')
  @Throttle(ADMIN_ORDERS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'rejectAdminOrder',
    summary: 'Rechaza un pedido (pending -> rejected)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: AdminOrderReasonRequest })
  @ApiOkResponse({ type: AdminOrderTransitionResultDto })
  @ApiResponse({ status: 400, description: 'Cuerpo inválido o ORDER_REASON_REQUIRED' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ORDER_STATE_CONFLICT (con `current`)' })
  @ApiResponse({ status: 422, description: 'ORDER_TRANSITION_INVALID (con `current`)' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  reject(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminOrderReasonRequest,
  ): Promise<AdminOrderTransitionResultDto> {
    return this.run(staff, 'reject', id, body);
  }

  @Post(':id/start-preparing')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('orders.prepare')
  @Throttle(ADMIN_ORDERS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'startPreparingAdminOrder',
    summary: 'Inicia la preparación (accepted -> preparing)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: AdminOrderCommandRequest })
  @ApiOkResponse({ type: AdminOrderTransitionResultDto })
  @ApiResponse({ status: 400, description: 'Identificador o cuerpo inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ORDER_STATE_CONFLICT (con `current`)' })
  @ApiResponse({ status: 422, description: 'ORDER_TRANSITION_INVALID (con `current`)' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  startPreparing(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminOrderCommandRequest,
  ): Promise<AdminOrderTransitionResultDto> {
    return this.run(staff, 'start_preparing', id, body);
  }

  @Post(':id/mark-ready')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('orders.prepare')
  @Throttle(ADMIN_ORDERS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'markReadyAdminOrder',
    summary: 'Marca el pedido como listo (preparing -> ready)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: AdminOrderCommandRequest })
  @ApiOkResponse({ type: AdminOrderTransitionResultDto })
  @ApiResponse({ status: 400, description: 'Identificador o cuerpo inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ORDER_STATE_CONFLICT (con `current`)' })
  @ApiResponse({ status: 422, description: 'ORDER_TRANSITION_INVALID (con `current`)' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  markReady(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminOrderCommandRequest,
  ): Promise<AdminOrderTransitionResultDto> {
    return this.run(staff, 'mark_ready', id, body);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('orders.complete')
  @Throttle(ADMIN_ORDERS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'completeAdminOrder',
    summary: 'Completa un pedido PICKUP histórico o en curso (ready -> picked_up; ADR-0036)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: AdminOrderCommandRequest })
  @ApiOkResponse({ type: AdminOrderTransitionResultDto })
  @ApiResponse({ status: 400, description: 'Identificador o cuerpo inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ORDER_STATE_CONFLICT (con `current`)' })
  @ApiResponse({ status: 422, description: 'ORDER_TRANSITION_INVALID (con `current`)' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  complete(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminOrderCommandRequest,
  ): Promise<AdminOrderTransitionResultDto> {
    return this.run(staff, 'complete', id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireStaff('orders.cancel')
  @Throttle(ADMIN_ORDERS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'cancelAdminOrder',
    summary: 'Cancela un pedido (pending|accepted|preparing|ready -> cancelled)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: AdminOrderReasonRequest })
  @ApiOkResponse({ type: AdminOrderTransitionResultDto })
  @ApiResponse({ status: 400, description: 'Cuerpo inválido o ORDER_REASON_REQUIRED' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ORDER_STATE_CONFLICT (con `current`)' })
  @ApiResponse({ status: 422, description: 'ORDER_TRANSITION_INVALID (con `current`)' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  cancel(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminOrderReasonRequest,
  ): Promise<AdminOrderTransitionResultDto> {
    return this.run(staff, 'cancel', id, body);
  }

  private run(
    staff: StaffContext,
    command: OrderCommand,
    id: string,
    body: { expectedStatus: string; reason?: string | undefined },
  ): Promise<AdminOrderTransitionResultDto> {
    return this.commands.execute(staff, command, id, body);
  }
}
