import type { StaffRole } from '@/lib/data-access/models';

/**
 * Sesión de DEMOSTRACIÓN (cliente con "Google" simulado y personal del backoffice por rol).
 *
 * - Vive en sessionStorage (se borra al cerrar la pestaña) y se rotula siempre como demostración.
 * - NO es autenticación ni autorización: con DATA_SOURCE=mock, el adaptador mock la lee para
 *   reproducir lo que haría el servidor (como si fuera la cookie de sesión). Con DATA_SOURCE=http
 *   no se envía nada de esto: la identidad y el rol los decide el servidor (Supabase Auth, Etapa 3).
 */
export const DEMO_SESSION_KEY = 'monsushi-demo-session-v1';

export interface DemoCustomer {
  email: string;
  name: string;
  /** Siempre simulado en la Etapa 1. */
  provider: 'google-demo';
}

export interface DemoStaff {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
  /** null = todas las sucursales (admin). */
  branchId: string | null;
}

export interface DemoSessionState {
  customer: DemoCustomer | null;
  staff: DemoStaff | null;
}

export const EMPTY_DEMO_SESSION: DemoSessionState = { customer: null, staff: null };

export function readDemoSession(): DemoSessionState {
  if (typeof window === 'undefined') return EMPTY_DEMO_SESSION;
  try {
    const raw = window.sessionStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return EMPTY_DEMO_SESSION;
    const parsed = JSON.parse(raw) as Partial<DemoSessionState>;
    return { customer: parsed.customer ?? null, staff: parsed.staff ?? null };
  } catch {
    return EMPTY_DEMO_SESSION;
  }
}

export function writeDemoSession(state: DemoSessionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(state));
  } catch {
    // Sin almacenamiento: la sesión de demostración dura lo que dure la página.
  }
}
