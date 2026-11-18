import { DbGate } from '../common/concurrency/db-gate.js';
import { storeBusy } from './store-policy.js';

/** Token del semáforo compartido de lecturas del agregado (un singleton por proceso/instancia). */
export const STORE_DB_GATE = Symbol('STORE_DB_GATE');

/**
 * Semáforo COMPARTIDO por proceso para las lecturas del bootstrap (singleton del módulo, no por solicitud): protege el
 * pool de conexiones entre solicitudes concurrentes. Cupo propio (< `DB_POOL_MAX`, para que siempre quede una conexión a
 * otras rutas), cola acotada y espera máxima corta: si se supera, rechaza AL INSTANTE con 503 `STORE_BUSY` (mensaje fijo)
 * en vez de acumular solicitudes. Siempre libera el cupo (también si la tarea falla). En serverless el contador es POR
 * INSTANCIA. Implementación común: `DbGate` (F19 la reutiliza con `CHECKOUT_BUSY`).
 */
export class StoreDbGate extends DbGate {
  constructor(max: number, maxQueue: number, maxWaitMs: number) {
    super(max, maxQueue, maxWaitMs, storeBusy);
  }
}
