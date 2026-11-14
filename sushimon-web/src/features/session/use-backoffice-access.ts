'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { loadMfaStatus, type MfaStatus } from '@/lib/auth/mfa';
import { resolveAuthConfig } from '@/lib/auth/config';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-browser';
import { publicEnv } from '@/lib/data-access';
import { useAuth } from './auth-provider';
import { useAuthContext } from './auth-queries';
import { resolveBackofficeAccess, type BackofficeAccessKind } from './backoffice-access';

/** Cliente de Supabase del navegador, o null con auth `mock` (nunca se toca Supabase en demostración). */
export function useSupabaseClient() {
  const { mode } = useAuth();
  return useMemo(() => {
    if (mode !== 'supabase') return null;
    const config = resolveAuthConfig(publicEnv());
    return config.kind === 'supabase' ? getSupabaseBrowserClient(config) : null;
  }, [mode]);
}

export interface BackofficeAccess {
  state: BackofficeAccessKind;
  /** Vuelve a consultar al servidor y a Supabase (tras verificar MFA o ante un error temporal). */
  revalidate: () => Promise<void>;
  mfa: MfaStatus | undefined;
}

/**
 * Combina sesión + decisión del servidor + factores MFA en un único estado. La consulta de factores solo se
 * hace cuando la API dice `MFA_REQUIRED` (personal autorizado en aal1): un cliente nunca consulta nada de MFA.
 */
export function useBackofficeAccess(): BackofficeAccess {
  const qc = useQueryClient();
  const auth = useAuth();
  const supabase = useSupabaseClient();
  const context = useAuthContext();
  const needsMfa = context.data?.access === 'MFA_REQUIRED';

  const mfa = useQuery({
    queryKey: ['auth', 'mfa'],
    queryFn: () => loadMfaStatus(supabase!),
    enabled: supabase !== null && auth.status === 'authenticated' && needsMfa,
    staleTime: 0,
    retry: 1,
  });

  const state = resolveBackofficeAccess({
    authStatus: auth.mode === 'supabase' ? auth.status : 'anonymous',
    expired: auth.expired,
    context: { isPending: context.isPending, isError: context.isError, data: context.data },
    mfa: { isPending: mfa.isPending, isError: mfa.isError, data: mfa.data },
  });

  // Inconsistencia: Supabase del cliente dice aal2 pero la API sigue viendo aal1 (token anterior). Se refresca
  // la sesión UNA vez y se revalida; si persiste, queda en MFA_CHALLENGE_REQUIRED (nunca se concede).
  const refreshedStale = useRef(false);
  useEffect(() => {
    if (!supabase || !needsMfa || mfa.data?.currentLevel !== 'aal2' || refreshedStale.current)
      return;
    refreshedStale.current = true;
    void supabase.auth.refreshSession().then(() => qc.invalidateQueries({ queryKey: ['auth'] }));
  }, [supabase, needsMfa, mfa.data?.currentLevel, qc]);

  const revalidate = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['auth'] });
  }, [qc]);

  return { state, revalidate, mfa: mfa.data };
}
