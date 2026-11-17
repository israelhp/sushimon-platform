import { dbErrorCodes } from '../common/db/db-error-codes.js';
import { storeBusy } from './store-policy.js';

/**
 * Códigos de BD que significan «ocupado o sin conexión; reintentable» (nunca un defecto de la solicitud):
 * P2028 (transacción), P2024 (espera de conexión agotada), P1001/P1002/P1008/P1017 (conexión), 55P03 (lock timeout),
 * 40P01 (deadlock), 40001 (serialización), 57014 (statement timeout), 53300 (demasiadas conexiones).
 */
const RETRYABLE = new Set([
  'P2028',
  'P2024',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  '55P03',
  '40P01',
  '40001',
  '57014',
  '53300',
]);

/**
 * Red de seguridad de las lecturas públicas: traduce SOLO esos errores a 503 `STORE_BUSY` (mensaje fijo, sin la causa).
 * Todo lo demás (incluidas las `HttpException` de dominio como 404) vuelve igual: el filtro global lo trata (500 genérico).
 */
export function translateStoreDbError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  return dbErrorCodes(error).some((c) => RETRYABLE.has(c)) ? storeBusy() : error;
}
