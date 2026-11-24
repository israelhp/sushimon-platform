/**
 * Semáforo por proceso para lecturas a la BD (generalización de `StoreDbGate`, F17 -> F19). Cupo propio (< `DB_POOL_MAX`),
 * cola acotada y espera máxima corta: si se supera, rechaza AL INSTANTE con el error que fabrique `busy` (503 con código
 * propio de cada consumidor, mensaje fijo) en vez de acumular solicitudes. Siempre libera el cupo (también si la tarea
 * falla). En serverless el contador es POR INSTANCIA (no hay memoria compartida): protege el pool de cada instancia.
 *
 * Admisión para LECTURAS de bajo valor (F21): `run(task, { rejectIfWaiting: n })` rechaza al instante con el mismo error de
 * ocupado si no hay cupo libre Y ya hay >= n en cola; así las plazas `n+1..maxQueue` de la cola quedan reservadas a las
 * escrituras (p. ej. `createOrder`) y un sondeo masivo no puede dejarlas sin sitio. Sin la opción el comportamiento es
 * exactamente el de siempre (checkout, tienda y escrituras de pedidos no la usan).
 */
export interface DbGateRunOptions {
  /** Rechaza de inmediato si no hay cupo libre y la cola ya tiene al menos este número de esperas. */
  rejectIfWaiting?: number;
}

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

  run<T>(task: () => Promise<T>, options?: DbGateRunOptions): Promise<T> {
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
      const admit = options?.rejectIfWaiting;
      if (admit !== undefined && this.queue.length >= admit) return reject(this.busy());
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
 * Reparto del presupuesto de conexiones entre los semáforos de la API (F17 tienda, F19 cotización, F20 pedidos, F27 motoristas
 * y F28 entregas), de modo que ENTRE LOS CINCO no superen `DB_POOL_MAX - 1` (siempre queda una conexión para el resto de rutas y
 * la salud). Una cotización lanza ~6-7 consultas en paralelo (2 oleadas): cupo ~1/3 (`max(1, floor(B/3))`). Los pedidos usan
 * una conexión por transacción (más 3 lecturas cortas de snapshot): cupo ~1/4 (`max(1, floor(B/4))`). Motoristas y entregas
 * (backoffice, volumen bajo, una conexión por operación) tienen cada uno su cupo propio ~1/8 (`max(1, floor(B/8))`): F27 NO
 * reutiliza el de pedidos (spec 029 §2, contradicción 2). La tienda recibe el resto (`max(1, B - checkout - orders - riders -
 * deliveries)`). Con `B >= 5` (`DB_POOL_MAX >= 6`) cada cupo es >= 1 y la suma es <= B: SIEMPRE queda al menos una conexión
 * libre para las rutas sin gate (auth, salud, backoffice). EXCEPCIÓN documentada: con `B < 5` (`DB_POOL_MAX <= 5`, incluido el
 * defecto 3) el mínimo de 1 por semáforo suma 5 > B y las rutas sin gate pueden quedarse sin conexión bajo carga simultánea de
 * los cinco gates. REQUISITO OPERATIVO de producción: `DB_POOL_MAX >= 6` (spec 029 §11, F27-4).
 */
export function splitGateBudget(poolMax: number): {
  checkout: number;
  orders: number;
  store: number;
  riders: number;
  deliveries: number;
} {
  const budget = Math.max(1, Math.floor(poolMax) - 1);
  const checkout = Math.max(1, Math.floor(budget / 3));
  const orders = Math.max(1, Math.floor(budget / 4));
  const riders = Math.max(1, Math.floor(budget / 8));
  const deliveries = Math.max(1, Math.floor(budget / 8));
  return {
    checkout,
    orders,
    riders,
    deliveries,
    store: Math.max(1, budget - checkout - orders - riders - deliveries),
  };
}
