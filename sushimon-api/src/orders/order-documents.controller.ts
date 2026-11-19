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
import type { Request } from 'express';
import { OptionalAuth } from '../auth/optional-auth.decorator.js';
import {
  ORDER_RECEIPT_THROTTLE,
  ORDER_REORDER_PREVIEW_THROTTLE,
} from '../common/throttle/app-throttler.guard.js';
import { OrderDocumentsService } from './order-documents.service.js';
import { OrderReceiptDto } from './receipt/dto/order-receipt.dto.js';
import { OrderReorderPreviewDto, OrderReorderRequestDto } from './reorder/dto/order-reorder.dto.js';

const TOKEN_HEADER = {
  name: 'X-Order-Token',
  required: false,
  description: 'Token opaco de invitado (`smo_…`). Sin él se exige la sesión del cliente dueño.',
} as const;

/**
 * Recibo y vista previa de «Volver a pedir» (F23, spec 024). Controlador delgado. Acceso opcional por JWT como `getOrder`
 * (`@OptionalAuth()`: token presente e inválido => 401, nunca se degrada a invitado). `Cache-Control: private, no-store`,
 * `Vary: Authorization, X-Order-Token` y sin ETag los fija `configureApp` para TODA `/v1/orders/*` (errores incluidos).
 */
@ApiTags('orders')
@ApiBearerAuth()
@OptionalAuth()
@Controller('orders')
export class OrderDocumentsController {
  constructor(@Inject(OrderDocumentsService) private readonly documents: OrderDocumentsService) {}

  @Get(':id/receipt')
  @Throttle(ORDER_RECEIPT_THROTTLE)
  @ApiOperation({
    operationId: 'getOrderReceipt',
    summary: 'Recibo NO FISCAL de un pedido propio (datos para la vista imprimible)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiHeader(TOKEN_HEADER)
  @ApiOkResponse({ type: OrderReceiptDto, description: 'Datos del recibo' })
  @ApiResponse({ status: 400, description: '`id` o `X-Order-Token` con formato inválido' })
  @ApiResponse({ status: 401, description: 'Token JWT presente e inválido' })
  @ApiResponse({ status: 404, description: 'Inexistente, ajeno o token inválido (idéntico)' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'ORDERS_BUSY (reintentable)' })
  receipt(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-order-token') orderToken: string | undefined,
  ): Promise<OrderReceiptDto> {
    return this.documents.receipt(req.principal, id, orderToken);
  }

  @Post(':id/reorder-preview')
  @Throttle(ORDER_REORDER_PREVIEW_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'previewOrderReorder',
    summary: 'Vista previa de «Volver a pedir» contra el catálogo vigente (no crea nada)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiHeader(TOKEN_HEADER)
  @ApiBody({ type: OrderReorderRequestDto, required: false })
  @ApiOkResponse({ type: OrderReorderPreviewDto, description: 'Diagnóstico por línea y resumen' })
  @ApiResponse({ status: 400, description: '`id`, `X-Order-Token` o cuerpo inválidos' })
  @ApiResponse({ status: 401, description: 'Token JWT presente e inválido' })
  @ApiResponse({
    status: 404,
    description: 'Pedido inexistente/ajeno/token inválido (idéntico) o `BRANCH_NOT_FOUND`',
  })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'ORDERS_BUSY (reintentable)' })
  preview(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-order-token') orderToken: string | undefined,
    @Body() body: OrderReorderRequestDto,
  ): Promise<OrderReorderPreviewDto> {
    return this.documents.previewReorder(req.principal, id, orderToken, body);
  }
}
