import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Forma estándar de error (ver packages/contracts/openapi/openapi.yaml → ErrorResponse). */
export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
  /** Detalle por campo en errores de validación (400). */
  details?: string[];
}

/** Nunca filtra trazas ni detalles internos en errores 5xx. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const requestId = ctx.getRequest<Request>().id;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const payload = typeof raw === 'string' ? { message: raw } : (raw as Record<string, unknown>);
      const details =
        Array.isArray(payload['message']) && payload['message'].every((m) => typeof m === 'string')
          ? payload['message']
          : undefined;
      const message = details
        ? 'Solicitud inválida'
        : typeof payload['message'] === 'string'
          ? payload['message']
          : exception.message;
      const body: ErrorBody = {
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message,
        ...(requestId ? { requestId } : {}),
        ...(details ? { details } : {}),
      };
      if (status >= 500) this.logger.error(`[${requestId ?? '-'}] ${exception.message}`);
      res.status(status).json(body);
      return;
    }

    this.logger.error(
      `[${requestId ?? '-'}] ${exception instanceof Error ? exception.stack : String(exception)}`,
    );
    res.status(500).json({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Error interno del servidor',
      ...(requestId ? { requestId } : {}),
    } satisfies ErrorBody);
  }
}
