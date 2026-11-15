import { ApiError } from '@/lib/data-access/errors';
import {
  withShortcuts,
  type DataClient,
  type HttpMethod,
  type RequestOptions,
} from '@/lib/data-access/types';

/** Solicitud observada por el cliente espía. */
export interface SpiedCall {
  method: HttpMethod;
  path: string;
  query: RequestOptions['query'];
}

/** Retiene una solicitud hasta `release()` (se ejecuta entonces en el servidor mock) o la hace fallar con `fail(error)`. */
export interface Gate {
  /** Cuántas solicitudes ha retenido (para esperar a que llegue). */
  readonly held: () => boolean;
  release: () => void;
  fail: (error: ApiError) => void;
}

/**
 * Envoltorio de pruebas sobre un DataClient: registra cada solicitud y permite retener la siguiente que coincida
 * (`method` + `path`) para controlar el orden de las respuestas. No usa red: el cliente base es el mock.
 */
export function createSpyClient() {
  const calls: SpiedCall[] = [];
  const gates: { method: HttpMethod; path: RegExp; used: boolean; wait: Promise<void> }[] = [];

  const wrap = (base: DataClient): DataClient =>
    withShortcuts('mock', async <T>(path: string, options: RequestOptions = {}) => {
      const method = options.method ?? 'GET';
      calls.push({ method, path, query: options.query });
      const gate = gates.find((g) => !g.used && g.method === method && g.path.test(path));
      if (gate) {
        gate.used = true;
        await gate.wait;
      }
      return base.request<T>(path, options);
    });

  /** Retiene la próxima solicitud `method` cuya ruta coincida con `path`. */
  const hold = (method: HttpMethod, path: RegExp): Gate => {
    let release!: () => void;
    let fail!: (error: ApiError) => void;
    const wait = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    const entry = { method, path, used: false, wait };
    gates.push(entry);
    return { held: () => entry.used, release: () => release(), fail: (error) => fail(error) };
  };

  const count = (method: HttpMethod, path: RegExp, pageSize?: string) =>
    calls.filter(
      (c) =>
        c.method === method &&
        path.test(c.path) &&
        (pageSize === undefined || String(c.query?.pageSize) === pageSize),
    ).length;

  return { wrap, hold, calls, count };
}
