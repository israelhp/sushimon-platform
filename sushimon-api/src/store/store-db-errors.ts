import { isRetryableDbError } from '../common/db/db-error-codes.js';
import { storeBusy } from './store-policy.js';

/**
 * Red de seguridad de las lecturas públicas: traduce SOLO los errores de BD «ocupado o sin conexión; reintentable»
 * (`isRetryableDbError`) a 503 `STORE_BUSY` (mensaje fijo, sin la causa). Todo lo demás (incluidas las `HttpException`
 * de dominio como 404) vuelve igual: el filtro global lo trata (500 genérico).
 */
export function translateStoreDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  return isRetryableDbError(error) ? storeBusy() : error;
}
