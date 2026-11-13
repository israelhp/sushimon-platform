'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { resolveAuthConfig, type AuthConfig } from '@/lib/auth/config';
import { safeNextPath } from '@/lib/auth/safe-redirect';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-browser';
import { installTokenSource } from '@/lib/auth/token-source';
import { publicEnv } from '@/lib/data-access';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthApi {
  /** `mock` = sesión de demostración (Etapa 1); `supabase` = Supabase Auth real con Google (PKCE). */
  mode: AuthConfig['kind'];
  status: AuthStatus;
  /** La sesión expiró o fue revocada sin que la persona cerrara sesión: la UI debe avisarlo. */
  expired: boolean;
  acknowledgeExpired: () => void;
  signInWithGoogle: (next?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const MOCK_API: AuthApi = {
  mode: 'mock',
  status: 'anonymous',
  expired: false,
  acknowledgeExpired: () => undefined,
  signInWithGoogle: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
};

// Sin proveedor (p. ej. pruebas de componentes) rige la sesión simulada inerte: nunca toca Supabase.
const AuthContext = createContext<AuthApi>(MOCK_API);

/** Cachés que dependen de la identidad: se descartan al cambiar o cerrar sesión. */
const IDENTITY_KEYS = [['auth'], ['account'], ['backoffice'], ['orders', 'mine']] as const;

export function AuthProvider({ children, config }: { children: ReactNode; config?: AuthConfig }) {
  const resolved = useMemo(() => config ?? resolveAuthConfig(publicEnv()), [config]);
  if (resolved.kind === 'mock') {
    return <AuthContext.Provider value={MOCK_API}>{children}</AuthContext.Provider>;
  }
  return <SupabaseAuthProvider config={resolved}>{children}</SupabaseAuthProvider>;
}

function SupabaseAuthProvider({
  config,
  children,
}: {
  config: Extract<AuthConfig, { kind: 'supabase' }>;
  children: ReactNode;
}) {
  const supabase = useMemo(() => getSupabaseBrowserClient(config), [config]);
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [expired, setExpired] = useState(false);
  // true cuando la persona pidió cerrar sesión: distingue el cierre voluntario de una expiración.
  const voluntary = useRef(false);

  const clearIdentityCaches = useCallback(() => {
    for (const key of IDENTITY_KEYS) qc.removeQueries({ queryKey: key });
  }, [qc]);

  useEffect(() => {
    let active = true;
    const apply = (session: Session | null, event?: string) => {
      if (!active) return;
      if (session) {
        setStatus('authenticated');
        setExpired(false);
        return;
      }
      setStatus('anonymous');
      if (event === 'SIGNED_OUT') {
        clearIdentityCaches();
        // Cierre no solicitado (token de refresco vencido/revocado): avisar.
        if (!voluntary.current) setExpired(true);
        voluntary.current = false;
      }
    };

    void supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // No hacer llamadas a Supabase dentro de este callback (puede bloquear el cliente): solo estado.
      apply(session, event);
    });

    const uninstall = installTokenSource({
      // getSession() renueva el access token si está por expirar.
      getAccessToken: async () =>
        (await supabase.auth.getSession()).data.session?.access_token ?? null,
      onUnauthorized: async () => {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session) return true;
        await supabase.auth.signOut({ scope: 'local' });
        return false;
      },
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      uninstall();
    };
  }, [supabase, clearIdentityCaches]);

  const api = useMemo<AuthApi>(
    () => ({
      mode: 'supabase',
      status,
      expired,
      acknowledgeExpired: () => setExpired(false),
      signInWithGoogle: async (next) => {
        setExpired(false);
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          safeNextPath(next ?? window.location.pathname),
        )}`;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, queryParams: { prompt: 'select_account' } },
        });
        if (error) throw new Error('No se pudo iniciar el flujo con Google');
      },
      signOut: async () => {
        voluntary.current = true;
        await supabase.auth.signOut();
        clearIdentityCaches();
      },
    }),
    [status, expired, supabase, clearIdentityCaches],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  return useContext(AuthContext);
}
