'use client';

import { useAuth } from './auth-provider';
import { useIdentity } from './auth-queries';
import { useDemoSession } from './demo-session';

export interface CustomerIdentity {
  name: string;
  email: string;
}

/**
 * Cliente que ve la UI: de Supabase Auth + `GET /v1/me` (auth real) o de la sesión de demostración (mock).
 * Solo sirve para mostrar; la API decide qué datos entrega a cada identidad.
 */
export function useCustomerIdentity(): CustomerIdentity | null {
  const auth = useAuth();
  const demo = useDemoSession();
  const me = useIdentity();
  if (auth.mode === 'supabase') {
    if (auth.status !== 'authenticated' || !me.data) return null;
    return {
      name: me.data.customer.fullName,
      email: me.data.email ?? me.data.customer.email ?? '',
    };
  }
  return demo.customer ? { name: demo.customer.name, email: demo.customer.email } : null;
}
