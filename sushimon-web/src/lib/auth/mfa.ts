import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * MFA TOTP con Supabase Auth (única fuente de verdad de los factores). Aquí NO se genera, valida ni guarda
 * ningún secreto: se llama a `supabase.auth.mfa.*` y se muestra lo que Supabase devuelve. El secreto/QR solo
 * viven en memoria de la pantalla de configuración y nunca se registran ni se envían a la API.
 */

export type Aal = 'aal1' | 'aal2';

export interface MfaStatus {
  /** Nivel de la sesión actual según el JWT que tiene el cliente (la API lo vuelve a verificar). */
  currentLevel: Aal | null;
  /** Factores TOTP VERIFICADOS. Un factor pendiente (sin verificar) NO cuenta como habilitado. */
  verifiedTotp: { id: string; label: string }[];
}

export interface TotpEnrollment {
  factorId: string;
  /** Data URL SVG del QR generado por Supabase. */
  qrCode: string;
  /** Clave para ingreso manual. */
  secret: string;
}

export type MfaErrorKey =
  'invalidCode' | 'expired' | 'factorMissing' | 'rateLimited' | 'session' | 'network' | 'unknown';

export const TOTP_CODE = /^\d{6}$/;
const ISSUER = 'Sushi Mon';

export class MfaError extends Error {
  constructor(readonly key: MfaErrorKey) {
    super(key);
  }
}

/** Traduce errores de Supabase a una clave de mensaje; nunca se muestra el texto del proveedor. */
export function toMfaError(error: unknown): MfaError {
  if (error instanceof MfaError) return error;
  const e = (error ?? {}) as { code?: string; status?: number; name?: string };
  const code = e.code ?? '';
  if (code === 'mfa_verification_failed' || code === 'mfa_verification_rejected')
    return new MfaError('invalidCode');
  if (code === 'mfa_challenge_expired') return new MfaError('expired');
  if (code === 'mfa_factor_not_found') return new MfaError('factorMissing');
  if (code === 'over_request_rate_limit' || e.status === 429) return new MfaError('rateLimited');
  if (
    ['session_not_found', 'session_expired', 'refresh_token_not_found', 'user_not_found'].includes(
      code,
    ) ||
    e.status === 401 ||
    e.name === 'AuthSessionMissingError'
  )
    return new MfaError('session');
  if (
    e.name === 'AuthRetryableFetchError' ||
    e.status === 0 ||
    e.status === 502 ||
    e.status === 503
  )
    return new MfaError('network');
  return new MfaError('unknown');
}

/** Nivel actual + factores TOTP verificados. Lanza si Supabase no responde (nunca asume un estado). */
export async function loadMfaStatus(supabase: SupabaseClient): Promise<MfaStatus> {
  const [aal, factors] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (aal.error) throw toMfaError(aal.error);
  if (factors.error) throw toMfaError(factors.error);
  return {
    currentLevel:
      aal.data.currentLevel === 'aal2' ? 'aal2' : aal.data.currentLevel === 'aal1' ? 'aal1' : null,
    verifiedTotp: factors.data.totp
      .filter((f) => f.status === 'verified')
      .map((f) => ({ id: f.id, label: f.friendly_name ?? 'TOTP' })),
  };
}

/**
 * Inicia el enrolamiento. Primero descarta los factores TOTP PENDIENTES de intentos anteriores (no
 * verificados, no otorgan nada) para no acumularlos; los verificados no se tocan. Se llama solo por acción
 * explícita de la persona, nunca al renderizar.
 */
export async function startTotpEnrollment(supabase: SupabaseClient): Promise<TotpEnrollment> {
  const listed = await supabase.auth.mfa.listFactors();
  if (listed.error) throw toMfaError(listed.error);
  if (listed.data.totp.some((f) => f.status === 'verified')) {
    // Ya hay un factor verificado: no se registra otro desde aquí (evita cuentas con factores ajenos).
    throw new MfaError('unknown');
  }
  for (const f of listed.data.all) {
    if (f.factor_type === 'totp' && f.status === 'unverified') {
      const removed = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (removed.error) throw toMfaError(removed.error);
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: ISSUER,
    friendlyName: `${ISSUER} ${Date.now().toString(36)}`,
  });
  if (error) throw toMfaError(error);
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * challenge + verify del factor y comprobación posterior de que la sesión quedó en `aal2`. Supabase actualiza
 * la sesión del cliente con el nuevo JWT. Esto NO concede acceso: solo la API (`/v1/auth/context`) lo decide.
 */
export async function verifyTotp(
  supabase: SupabaseClient,
  factorId: string,
  code: string,
): Promise<void> {
  if (!TOTP_CODE.test(code)) throw new MfaError('invalidCode');
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) throw toMfaError(challenge.error);
  const verified = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
  if (verified.error) throw toMfaError(verified.error);
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.error) throw toMfaError(aal.error);
  if (aal.data.currentLevel !== 'aal2') throw new MfaError('session');
}
