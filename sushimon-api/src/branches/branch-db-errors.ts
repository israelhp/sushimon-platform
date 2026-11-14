import { BadRequestException, ConflictException } from '@nestjs/common';
import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';

/**
 * Traduce errores de BD esperables a HTTP; devuelve el mismo error si no son del dominio (→ 500 genérico).
 * - UNIQUE (P2002/23505): 409 solo si es el de `code`; si el driver no informa el objetivo se asume `code`
 *   (es la única restricción única además de la PK, que genera la BD). Otro UNIQUE: no se miente con un 409.
 * - CHECK (P2004/23514): 400 con mensaje genérico (no se filtra el nombre de la restricción).
 */
export function translateBranchDbError(error: unknown): unknown {
  const found = codes(error);
  if (found.includes('P2002') || found.includes('23505')) {
    const target = uniqueTarget(error);
    if (target === null || /code/i.test(target)) {
      return new ConflictException('Ya existe una sucursal con ese código');
    }
    return error;
  }
  if (found.includes('P2004') || found.includes('23514')) {
    return new BadRequestException(['Datos inválidos']);
  }
  return error;
}
