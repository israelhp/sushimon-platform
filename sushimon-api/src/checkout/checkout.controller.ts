import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { OptionalAuth } from '../auth/optional-auth.decorator.js';
import { CHECKOUT_QUOTE_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import { CheckoutQuoteService } from './checkout-quote.service.js';
import { CheckoutQuoteRequestDto } from './dto/checkout-quote-request.dto.js';
import { CheckoutQuoteDto } from './dto/checkout-quote-responses.dto.js';

/**
 * Cotización de checkout (F19, ADR-0025 D1). Controlador delgado: toda la regla vive en `CheckoutQuoteService`. Acceso
 * opcional por JWT (`@OptionalAuth()`: invitado sin `Authorization`; token presente e inválido => 401). Respuesta
 * `private, no-store` también en errores (middleware del módulo + filtro global). Sin efectos: no crea pedidos.
 */
@ApiTags('checkout')
@ApiBearerAuth()
@OptionalAuth()
@Throttle(CHECKOUT_QUOTE_THROTTLE)
@Controller('checkout')
export class CheckoutController {
  constructor(@Inject(CheckoutQuoteService) private readonly quotes: CheckoutQuoteService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'quoteCheckout',
    summary: 'Cotiza un carrito para el checkout (autoridad de precios; sin crear pedido)',
  })
  @ApiBody({ type: CheckoutQuoteRequestDto })
  @ApiOkResponse({
    type: CheckoutQuoteDto,
    description: 'Cotización calculada (puede traer `blockers`)',
  })
  @ApiResponse({
    status: 400,
    description: 'Forma inválida, campos de importe o `QUOTE_LIMITS_EXCEEDED`',
  })
  @ApiResponse({
    status: 401,
    description: 'Token presente e inválido, o `customerAddressId` sin sesión',
  })
  @ApiResponse({ status: 404, description: 'Dirección guardada inexistente o ajena' })
  @ApiResponse({ status: 422, description: '`BRANCH_NOT_AVAILABLE` o `MUNICIPALITY_NOT_FOUND`' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'CHECKOUT_BUSY (reintentable)' })
  quote(@Req() req: Request, @Body() body: CheckoutQuoteRequestDto): Promise<CheckoutQuoteDto> {
    return this.quotes.quote(req.principal, body);
  }
}
