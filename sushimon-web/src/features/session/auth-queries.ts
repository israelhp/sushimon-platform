'use client';

import { useQuery } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import { isApiError } from '@/lib/data-access/errors';
import { getAuthContext, getIdentity } from '@/services/auth';
import { useAuth } from './auth-provider';

const noRetryOnAuth = (count: number, error: unknown) =>
  !(isApiError(error) && error.status < 500 && error.status !== 0) && count < 2;

/** Contexto de identidad/autorización del servidor. Solo con sesión real de Supabase. */
export function useAuthContext() {
  const client = useDataClient();
  const { mode, status } = useAuth();
  return useQuery({
    queryKey: ['auth', 'context'],
    queryFn: ({ signal }) => getAuthContext(client, signal),
    enabled: mode === 'supabase' && status === 'authenticated',
    staleTime: 60_000,
    retry: noRetryOnAuth,
  });
}

/** Perfil del cliente (crea el perfil en el primer acceso). Solo con sesión real de Supabase. */
export function useIdentity() {
  const client = useDataClient();
  const { mode, status } = useAuth();
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: ({ signal }) => getIdentity(client, signal),
    enabled: mode === 'supabase' && status === 'authenticated',
    staleTime: 60_000,
    retry: noRetryOnAuth,
  });
}
