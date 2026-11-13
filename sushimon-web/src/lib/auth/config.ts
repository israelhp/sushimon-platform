/**
 * Configuración de autenticación. `mock` = sesión de demostración (Etapa 1); `supabase` = Supabase Auth real
 * (Google + PKCE). Sin fallback silencioso: una configuración inválida lanza error.
 */
export type AuthConfig =
  { kind: 'mock' } | { kind: 'supabase'; supabaseUrl: string; publishableKey: string };

type Env = Record<string, string | undefined>;

export function resolveAuthConfig(env: Env): AuthConfig {
  const kind = env.NEXT_PUBLIC_AUTH_SOURCE ?? 'mock';

  if (kind === 'supabase') {
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !publishableKey) {
      throw new Error(
        'AUTH_SOURCE=supabase exige NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      );
    }
    if ((env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock') !== 'http') {
      // Con datos simulados no hay API que valide el token: sería una sesión real sin servidor.
      throw new Error('AUTH_SOURCE=supabase exige NEXT_PUBLIC_DATA_SOURCE=http');
    }
    try {
      new URL(supabaseUrl);
    } catch {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL no es una URL válida');
    }
    return { kind: 'supabase', supabaseUrl: supabaseUrl.replace(/\/+$/, ''), publishableKey };
  }

  if (kind === 'mock') {
    if (env.NODE_ENV === 'production' && env.NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION !== 'true') {
      throw new Error(
        'AUTH_SOURCE=mock no está permitido en producción sin autorización explícita',
      );
    }
    return { kind: 'mock' };
  }

  throw new Error(`NEXT_PUBLIC_AUTH_SOURCE inválido: ${kind}`);
}
