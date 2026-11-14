import { BadRequestException, ConflictException } from '@nestjs/common';
import { dbErrorCodes, uniqueTarget } from '../common/db/db-error-codes.js';

/**
 * Traduce errores de BD esperables a 4xx; devuelve el mismo error si no son del dominio (→ 500 genérico).
 * Mensajes genéricos: no se filtran nombres de restricciones ni valores.
 * - UNIQUE (P2002/23505): 409. Si el driver informa el objetivo y es el correo (o no lo informa) → mensaje del correo.
 * - CHECK / trigger «admin⇔global» (P2004/23514): 400.
 * - FK (P2003/23503): 400 (rol o sucursal que dejó de existir entre la validación y la escritura).
 * - Serialización/deadlock (40001/40P01/P2034): 409 (reintentable).
 */
export function translateStaffDbError(error: unknown): unknown {
  const found = dbErrorCodes(error);
  if (found.includes('P2002') || found.includes('23505')) {
    const target = uniqueTarget(error);
    if (target === null || /email/i.test(target)) {
      return new ConflictException('Ya existe un empleado con ese correo');
    }
    return new ConflictException('Conflicto con el estado actual');
  }
  if (found.includes('P2004') || found.includes('23514')) {
    return new BadRequestException(['Datos inválidos']);
  }
  if (found.includes('P2003') || found.includes('23503')) {
    return new BadRequestException(['Rol o sucursal inexistente']);
  }
  if (found.some((c) => c === '40001' || c === '40P01' || c === 'P2034')) {
    return new ConflictException('Conflicto de concurrencia, reintente');
  }
  return error;
}
