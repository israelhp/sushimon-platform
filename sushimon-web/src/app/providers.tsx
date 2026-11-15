'use client';

import type { ReactNode } from 'react';
import { DataProvider } from '@/lib/data-access/provider';
import { AuthProvider } from '@/features/session/auth-provider';
import { CustomerCacheGuard } from '@/features/session/customer-scope';
import { DemoSessionProvider } from '@/features/session/demo-session';
import { StaffSessionBridge } from '@/features/session/staff-session-bridge';

/**
 * Proveedores de datos y estado del cliente compartidos por ambas zonas.
 * Orden: DataProvider (DataClient + QueryClient) → AuthProvider (Supabase Auth real, o inerte con auth
 * `mock`) → sesión de demostración (usa el QueryClient
 * para limpiar cachés al cambiar de identidad). El carrito y el modo de pedido viven solo en la zona
 * tienda: ver `app/(public)/layout.tsx`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <AuthProvider>
        <DemoSessionProvider>
          <StaffSessionBridge />
          <CustomerCacheGuard />
          {children}
        </DemoSessionProvider>
      </AuthProvider>
    </DataProvider>
  );
}
