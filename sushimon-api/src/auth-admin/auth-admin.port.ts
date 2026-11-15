/** Token de inyección del puerto de administración de identidad (Supabase Auth Admin API). */
export const AUTH_ADMIN_PORT = Symbol('AUTH_ADMIN_PORT');

export interface MfaFactorRef {
  id: string;
}

/**
 * Operaciones de administración de identidad que necesita el backoffice. Hoy solo el reinicio de MFA (F02).
 * Las implementaciones NUNCA incluyen secretos, cuerpos de respuesta del proveedor ni PII en sus errores.
 */
export interface AuthAdminPort {
  /** Factores MFA (de cualquier tipo y estado) del usuario de Auth. */
  listMfaFactors(authUserId: string): Promise<MfaFactorRef[]>;
  /** Elimina un factor. Idempotente: un factor ya inexistente no es error. */
  deleteMfaFactor(authUserId: string, factorId: string): Promise<void>;
}

/** El puerto no está configurado (falta la clave de servicio): el servicio responde 503 `MFA_RESET_UNAVAILABLE`. */
export class AuthAdminUnavailableError extends Error {
  constructor() {
    super('auth-admin: no configurado');
    this.name = 'AuthAdminUnavailableError';
  }
}

export type AuthAdminFailureKind = 'timeout' | 'network' | 'http_status' | 'bad_response';

/** Fallo del proveedor. Solo una categoría fija y, si aplica, el status HTTP: nada del cuerpo ni de la URL. */
export class AuthAdminProviderError extends Error {
  constructor(
    readonly kind: AuthAdminFailureKind,
    readonly status?: number,
  ) {
    super(`auth-admin: ${kind}${status === undefined ? '' : ` ${status}`}`);
    this.name = 'AuthAdminProviderError';
  }
}
