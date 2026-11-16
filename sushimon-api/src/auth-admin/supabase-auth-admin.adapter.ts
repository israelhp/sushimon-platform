import {
  AuthAdminProviderError,
  type AuthAdminPort,
  type MfaFactorRef,
} from './auth-admin.port.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SupabaseAuthAdminOptions {
  /** URL base del proyecto (`https://<ref>.supabase.co`). */
  supabaseUrl: string;
  /** Clave de servicio: SECRETO. Solo viaja en cabeceras hacia Supabase. */
  serviceRoleKey: string;
  timeoutMs: number;
  /** Inyectable para pruebas (sin red). */
  fetchFn?: FetchLike;
}

/**
 * Adaptador HTTP de la Admin API de GoTrue (Supabase Auth), con los endpoints exactos de
 * `@supabase/auth-js` `auth.admin.mfa.*`:
 *   GET    {url}/auth/v1/admin/users/{userId}/factors
 *   DELETE {url}/auth/v1/admin/users/{userId}/factors/{factorId}
 * Cabeceras `Authorization: Bearer <service role>` y `apikey` (igual que el SDK). Los identificadores se validan
 * como UUID antes de armar la URL. Los errores solo llevan una categoría y el status: nunca cuerpo, URL ni clave.
 */
export class SupabaseAuthAdminAdapter implements AuthAdminPort {
  private readonly base: string;
  private readonly fetchFn: FetchLike;

  constructor(private readonly options: SupabaseAuthAdminOptions) {
    this.base = `${options.supabaseUrl.replace(/\/+$/, '')}/auth/v1/admin/users`;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  }

  async listMfaFactors(authUserId: string): Promise<MfaFactorRef[]> {
    this.assertUuid(authUserId);
    const res = await this.send('GET', `${this.base}/${authUserId}/factors`);
    if (!res.ok) throw new AuthAdminProviderError('http_status', res.status);
    let body: unknown;
    try {
      body = await res.json();
    } catch (error) {
      // El plazo también corre mientras se lee el cuerpo: un timeout ahí es `timeout`, no una respuesta mal formada.
      throw new AuthAdminProviderError(isTimeout(error) ? 'timeout' : 'bad_response');
    }
    if (!Array.isArray(body)) throw new AuthAdminProviderError('bad_response');
    return body.map((f: unknown) => {
      const id = typeof f === 'object' && f !== null ? (f as { id?: unknown }).id : undefined;
      if (typeof id !== 'string' || !UUID.test(id))
        throw new AuthAdminProviderError('bad_response');
      return { id };
    });
  }

  async deleteMfaFactor(authUserId: string, factorId: string): Promise<void> {
    this.assertUuid(authUserId);
    this.assertUuid(factorId);
    const res = await this.send('DELETE', `${this.base}/${authUserId}/factors/${factorId}`);
    // 404: el factor ya no existe (reintento o carrera) = el resultado deseado.
    if (!res.ok && res.status !== 404) throw new AuthAdminProviderError('http_status', res.status);
  }

  private assertUuid(value: string): void {
    if (!UUID.test(value)) throw new AuthAdminProviderError('bad_response');
  }

  private async send(method: 'GET' | 'DELETE', url: string): Promise<Response> {
    try {
      return await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.serviceRoleKey}`,
          apikey: this.options.serviceRoleKey,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw new AuthAdminProviderError(isTimeout(error) ? 'timeout' : 'network');
    }
  }
}

function isTimeout(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}
