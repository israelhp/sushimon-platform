import { BadRequestException, HttpStatus } from '@nestjs/common';
import { dbErrorCodes as codes, uniqueTarget } from '../common/db/db-error-codes.js';
import { codedException } from '../common/errors/coded-exception.js';

/** ¿Es la violación de `delivery_zones_branch_municipality_zone_key`? (única restricción única además de la PK). */
export function isZoneDuplicate(error: unknown): boolean {
  const found = codes(error);
  if (!found.includes('P2002') && !found.includes('23505')) return false;
  const target = uniqueTarget(error);
  return (
    target === null ||
    /delivery_zones_branch_municipality_zone_key|zone_key|branch_id/i.test(target)
  );
}

/** 409 `DELIVERY_ZONE_DUPLICATE`; `existingId` (si se conoce) va en `violations[0].path = deliveryZones/<id>`. */
export function duplicateZoneError(existingId: string | null) {
  return codedException(
    HttpStatus.CONFLICT,
    'DELIVERY_ZONE_DUPLICATE',
    'Ya existe una zona con esa etiqueta en el municipio de la sucursal',
    existingId
      ? [
          {
            path: `deliveryZones/${existingId}`,
            code: 'DUPLICATE_ZONE',
            message: 'Ya existe esta zona (activa o inactiva)',
          },
        ]
      : undefined,
  );
}

export function versionConflictError() {
  return codedException(
    HttpStatus.CONFLICT,
    'DELIVERY_ZONE_VERSION_CONFLICT',
    'La zona fue modificada por otra persona; recarga y reintenta',
  );
}

/** CHECK de BD (P2004/23514) => 400 genérico, sin filtrar el nombre de la restricción. Otro error se devuelve igual. */
export function translateCheckError(error: unknown): unknown {
  const found = codes(error);
  if (found.includes('P2004') || found.includes('23514')) {
    return new BadRequestException(['Datos inválidos']);
  }
  return error;
}
