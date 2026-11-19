'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '../query-keys';
import { useAuth } from './auth-provider';
import { useIdentity } from './auth-queries';
import { useDemoSession } from './demo-session';

/**
 * Identidad del CLIENTE para aislar sus datos en la caché (spec 009 D15).
 *  - `guest`: sin sesión de cliente (las consultas del cliente no se habilitan; la API respondería 401).
 *  - `pending`: Supabase Auth ya autenticó pero aún no se conoce el id (o la sesión se está resolviendo).
 *  - `ready`: `scope` = id de Supabase Auth (`GET /v1/me`) o `demo:<correo>` con la sesión de demostración. Nunca vacío.
 * Solo sirve para pintar y para separar cachés; la API autoriza cada solicitud.
 */
export type CustomerScope =
  { state: 'guest' } | { state: 'pending' } | { state: 'ready'; scope: string };

export function useCustomerScope(): CustomerScope {
  const auth = useAuth();
  const demo = useDemoSession();
  const me = useIdentity();
  if (auth.mode === 'supabase') {
    if (auth.status === 'loading') return { state: 'pending' };
    if (auth.status !== 'authenticated') return { state: 'guest' };
    const id = me.data?.authUserId;
    if (id) return { state: 'ready', scope: id };
    return me.isError ? { state: 'guest' } : { state: 'pending' };
  }
  const email = demo.customer?.email.trim().toLowerCase();
  return email ? { state: 'ready', scope: `demo:${email}` } : { state: 'guest' };
}

/**
 * ¿Es una consulta privada de OTRA identidad? Cubre `['customer', scope, …]` (incluido el historial F23) y los pedidos reales
 * `['orders', 'tracking' | 'placed' | 'receipt', scope | 'guest', id]` (F21/F23; el invitado es `'guest'`: al iniciar sesión se
 * descarta y viceversa).
 */
export function isOtherIdentity(key: readonly unknown[], scope: string | null): boolean {
  if (key[0] === queryKeys.customer.all[0]) return key[1] !== scope;
  if (
    key[0] === 'orders' &&
    (key[1] === 'tracking' || key[1] === 'placed' || key[1] === 'receipt')
  ) {
    return key[2] !== (scope ?? 'guest');
  }
  return false;
}

/**
 * Descarta de la caché todo dato de cliente de OTRA identidad (cierre de sesión o cambio de cuenta). Aun sin este
 * efecto otra cuenta no leería la caché ajena (la clave lleva el `scope`); esto además libera la memoria y evita
 * que reaparezcan datos del anterior al volver a entrar. Se monta una sola vez, dentro de los proveedores.
 */
export function useCustomerCacheGuard(): void {
  const queryClient = useQueryClient();
  const identity = useCustomerScope();
  const scope = identity.state === 'ready' ? identity.scope : null;
  useEffect(() => {
    queryClient.removeQueries({ predicate: (query) => isOtherIdentity(query.queryKey, scope) });
  }, [queryClient, scope]);
}

/** Componente sin UI que monta `useCustomerCacheGuard` (una sola vez en `AppProviders`). */
export function CustomerCacheGuard(): null {
  useCustomerCacheGuard();
  return null;
}
