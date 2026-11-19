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
import type { Response } from 'express';
import { CurrentStaff } from '../../auth/current-user.decorator.js';
import { RequireStaff } from '../../auth/staff.guard.js';
import {
  ADMIN_PAYMENTS_COMMAND_THROTTLE,
  ADMIN_PAYMENTS_READ_THROTTLE,
} from '../../common/throttle/app-throttler.guard.js';
import type { StaffContext } from '../../identity/identity.types.js';
import { CashPaymentsService } from './cash-payments.service.js';
import {
  AdminCashPaymentRequest,
  AdminCashPaymentResultDto,
  AdminOrderPaymentDto,
  AdminPaymentHistoryDto,
} from './dto/admin-payments.dto.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const NOT_FOUND = {
  status: 404,
  description: 'ORDER_NOT_FOUND (inexistente o fuera de alcance: misma respuesta)',
} as const;
const RATE = { status: 429, description: 'RATE_LIMITED' } as const;
const BUSY = { status: 503, description: 'ORDERS_BUSY (reintentable)' } as const;

/**
 * Pagos en efectivo del backoffice (F24, spec 025, ADR-0030). `@RequireStaff` con SU permiso en cada operación (nunca a nivel de
 * clase): `payments.read` en las lecturas y `payments.confirm` en el registro, ambos con `aal2`; el alcance por sucursal del
 * PEDIDO se aplica en el servicio (en SQL). `Cache-Control: private, no-store` en toda respuesta (middleware de `OrdersModule`).
 * El actor sale SIEMPRE del JWT: la entrada no admite empleado, sucursal, cambio, fecha ni moneda.
 */
@ApiTags('admin-payments')
@ApiBearerAuth()
@Controller('admin/orders')
export class AdminPaymentsController {
  constructor(@Inject(CashPaymentsService) private readonly payments: CashPaymentsService) {}

  @Get(':id/payment')
  @RequireStaff('payments.read')
  @Throttle(ADMIN_PAYMENTS_READ_THROTTLE)
  @ApiOperation({
    operationId: 'getAdminOrderPayment',
    summary: 'Pago en efectivo de un pedido (deuda, estado y recepción) para el personal',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AdminOrderPaymentDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({
    status: 403,
    description: 'No es personal activo, falta `payments.read` o la sesión no es aal2',
  })
  @ApiResponse(NOT_FOUND)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  get(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminOrderPaymentDto> {
    return this.payments.get(staff, id);
  }

  @Post(':id/payment/cash')
  @HttpCode(HttpStatus.CREATED)
  @RequireStaff('payments.confirm')
  @Throttle(ADMIN_PAYMENTS_COMMAND_THROTTLE)
  @ApiOperation({
    operationId: 'registerAdminOrderCashPayment',
    summary: 'Registra la recepción del efectivo de un pedido (`PENDING` → `PAID`)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Clave del intento (`^[A-Za-z0-9_-]{22,128}$`; un UUID v4 cumple). Solo se guarda su hash.',
  })
  @ApiBody({ type: AdminCashPaymentRequest })
  @ApiResponse({
    status: 200,
    type: AdminCashPaymentResultDto,
    description: 'Repetición idempotente (`Idempotent-Replayed: true`)',
  })
  @ApiResponse({
    status: 201,
    type: AdminCashPaymentResultDto,
    description: 'Recepción registrada',
  })
  @ApiResponse({
    status: 400,
    description:
      'Cuerpo inválido, `IDEMPOTENCY_KEY_INVALID`, `PAYMENT_AMOUNT_INVALID` o `PAYMENT_CONFIRMATION_REQUIRED`',
  })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({
    status: 403,
    description:
      'No es personal activo, falta `payments.confirm`, sesión no aal2 o `PAYMENT_ACTION_FORBIDDEN`',
  })
  @ApiResponse(NOT_FOUND)
  @ApiResponse({
    status: 409,
    description:
      '`PAYMENT_ALREADY_REGISTERED` y `ORDER_NOT_PAYABLE` (con `current`) o `IDEMPOTENCY_KEY_REUSED`',
  })
  @ApiResponse({
    status: 422,
    description:
      '`CASH_AMOUNT_INSUFFICIENT`, `CASH_TENDERED_TOO_LARGE` o `PAYMENT_NOT_COLLECTABLE`',
  })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  async registerCash(
    @CurrentStaff() staff: StaffContext,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: AdminCashPaymentRequest,
  ): Promise<AdminCashPaymentResultDto> {
    const result = await this.payments.register(staff, id, idempotencyKey, body);
    if (result.replayed) {
      res.status(HttpStatus.OK).setHeader('Idempotent-Replayed', 'true');
    }
    return result.body;
  }

  @Get(':id/payment/history')
  @RequireStaff('payments.read')
  @Throttle(ADMIN_PAYMENTS_READ_THROTTLE)
  @ApiOperation({
    operationId: 'listAdminOrderPaymentHistory',
    summary: 'Historial solo-añadir del pago de un pedido (eventos autorizados)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AdminPaymentHistoryDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({
    status: 403,
    description: 'No es personal activo, falta `payments.read` o la sesión no es aal2',
  })
  @ApiResponse(NOT_FOUND)
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  history(
    @CurrentStaff() staff: StaffContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminPaymentHistoryDto> {
    return this.payments.history(staff, id);
  }
}
