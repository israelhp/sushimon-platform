import { storeBusy } from './store-policy.js';

/** Token del semáforo compartido de lecturas del agregado (un singleton por proceso/instancia). */
export const STORE_DB_GATE = Symbol('STORE_DB_GATE');

/**
 * Semáforo COMPARTIDO por proceso para las lecturas del bootstrap (singleton del módulo, no por solicitud): protege el
 * pool de conexiones entre solicitudes concurrentes. Cupo propio (< `DB_POOL_MAX`, para que siempre quede una conexión a
 * otras rutas), cola acotada y espera máxima corta: si se supera, rechaza AL INSTANTE con 503 `STORE_BUSY` (mensaje fijo)
 * en vez de acumular solicitudes. Siempre libera el cupo (también si la tarea falla). En serverless el contador es POR
 * INSTANCIA (no hay memoria compartida entre ellas): protege el pool de cada instancia, no el global.
 */
export class StoreDbGate {
  private active = 0;
  private readonly queue: { start: () => void; timer: NodeJS.Timeout }[] = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
    private readonly maxWaitMs: number,
  ) {
    this.max = Math.max(1, Math.floor(max));
  }

  get inFlight(): number {
    return this.active;
  }
  get waiting(): number {
    return this.queue.length;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        this.active += 1;
        let result: Promise<T>;
        try {
          result = task();
        } catch (error) {
          result = Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        result.then(resolve, reject).finally(() => {
          this.active -= 1;
          const next = this.queue.shift();
          if (next) {
            clearTimeout(next.timer);
            next.start();
          }
        });
      };
      if (this.active < this.max) return start();
      if (this.queue.length >= this.maxQueue) return reject(storeBusy());
      const entry = {
        start,
        timer: setTimeout(() => {
          const at = this.queue.indexOf(entry);
          if (at >= 0) this.queue.splice(at, 1);
          reject(storeBusy());
        }, this.maxWaitMs),
      };
      this.queue.push(entry);
    });
  }
}
