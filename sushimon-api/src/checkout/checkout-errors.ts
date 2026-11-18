import { HttpStatus } from '@nestjs/common';
import { isRetryableDbError } from '../common/db/db-error-codes.js';
import { codedException } from '../common/errors/coded-exception.js';

/** Token del semáforo de lecturas de la cotización (singleton por proceso/instancia; ADR-0025 D7). */
export const CHECKOUT_DB_GATE = Symbol('CHECKOUT_DB_GATE');
/** Secreto HMAC de la vigencia firmada (`string | undefined`; sin él `quote.token = null`). */
export const CHECKOUT_QUOTE_SECRET_TOKEN = Symbol('CHECKOUT_QUOTE_SECRET');

/** 503 reintentable con mensaje fijo: nunca detalles de la causa. `CHECKOUT_BUSY` está en la lista blanca pública 5xx. */
export const checkoutBusy = () =>
  codedException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'CHECKOUT_BUSY',
    'El cotizador está ocupado; reintenta en unos segundos',
  );

export const branchNotAvailable = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'BRANCH_NOT_AVAILABLE',
    'La sucursal no está disponible',
    [{ path: 'cart.branchId', code: 'BRANCH_NOT_AVAILABLE', message: 'Sucursal no disponible' }],
  );

export const municipalityNotFound = () =>
  codedException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'MUNICIPALITY_NOT_FOUND',
    'El municipio no existe',
    [
      {
        path: 'fulfillment.municipalityId',
        code: 'MUNICIPALITY_NOT_FOUND',
        message: 'Municipio inexistente',
      },
    ],
  );

/** Traduce SOLO «ocupado o sin conexión» a 503 `CHECKOUT_BUSY`; el resto vuelve igual (el filtro global lo trata). */
export function translateCheckoutDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  return isRetryableDbError(error) ? checkoutBusy() : error;
}
