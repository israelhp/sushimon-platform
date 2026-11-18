import type { Request, Response } from 'express';
import {
  MAX_BODY_BYTES,
  MAX_LINES,
  MAX_SELECTIONS_PER_LINE,
  MAX_SELECTIONS_TOTAL,
  quoteLimitsExceeded,
} from './checkout-policy.js';

/** Conteos baratos del cuerpo YA parseado, sin confiar en su forma (la validación fina viene después, en los pipes). */
function countsOf(body: unknown): { lines: number; maxPerLine: number; selections: number } {
  const cart = (body as { cart?: unknown } | null | undefined)?.cart;
  const lines = (cart as { lines?: unknown } | null | undefined)?.lines;
  if (!Array.isArray(lines)) return { lines: 0, maxPerLine: 0, selections: 0 };
  let maxPerLine = 0;
  let selections = 0;
  for (const line of lines.slice(0, MAX_LINES + 1) as unknown[]) {
    const list = (line as { selections?: unknown } | null | undefined)?.selections;
    const n = Array.isArray(list) ? list.length : 0;
    maxPerLine = Math.max(maxPerLine, n);
    selections += n;
  }
  return { lines: lines.length, maxPerLine, selections };
}

/**
 * Topes del cuerpo de la cotización ANTES de los pipes y de la validación profunda (P43): 64 KB, 30 líneas, 30
 * selecciones por línea y 300 en total => 400 `QUOTE_LIMITS_EXCEEDED` (así un cuerpo enorme no cuesta validar miles de
 * objetos anidados). Corre DESPUÉS del parser JSON: comprueba `Content-Length` y, si falta (chunked), el tamaño del JSON
 * ya parseado. Lanza dentro del middleware de Nest, así que lo trata `AllExceptionsFilter`.
 */
export function checkoutBodyLimitMiddleware(req: Request, _res: Response, next: () => void): void {
  const declared = Number(req.header('content-length'));
  const tooBig =
    (Number.isFinite(declared) && declared > MAX_BODY_BYTES) ||
    (req.body !== undefined && Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES);
  if (tooBig) throw quoteLimitsExceeded('El cuerpo de la cotización supera 64 KB');
  const c = countsOf(req.body);
  if (c.lines > MAX_LINES) throw quoteLimitsExceeded(`Máximo ${MAX_LINES} líneas por cotización`);
  if (c.maxPerLine > MAX_SELECTIONS_PER_LINE) {
    throw quoteLimitsExceeded(`Máximo ${MAX_SELECTIONS_PER_LINE} selecciones por línea`);
  }
  if (c.selections > MAX_SELECTIONS_TOTAL) {
    throw quoteLimitsExceeded(`Máximo ${MAX_SELECTIONS_TOTAL} selecciones por cotización`);
  }
  next();
}
