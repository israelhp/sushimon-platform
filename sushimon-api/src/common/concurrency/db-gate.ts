/**
 * Semáforo por proceso para lecturas a la BD (generalización de `StoreDbGate`, F17 -> F19). Cupo propio (< `DB_POOL_MAX`),
 * cola acotada y espera máxima corta: si se supera, rechaza AL INSTANTE con el error que fabrique `busy` (503 con código
 * propio de cada consumidor, mensaje fijo) en vez de acumular solicitudes. Siempre libera el cupo (también si la tarea
 * falla). En serverless el contador es POR INSTANCIA (no hay memoria compartida): protege el pool de cada instancia.
 */
export class DbGate {
  private active = 0;
  private readonly queue: { start: () => void; timer: NodeJS.Timeout }[] = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
    private readonly maxWaitMs: number,
    private readonly busy: () => Error,
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
      if (this.queue.length >= this.maxQueue) return reject(this.busy());
      const entry = {
        start,
        timer: setTimeout(() => {
          const at = this.queue.indexOf(entry);
          if (at >= 0) this.queue.splice(at, 1);
          reject(this.busy());
        }, this.maxWaitMs),
      };
      this.queue.push(entry);
    });
  }
}

/**
 * Reparto del presupuesto de conexiones entre los semáforos de lectura pública (F17 tienda y F19 cotización), de modo
 * que ENTRE LOS DOS no superen `DB_POOL_MAX - 1` (siempre queda una conexión para el resto de rutas y la salud).
 * Una cotización lanza ~6-7 consultas en paralelo (2 oleadas), así que su cupo es ~1/3 del presupuesto
 * (`max(1, floor(B/3))`); la tienda recibe el resto (`max(1, B - checkout)`). Con `DB_POOL_MAX <= 2` el mínimo de 1 por
 * semáforo hace que la suma sea 2 (> B): es inevitable con dos consumidores y un pool tan pequeño; en el defecto (3)
 * el reparto es 1 + 1 = 2 = B.
 */
export function splitGateBudget(poolMax: number): { checkout: number; store: number } {
  const budget = Math.max(1, Math.floor(poolMax) - 1);
  const checkout = Math.max(1, Math.floor(budget / 3));
  return { checkout, store: Math.max(1, budget - checkout) };
}
