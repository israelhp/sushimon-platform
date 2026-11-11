import { ApiError, codeForStatus } from './errors';
import { toSearchParams, withShortcuts, type DataClient, type RequestOptions } from './types';

/** @deprecated Usa ApiError. Alias conservado para no romper importaciones existentes. */
export const HttpError = ApiError;

/**
 * Adaptador HTTP hacia la API NestJS (/v1). Normaliza errores a ApiError a partir del cuerpo
 * `ErrorResponse` del contrato. Sin credenciales todavía (auth en la Etapa 3).
 */
export function createHttpClient(baseUrl: string, fetchImpl: typeof fetch = fetch): DataClient {
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', query, body, signal } = options;
    const qs = toSearchParams(query).toString();
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}${qs ? `?${qs}` : ''}`, {
        method,
        signal,
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if ((error as Error | undefined)?.name === 'AbortError') throw error;
      throw new ApiError(0, 'offline', `${method} ${path} → sin conexión`);
    }
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: unknown } | null;
      const message =
        typeof payload?.message === 'string'
          ? payload.message
          : `${method} ${path} → ${res.status}`;
      throw new ApiError(res.status, codeForStatus(res.status), message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  return withShortcuts('http', request);
}
