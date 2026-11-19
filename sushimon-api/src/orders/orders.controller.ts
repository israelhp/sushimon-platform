import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { OptionalAuth } from '../auth/optional-auth.decorator.js';
import {
  CREATE_ORDER_THROTTLE,
  ORDER_READ_THROTTLE,
  ORDER_TRACKING_THROTTLE,
} from '../common/throttle/app-throttler.guard.js';
import { OrderCreateRequestDto } from './dto/order-create-request.dto.js';
import { OrderCreatedDto, OrderDetailDto } from './dto/order-responses.dto.js';
import { OrderTrackingDto } from './dto/order-tracking.dto.js';
import { OrdersService } from './orders.service.js';

/**
 * Pedidos (F20, spec 021, ADR-0026). Controlador delgado: toda la regla vive en `OrdersService`. Acceso opcional por JWT
 * (`@OptionalAuth()`: invitado sin `Authorization`; token presente e inválido => 401, nunca se degrada a invitado).
 * `Cache-Control: private, no-store` y sin ETag en TODA respuesta, errores incluidos (middleware de `configureApp` + filtro).
 */
@ApiTags('orders')
@ApiBearerAuth()
@OptionalAuth()
@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post()
  @Throttle(CREATE_ORDER_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'createOrder',
    summary: 'Crea un pedido (invitado o autenticado) con recotización del servidor e idempotencia',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Clave del intento (`^[A-Za-z0-9_-]{22,128}$`; un UUID v4 cumple).',
  })
  @ApiBody({ type: OrderCreateRequestDto })
  @ApiResponse({ status: 200, type: OrderCreatedDto, description: 'Repetición idempotente' })
  @ApiResponse({ status: 201, type: OrderCreatedDto, description: 'Pedido creado (`pending`)' })
  @ApiResponse({ status: 400, description: 'Forma inválida o `IDEMPOTENCY_KEY_INVALID`' })
  @ApiResponse({ status: 401, description: 'Token inválido o dirección guardada sin sesión' })
  @ApiResponse({ status: 404, description: 'Dirección guardada inexistente o ajena' })
  @ApiResponse({
    status: 409,
    description:
      '`QUOTE_CHANGED`, `QUOTE_EXPIRED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`',
  })
  @ApiResponse({
    status: 422,
    description: '`QUOTE_INVALID`, `CHECKOUT_BLOCKED`, `DELIVERY_PROVIDER_NOT_SELECTABLE`, …',
  })
  @ApiResponse({ status: 429, description: '`RATE_LIMITED` o `PENDING_ORDERS_LIMIT`' })
  @ApiResponse({ status: 503, description: '`ORDERS_BUSY` u `ORDERS_UNAVAILABLE`' })
  async create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: OrderCreateRequestDto,
  ): Promise<OrderCreatedDto> {
    const result = await this.orders.create(req.principal, idempotencyKey, body);
    if (result.replayed) {
      res.status(HttpStatus.OK).setHeader('Idempotent-Replayed', 'true');
    } else {
      res.setHeader('Location', `/v1/orders/${result.body.order.id}`);
    }
    return result.body;
  }

  @Get(':id')
  @Throttle(ORDER_READ_THROTTLE)
  @ApiOperation({
    operationId: 'getOrder',
    summary: 'Consulta un pedido propio (sesión del cliente dueño o token de invitado)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Order-Token',
    required: false,
    description: 'Token opaco de invitado (`smo_…`). Sin él se exige la sesión del cliente dueño.',
  })
  @ApiOkResponse({ type: OrderDetailDto, description: 'Pedido' })
  @ApiResponse({ status: 400, description: '`id` o `X-Order-Token` con formato inválido' })
  @ApiResponse({ status: 401, description: 'Token JWT presente e inválido' })
  @ApiResponse({ status: 404, description: 'Inexistente, ajeno o token inválido (idéntico)' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'ORDERS_BUSY (reintentable)' })
  get(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-order-token') orderToken: string | undefined,
  ): Promise<OrderDetailDto> {
    res.vary('Authorization');
    res.vary('X-Order-Token');
    return this.orders.get(req.principal, id, orderToken);
  }

  @Get(':id/tracking')
  @Throttle(ORDER_TRACKING_THROTTLE)
  @ApiOperation({
    operationId: 'getOrderTracking',
    summary:
      'Seguimiento ligero de un pedido propio (estado actual, fases públicas y línea de tiempo real)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Order-Token',
    required: false,
    description: 'Token opaco de invitado (`smo_…`). Sin él se exige la sesión del cliente dueño.',
  })
  @ApiOkResponse({ type: OrderTrackingDto, description: 'Seguimiento del pedido' })
  @ApiResponse({ status: 400, description: '`id` o `X-Order-Token` con formato inválido' })
  @ApiResponse({ status: 401, description: 'Token JWT presente e inválido' })
  @ApiResponse({ status: 404, description: 'Inexistente, ajeno o token inválido (idéntico)' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'ORDERS_BUSY (reintentable)' })
  getTracking(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-order-token') orderToken: string | undefined,
  ): Promise<OrderTrackingDto> {
    res.vary('Authorization');
    res.vary('X-Order-Token');
    return this.orders.getTracking(req.principal, id, orderToken);
  }
}
