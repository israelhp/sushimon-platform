import { PayloadTooLargeException } from '@nestjs/common';
import type { Request, Response } from 'express';

/** El cuerpo válido es `{}` o `{ "branchId": "<uuid>" }` (~50 bytes): 2 KB sobran y acotan el trabajo de cualquier basura. */
export const REORDER_MAX_BODY_BYTES = 2048;

/**
 * Tope propio del cuerpo de `POST /v1/orders/{id}/reorder-preview` (F23), ANTES de los guards y de la BD. Corre después del
 * parser JSON global (límite por defecto de Express: 100 KB => 413 del parser): comprueba `Content-Length` y, si falta
 * (chunked), el tamaño del JSON ya parseado. => 413 con la forma estándar (lo trata `AllExceptionsFilter`).
 */
export function reorderBodyLimitMiddleware(req: Request, _res: Response, next: () => void): void {
  const declared = Number(req.header('content-length'));
  const tooBig =
    (Number.isFinite(declared) && declared > REORDER_MAX_BODY_BYTES) ||
    (req.body !== undefined &&
      Buffer.byteLength(JSON.stringify(req.body)) > REORDER_MAX_BODY_BYTES);
  if (tooBig) throw new PayloadTooLargeException('Cuerpo demasiado grande');
  next();
}
