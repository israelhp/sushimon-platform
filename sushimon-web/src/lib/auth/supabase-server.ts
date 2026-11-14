import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/data-access';
import { resolveAuthConfig } from './config';

/** Cliente de Supabase para Route Handlers / Server Components, ligado a las cookies de la petición. */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const config = resolveAuthConfig(publicEnv());
  if (config.kind !== 'supabase') return null;
  const store = await cookies();
  return createServerClient(config.supabaseUrl, config.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Llamado desde un Server Component (solo lectura): `proxy.ts` ya renueva las cookies.
        }
      },
    },
  });
}
