'use client';

import type { ReactNode } from 'react';
import { DataProvider } from '@/lib/data-access/provider';
import { CartProvider } from '@/features/cart/cart-context';
import { OrderModeProvider } from '@/features/order-mode/order-mode-context';
import { DemoSessionProvider } from '@/features/session/demo-session';

/**
 * Proveedores de datos y estado del cliente compartidos por ambas zonas.
 * Orden: DataProvider (DataClient + QueryClient) → sesión de demostración (usa el QueryClient
 * para limpiar cachés al cambiar de identidad) → carrito → modo de pedido.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <DemoSessionProvider>
        <CartProvider>
          <OrderModeProvider>{children}</OrderModeProvider>
        </CartProvider>
      </DemoSessionProvider>
    </DataProvider>
  );
}
