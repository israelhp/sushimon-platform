import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';

const MAX_DEPTH = 10;

/** `JSON.parse` crea `__proto__` como propiedad propia; class-transformer la ignora y la whitelist no la ve. */
function hasProtoKey(value: unknown, depth = 0): boolean {
  if (typeof value !== 'object' || value === null || depth > MAX_DEPTH) return false;
  if (Object.prototype.hasOwnProperty.call(value, '__proto__')) return true;
  return Object.values(value).some((v) => hasProtoKey(v, depth + 1));
}

/** Rechaza (400) cuerpos JSON con la clave `__proto__` en cualquier nivel (higiene frente a contaminación). */
export function rejectProtoKeysMiddleware(req: Request, _res: Response, next: () => void): void {
  if (hasProtoKey(req.body)) throw new BadRequestException(['Cuerpo inválido']);
  next();
}
