import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Principal } from '../../auth/auth.types.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { MY_ORDERS_LIST_THROTTLE } from '../../common/throttle/app-throttler.guard.js';
import { ListMyOrdersQuery, MyOrderPageDto } from './dto/my-orders.dto.js';
import { MyOrdersService } from './my-orders.service.js';

/**
 * Historial del cliente (F23, spec 024, ADR-0029). SIN `@OptionalAuth`: el JWT es obligatorio (denegar por defecto) y el
 * propietario sale SOLO del `sub` verificado. `Cache-Control: private, no-store` y `Vary: Authorization` los fija `configureApp`
 * (también en 401/400/429/503).
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/orders')
export class MyOrdersController {
  constructor(@Inject(MyOrdersService) private readonly orders: MyOrdersService) {}

  @Get()
  @Throttle(MY_ORDERS_LIST_THROTTLE)
  @ApiOperation({
    operationId: 'listMyOrders',
    summary: 'Historial de pedidos del cliente autenticado (paginado por cursor, ligero)',
  })
  @ApiOkResponse({ type: MyOrderPageDto, description: 'Página de pedidos del cliente' })
  @ApiResponse({ status: 400, description: 'Parámetros inválidos o `ORDER_CURSOR_INVALID`' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'ORDERS_BUSY (reintentable)' })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ListMyOrdersQuery,
  ): Promise<MyOrderPageDto> {
    return this.orders.list(principal, query);
  }
}
