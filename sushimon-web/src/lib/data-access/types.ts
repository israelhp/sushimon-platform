/**
 * Puerto de acceso a datos. Los services de cada dominio dependen de esta interfaz;
 * la implementación (mock o http) se elige por configuración. Las pantallas no la conocen.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method?: HttpMethod;
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

type ReadOptions = Omit<RequestOptions, 'method' | 'body'>;

export interface DataClient {
  readonly kind: 'mock' | 'http';
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: ReadOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: ReadOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: ReadOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: ReadOptions): Promise<T>;
  delete<T>(path: string, options?: ReadOptions): Promise<T>;
}

type RequestFn = <T>(path: string, options?: RequestOptions) => Promise<T>;

/** Construye un DataClient completo a partir de su función `request`. */
export function withShortcuts(kind: DataClient['kind'], request: RequestFn): DataClient {
  return {
    kind,
    request,
    get: (path, o) => request(path, { ...o, method: 'GET' }),
    post: (path, body, o) => request(path, { ...o, method: 'POST', body }),
    put: (path, body, o) => request(path, { ...o, method: 'PUT', body }),
    patch: (path, body, o) => request(path, { ...o, method: 'PATCH', body }),
    delete: (path, o) => request(path, { ...o, method: 'DELETE' }),
  };
}

/** Serializa la query omitiendo valores vacíos (mismo resultado en mock y http). */
export function toSearchParams(query: Query | undefined): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params;
}
