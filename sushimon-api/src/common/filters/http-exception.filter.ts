import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

/** Forma estándar de error de la API (ver packages/contracts/openapi/openapi.yaml → ErrorResponse). */
export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
}

/** Nunca filtra trazas ni detalles internos en errores 5xx. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : typeof (body as { message?: unknown }).message === 'string'
            ? (body as { message: string }).message
            : exception.message;
      res.status(status).json({
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message,
      } satisfies ErrorBody);
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Error interno del servidor',
    } satisfies ErrorBody);
  }
}
