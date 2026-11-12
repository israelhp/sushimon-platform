import type { components } from '@sushimon/contracts';
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
    // TODO(Etapa 3, auth): definir `credentials` (hoy el valor por defecto es 'same-origin'; con la API en
    // otro origen haría falta 'include' + CORS con `Access-Control-Allow-Credentials` y origen explícito,
    // nunca '*'). Si la sesión va en cookie, exigir protección CSRF (SameSite + token/cabecera propia
    // verificada en el servidor) en métodos que escriben. No guardar tokens en localStorage.
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
      const payload = (await res.json().catch(() => null)) as Partial<
        components['schemas']['ErrorResponse']
      > | null;
      const message =
        typeof payload?.message === 'string'
          ? payload.message
          : `${method} ${path} → ${res.status}`;
      throw new ApiError(
        res.status,
        codeForStatus(res.status),
        message,
        payload?.requestId ?? res.headers.get('x-request-id') ?? undefined,
        Array.isArray(payload?.details) ? payload.details : undefined,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  return withShortcuts('http', request);
}
