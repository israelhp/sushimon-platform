import { HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { ErrorBody } from '../filters/http-exception.filter.js';
import { PRIVATE_NO_STORE } from '../filters/http-exception.filter.js';

/**
 * Errores del parser JSON de Express (413 por tamaño, 400 por JSON inválido, 415 por charset/codificación): ocurren ANTES
 * de Nest y, sin esto, los respondería el manejador por defecto de Express (HTML, sin `ErrorResponse`). Se emiten con
 * la forma estándar, mensaje fijo (sin eco del cuerpo ni de la causa) y `no-store` (o `private, no-store` si la ruta ya
 * lo fijó). Cualquier otro error pasa al siguiente manejador.
 */
export function bodyParserErrorMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const e = error as { status?: unknown; type?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : 0;
  if (typeof e?.type !== 'string' || status < 400 || status > 499) return next(error);
  const message = status === 413 ? 'Cuerpo demasiado grande' : 'Cuerpo inválido';
  const body: ErrorBody = {
    statusCode: status,
    error: HttpStatus[status] ?? 'Error',
    message,
    ...(req.id ? { requestId: req.id } : {}),
  };
  if (res.getHeader('Cache-Control') !== PRIVATE_NO_STORE) {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.status(status).json(body);
}
