import type { components } from '@sushimon/contracts';
import { tokenSource, type TokenSource } from '@/lib/auth/token-source';
import { ApiError, codeForStatus } from './errors';
import { toSearchParams, withShortcuts, type DataClient, type RequestOptions } from './types';

/** `Retry-After` en segundos (la forma de fecha HTTP no se interpreta); acotado a 1–120 s. */
function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw || !/^\d{1,4}$/.test(raw.trim())) return undefined;
  return Math.min(120, Math.max(1, Number(raw)));
}

/** @deprecated Usa ApiError. Alias conservado para no romper importaciones existentes. */
export const HttpError = ApiError;

/**
 * Adaptador HTTP hacia la API NestJS (/v1). Normaliza errores a ApiError a partir del cuerpo
 * `ErrorResponse` del contrato.
 *
 * Autenticación: si hay sesión de Supabase, envía `Authorization: Bearer <access token>` (solo a esta API,
 * nunca cookies: sin CSRF). Ante un 401 con token intenta UNA renovación de sesión y reintenta; si no se
 * puede, la sesión expiró y el proveedor de sesión ya avisó a la UI. El token jamás se guarda en
 * localStorage ni se registra.
 */
export function createHttpClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  auth: TokenSource = tokenSource,
): DataClient {
  async function send(
    path: string,
    options: RequestOptions,
    token: string | null,
  ): Promise<Response> {
    const {
      method = 'GET',
      query,
      body,
      signal,
      public: isPublic = false,
      headers: extra,
    } = options;
    const qs = toSearchParams(query).toString();
    const headers: Record<string, string> = {};
    // Cabeceras del llamador (F20: `Idempotency-Key`, `X-Order-Token`). Van primero: no pueden pisar las de abajo.
    for (const [name, value] of Object.entries(extra ?? {})) {
      const key = name.toLowerCase();
      if (key !== 'authorization' && key !== 'content-type') headers[key] = value;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token && !isPublic) headers['authorization'] = `Bearer ${token}`;
    try {
      return await fetchImpl(`${baseUrl}${path}${qs ? `?${qs}` : ''}`, {
        method,
        signal,
        // Lecturas públicas: se respeta el Cache-Control del servidor (F17). El resto sigue sin caché del navegador.
        ...(isPublic ? {} : { cache: 'no-store' as const }),
        credentials: 'omit',
        headers: Object.keys(headers).length ? headers : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if ((error as Error | undefined)?.name === 'AbortError') throw error;
      throw new ApiError(0, 'offline', `${method} ${path} → sin conexión`);
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    // Lectura pública: ni se consulta la sesión (la respuesta no depende de ella y la CDN no debe variar por token).
    let token = options.public ? null : await auth.getAccessToken();
    let res = await send(path, options, token);

    if (res.status === 401 && token) {
      // Token rechazado: ¿se puede renovar la sesión? Un solo reintento.
      if (await auth.onUnauthorized()) {
        token = await auth.getAccessToken();
        if (token) res = await send(path, options, token);
      }
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
        typeof payload?.code === 'string' ? payload.code : undefined,
        Array.isArray(payload?.violations) ? payload.violations : undefined,
        parseRetryAfter(res.headers.get('retry-after')),
        payload ?? undefined,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  return withShortcuts('http', request);
}
