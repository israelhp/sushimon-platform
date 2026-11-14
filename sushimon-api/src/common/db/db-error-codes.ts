/** Utilidades compartidas para traducir errores de BD (Prisma/pg) a HTTP en cada módulo. */

/** Candidatos donde Prisma/pg dejan el SQLSTATE o el código de Prisma, según la versión del adaptador. */
export function dbErrorCodes(error: unknown): string[] {
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
export function uniqueTarget(error: unknown): string | null {
  const e = error as {
    meta?: { target?: unknown; constraint?: unknown; driverAdapterError?: { cause?: unknown } };
    constraint?: unknown;
  };
  const raw = [e.meta?.target, e.meta?.constraint, e.constraint, e.meta?.driverAdapterError?.cause];
  const found = raw.filter((v) => v !== undefined && v !== null);
  return found.length === 0 ? null : JSON.stringify(found);
}
