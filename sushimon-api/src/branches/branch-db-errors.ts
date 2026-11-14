import { BadRequestException, ConflictException } from '@nestjs/common';

/** Candidatos donde Prisma/pg dejan el SQLSTATE o el código de Prisma, según la versión del adaptador. */
function codes(error: unknown): string[] {
  if (typeof error !== 'object' || error === null) return [];
  const e = error as {
    code?: unknown;
    meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } };
    cause?: { code?: unknown; originalCode?: unknown };
  };
  return [
    e.code,
    e.meta?.code,
    e.meta?.driverAdapterError?.cause?.originalCode,
    e.cause?.code,
    e.cause?.originalCode,
  ].filter((c): c is string => typeof c === 'string');
}

/** Texto de `meta.target` / constraint para saber QUÉ restricción única se violó (si el driver lo informa). */
function uniqueTarget(error: unknown): string | null {
  const e = error as {
    meta?: { target?: unknown; constraint?: unknown; driverAdapterError?: { cause?: unknown } };
    constraint?: unknown;
  };
  const raw = [e.meta?.target, e.meta?.constraint, e.constraint, e.meta?.driverAdapterError?.cause];
  const found = raw.filter((v) => v !== undefined && v !== null);
  return found.length === 0 ? null : JSON.stringify(found);
}

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
