import type { BranchRef, StaffRole } from '@/lib/data-access/models';
import type { Grants } from '@/lib/permissions';

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
  /** Rol principal (solo para mostrar: avatar y etiqueta). */
  role: StaffRole;
  /** Permisos con alcance por sucursal (F03). Instantánea inicial; el contexto administrativo la refresca. */
  grants: Grants;
  /** Sucursales activas autorizadas (selector del backoffice). */
  branches: BranchRef[];
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
    // Sesiones guardadas antes de F03 no traen `grants`: se descartan (hay que volver a entrar).
    const staff = parsed.staff && 'grants' in parsed.staff ? parsed.staff : null;
    return { customer: parsed.customer ?? null, staff };
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
