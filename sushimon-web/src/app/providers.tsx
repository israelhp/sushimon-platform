'use client';

import type { ReactNode } from 'react';
import { DataProvider } from '@/lib/data-access/provider';
import { DemoSessionProvider } from '@/features/session/demo-session';

/**
 * Proveedores de datos y estado del cliente compartidos por ambas zonas.
 * Orden: DataProvider (DataClient + QueryClient) → sesión de demostración (usa el QueryClient
 * para limpiar cachés al cambiar de identidad). El carrito y el modo de pedido viven solo en la zona
 * tienda: ver `app/(public)/layout.tsx`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <DemoSessionProvider>{children}</DemoSessionProvider>
    </DataProvider>
  );
}
