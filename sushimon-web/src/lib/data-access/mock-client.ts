import type { MockScenario } from '@/mocks/scenarios';
import { ApiError } from './errors';
import {
  toSearchParams,
  withShortcuts,
  type DataClient,
  type HttpMethod,
  type RequestOptions,
} from './types';

/** Contexto que recibe cada handler mock. */
export interface MockRequest<TStore, TContext = undefined> {
  method: HttpMethod;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  store: TStore;
  scenario: MockScenario;
  /**
   * Contexto por solicitud (p. ej., sesión de demostración y reloj). Simula lo que en http viaja
   * en la cookie/token y decide el servidor: los services nunca envían rol ni permisos.
   */
  context: TContext;
}

export type MockHandler<TStore, TContext = undefined> = (
  req: MockRequest<TStore, TContext>,
) => unknown;

/** Rutas mock con la forma `'METHOD /v1/recurso/:param'`. */
export type MockRoutes<TStore, TContext = undefined> = Record<
  string,
  MockHandler<TStore, TContext>
>;

export interface MockClientOptions<TStore, TContext = undefined> {
  routes: MockRoutes<TStore, TContext>;
  store: TStore;
  scenario: MockScenario;
  /** Latencia simulada (ms). 0 en pruebas. */
  latencyMs?: number;
  /** Se invoca tras cada escritura exitosa (persistencia de la sesión de demo). */
  onWrite?: (store: TStore) => void;
  /** Se evalúa en cada solicitud; su resultado llega al handler como `req.context`. */
  context?: () => TContext;
}

interface CompiledRoute<TStore, TContext> {
  method: HttpMethod;
  regex: RegExp;
  keys: string[];
  handler: MockHandler<TStore, TContext>;
}

function compile<TStore, TContext>(
  routes: MockRoutes<TStore, TContext>,
): CompiledRoute<TStore, TContext>[] {
  return Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(' ') as [HttpMethod, string];
    const keys: string[] = [];
    const source = pattern.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
      keys.push(name);
      return '([^/]+)';
    });
    return { method, regex: new RegExp(`^${source}$`), keys, handler };
  });
}

/**
 * Instrumentación de PRUEBAS (Playwright): si la página define `window.__sushimonMockRequests = []` antes de cargar, cada solicitud
 * del adaptador mock se anota ahí como `METHOD /ruta?query` (el mock no emite solicitudes de red, así que no se pueden contar con
 * `page.on('request')`). Sin ese arreglo no hace nada.
 */
declare global {
  interface Window {
    __sushimonMockRequests?: string[];
  }
}

function recordRequest(method: string, path: string, query: RequestOptions['query']): void {
  if (typeof window === 'undefined' || !Array.isArray(window.__sushimonMockRequests)) return;
  const qs = toSearchParams(query).toString();
  window.__sushimonMockRequests.push(`${method} ${path}${qs ? `?${qs}` : ''}`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

/**
 * Adaptador mock: resuelve `METHOD ruta` contra handlers puros sobre un store en memoria.
 * Los escenarios globales (loading, error, offline, forbidden, request-rejected) se aplican aquí;
 * los de dominio (payment-rejected, branch-closed…) los aplican los handlers vía `req.scenario`.
 * Entradas y salidas se clonan para que nadie mute el store desde fuera.
 */
export function createMockClient<TStore, TContext = undefined>(
  options: MockClientOptions<TStore, TContext>,
): DataClient {
  const compiled = compile(options.routes);
  const { scenario, latencyMs = 0 } = options;

  async function request<T>(path: string, req: RequestOptions = {}): Promise<T> {
    const { method = 'GET', query, body, signal } = req;
    recordRequest(method, path, query);
    if (scenario === 'loading') return new Promise<T>(() => {});
    await sleep(latencyMs, signal);
    if (scenario === 'offline')
      throw new ApiError(0, 'offline', `${method} ${path} → sin conexión`);
    if (scenario === 'error') {
      throw new ApiError(500, 'server_error', 'Error del servidor (simulado)');
    }
    if (
      scenario === 'forbidden' &&
      (path.startsWith('/v1/backoffice') || path.startsWith('/v1/admin'))
    ) {
      throw new ApiError(403, 'forbidden', 'Permiso insuficiente (simulado)');
    }
    if (scenario === 'request-rejected' && method !== 'GET') {
      throw new ApiError(422, 'unprocessable', 'Solicitud rechazada (simulado)');
    }

    for (const route of compiled) {
      if (route.method !== method) continue;
      const match = route.regex.exec(path);
      if (!match) continue;
      const params = Object.fromEntries(
        route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1] ?? '')]),
      );
      const result = route.handler({
        method,
        path,
        params,
        query: toSearchParams(query),
        body: body === undefined ? undefined : structuredClone(body),
        store: options.store,
        scenario,
        context: options.context?.() as TContext,
      });
      if (method !== 'GET') options.onWrite?.(options.store);
      return (result === undefined ? undefined : structuredClone(result)) as T;
    }
    throw new ApiError(404, 'not_found', `Ruta mock no definida: ${method} ${path}`);
  }

  return withShortcuts('mock', request);
}
