'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { StaffRole } from '@/lib/data-access/models';
import {
  EMPTY_DEMO_SESSION,
  readDemoSession,
  writeDemoSession,
  type DemoCustomer,
  type DemoSessionState,
  type DemoStaff,
} from '@/lib/demo-session';
import { DEMO_STAFF_BY_ROLE, demoStaffFromSeed } from '@/mocks/fixtures/staff';
import { DEMO_GOOGLE_ACCOUNTS } from '@/mocks/fixtures/orders';

/**
 * Sesión de DEMOSTRACIÓN del cliente ("Google" simulado) y del personal (rol + sucursal).
 * Vive en sessionStorage, se rotula como demostración en la UI y NO autoriza nada: con datos mock,
 * el adaptador la lee como lo haría el servidor con su cookie; con http la decide el servidor
 * (Supabase Auth, Etapa 3) y esta sesión no se usa.
 */

// Store externo mínimo (SSR-safe y sin desajustes de hidratación).
let snapshot: DemoSessionState = EMPTY_DEMO_SESSION;
let loaded = false;
const listeners = new Set<() => void>();

function getSnapshot(): DemoSessionState {
  if (!loaded && typeof window !== 'undefined') {
    snapshot = readDemoSession();
    loaded = true;
  }
  return snapshot;
}

function setSession(next: DemoSessionState) {
  snapshot = next;
  loaded = true;
  writeDemoSession(next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface DemoSessionApi extends DemoSessionState {
  /** Cuentas del selector "Google" simulado. */
  googleAccounts: readonly { email: string; name: string }[];
  signInCustomer: (account: { email: string; name: string }) => void;
  signOutCustomer: () => void;
  /** Entra al backoffice con el usuario de demostración del rol (admin/manager/kitchen/staff). */
  signInStaff: (role: StaffRole) => DemoStaff;
  /** Entra con un usuario interno concreto (id del listado de usuarios). */
  signInStaffUser: (userId: string) => DemoStaff;
  signOutStaff: () => void;
  /** Uso exclusivo del puente con Supabase Auth: refleja al personal que el SERVIDOR autorizó. */
  adoptStaff: (staff: DemoStaff | null) => void;
}

const DemoSessionContext = createContext<DemoSessionApi | null>(null);

const staffFromUser = (userId: string): DemoStaff => demoStaffFromSeed(userId);

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_DEMO_SESSION);
  const qc = useQueryClient();

  const resetCaches = useCallback(
    (zone: 'customer' | 'staff') => {
      // Los datos dependen de la identidad: se descartan los de la sesión anterior.
      // Cuenta, direcciones, pedidos y favoritos del cliente viven bajo `['customer', scope, …]` (F04–F06).
      qc.removeQueries({ queryKey: zone === 'customer' ? ['customer'] : ['backoffice'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
    [qc],
  );

  const api = useMemo<DemoSessionApi>(
    () => ({
      ...state,
      googleAccounts: DEMO_GOOGLE_ACCOUNTS,
      signInCustomer: (account) => {
        const customer: DemoCustomer = {
          email: account.email.trim().toLowerCase(),
          name: account.name,
          provider: 'google-demo',
        };
        setSession({ ...getSnapshot(), customer });
        resetCaches('customer');
      },
      signOutCustomer: () => {
        setSession({ ...getSnapshot(), customer: null });
        resetCaches('customer');
      },
      signInStaff: (role) => {
        const staff = staffFromUser(DEMO_STAFF_BY_ROLE[role]);
        setSession({ ...getSnapshot(), staff });
        resetCaches('staff');
        return staff;
      },
      signInStaffUser: (userId) => {
        const staff = staffFromUser(userId);
        setSession({ ...getSnapshot(), staff });
        resetCaches('staff');
        return staff;
      },
      signOutStaff: () => {
        setSession({ ...getSnapshot(), staff: null });
        resetCaches('staff');
      },
      adoptStaff: (staff) => {
        const current = getSnapshot().staff;
        if (JSON.stringify(current) === JSON.stringify(staff)) return;
        setSession({ ...getSnapshot(), staff });
      },
    }),
    [state, resetCaches],
  );

  return <DemoSessionContext.Provider value={api}>{children}</DemoSessionContext.Provider>;
}

export function useDemoSession(): DemoSessionApi {
  const ctx = useContext(DemoSessionContext);
  if (!ctx) throw new Error('useDemoSession debe usarse dentro de <DemoSessionProvider>');
  return ctx;
}
