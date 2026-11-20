import { HttpException, HttpStatus } from '@nestjs/common';
import { dbErrorCodes, isRetryableDbError } from '../common/db/db-error-codes.js';
import { codedException } from '../common/errors/coded-exception.js';

/** Token del semáforo de BD de los motoristas (singleton por proceso). */
export const RIDERS_DB_GATE = Symbol('RIDERS_DB_GATE');

export const RIDERS_BUSY_RETRY_AFTER_S = 2;

/** 404 ÚNICO para motorista inexistente y fuera del alcance de `riders.read` (anti-IDOR): mismo cuerpo. */
export const riderNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'RIDER_NOT_FOUND', 'Motorista no encontrado');

export const riderActionForbidden = () =>
  codedException(
    HttpStatus.FORBIDDEN,
    'RIDER_ACTION_FORBIDDEN',
    'No tienes permiso para esta acción en la sucursal indicada',
  );

export const riderPhoneTaken = () =>
  codedException(HttpStatus.CONFLICT, 'RIDER_PHONE_TAKEN', 'El teléfono ya está registrado');

/** 409 con la versión vigente (`current`, lista blanca del filtro global). */
export const riderVersionConflict = (current: number) =>
  new HttpException(
    {
      message: 'El motorista cambió; recarga e inténtalo de nuevo',
      code: 'RIDER_VERSION_CONFLICT',
      extra: { current },
    },
    HttpStatus.CONFLICT,
  );

export const riderHasActiveDelivery = () =>
  codedException(
    HttpStatus.CONFLICT,
    'RIDER_HAS_ACTIVE_DELIVERY',
    'El motorista tiene una entrega activa',
  );

export const riderInactive = () =>
  codedException(
    HttpStatus.CONFLICT,
    'RIDER_INACTIVE',
    'Un motorista inactivo no puede marcarse disponible',
  );

export const branchNotAvailable = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'BRANCH_NOT_AVAILABLE',
    'La sucursal no existe o está inactiva',
  );

/** 503 reintentable; mensaje fijo; en `PUBLIC_5XX_CODES`; `Retry-After: 2`. */
export const ridersBusy = () =>
  new HttpException(
    {
      message: 'No podemos procesar la solicitud ahora mismo; inténtalo de nuevo',
      code: 'RIDERS_BUSY',
      retryAfter: RIDERS_BUSY_RETRY_AFTER_S,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );

/**
 * Traduce errores de BD esperables: `23505` (único: solo `riders_phone_key` y la PK) => 409 `RIDER_PHONE_TAKEN`; `23514`/`23503`
 * del trigger/FK de sucursal => 422 (solo escrituras que mueven o crean con sucursal: `branchCheck`); ocupación => 503.
 * Mensajes fijos: nunca valores ni nombres de restricciones.
 */
export function translateRidersDbError(
  error: unknown,
  ctx: { branchCheck?: boolean } = {},
): unknown {
  if (typeof error !== 'object' || error === null) return error;
  if (error instanceof HttpException) return error;
  const codes = dbErrorCodes(error);
  if (codes.includes('P2002') || codes.includes('23505')) return riderPhoneTaken();
  if (ctx.branchCheck && ['23514', '23503', 'P2003'].some((c) => codes.includes(c))) {
    return branchNotAvailable();
  }
  return isRetryableDbError(error) ? ridersBusy() : error;
}
