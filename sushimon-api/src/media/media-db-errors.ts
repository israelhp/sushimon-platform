import { dbErrorCodes as codes } from '../common/db/db-error-codes.js';
import { mediaBusy, mediaInUse } from './media-policy.js';

/**
 * Red de seguridad: traduce errores de BD esperables a HTTP; devuelve el MISMO error si no son del dominio
 * (=> 500 genérico, sin detalles).
 * - P2028/55P03/40P01/40001: 503 `MEDIA_BUSY` (mensaje fijo, reintentable).
 * - FK RESTRICT (P2003/23503) al borrar un asset: 409 `MEDIA_IN_USE` (carrera con un adjuntar).
 */
export function translateMediaDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  const found = codes(error);
  if (
    found.includes('55P03') ||
    found.includes('P2028') ||
    found.includes('40P01') ||
    found.includes('40001')
  )
    return mediaBusy();
  if (found.includes('P2003') || found.includes('23503')) return mediaInUse();
  return error;
}

/** Violación UNIQUE (P2002/23505): para la carrera de dedup por checksum. */
export const isUniqueViolation = (error: unknown): boolean => {
  const found = codes(error);
  return found.includes('P2002') || found.includes('23505');
};
