import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthConfig } from './config';

type SupabaseConfig = Extract<AuthConfig, { kind: 'supabase' }>;

let client: SupabaseClient | null = null;

/**
 * Cliente de Supabase para el navegador. Flujo PKCE (por defecto en @supabase/ssr): el verificador queda en
 * cookies y el `code` del callback se canjea en el servidor. Sesión persistida en cookies (no localStorage)
 * y renovación automática del access token. Solo usa la clave PÚBLICA (publishable): nunca la service role.
 */
export function getSupabaseBrowserClient(config: SupabaseConfig): SupabaseClient {
  client ??= createBrowserClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
