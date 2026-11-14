import { QueryClient } from '@tanstack/react-query';
import { act, render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { CartProvider, useCart, type CartApi } from '@/features/cart/cart-context';
import { ProductSheetProvider } from '@/features/catalog/product-sheet-context';
import {
  OrderModeProvider,
  useOrderMode,
  type OrderModeApi,
} from '@/features/order-mode/order-mode-context';
import {
  DemoSessionProvider,
  useDemoSession,
  type DemoSessionApi,
} from '@/features/session/demo-session';
import {
  StoreShellProvider,
  useStoreShell,
  type StoreShellApi,
} from '@/features/store-shell/store-shell-context';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import { DataProvider } from '@/lib/data-access/provider';
import { createFixedClock } from '@/mocks/clock';
import { createMockDataClient } from '@/mocks/index';
import type { MockScenario } from '@/mocks/scenarios';
import { createSeedStore } from '@/mocks/seed';
import type { MockStore } from '@/mocks/store';

/** APIs de estado del cliente expuestas a las pruebas (carrito, modo de pedido, sesión, overlays). */
export interface StoreTestApi {
  cart: CartApi;
  mode: OrderModeApi;
  session: DemoSessionApi;
  shell: StoreShellApi;
}

export interface RenderStoreOptions {
  scenario?: MockScenario;
  locale?: 'es' | 'en';
  /** Ajusta el store mock antes de montar (p. ej., desactivar sucursales). */
  prepareStore?: (store: MockStore) => void;
}

/**
 * Renderiza con los proveedores REALES de la tienda: next-intl, DataProvider con `createMockDataClient`
 * (latencia 0, reloj fijo, sin persistencia ni reintentos), sesión de demostración, carrito, modo de pedido,
 * avisos, overlays y ficha de producto. Limpia el estado persistido del cliente antes de cada render.
 */
export async function renderStore(
  ui: ReactElement,
  { scenario = 'default', locale = 'es', prepareStore }: RenderStoreOptions = {},
): Promise<RenderResult & { api: () => StoreTestApi }> {
  let current: StoreTestApi | null = null;
  function Probe() {
    current = {
      cart: useCart(),
      mode: useOrderMode(),
      session: useDemoSession(),
      shell: useStoreShell(),
    };
    return null;
  }

  const seeded = createSeedStore(scenario);
  prepareStore?.(seeded);
  const client = createMockDataClient({
    scenario,
    latencyMs: 0,
    persist: false,
    store: seeded,
    clock: createFixedClock(),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'en' ? en : es}
      timeZone="America/Guatemala"
    >
      <DataProvider client={client} queryClient={queryClient}>
        <DemoSessionProvider>
          <CartProvider>
            <OrderModeProvider>
              <ToastProvider zone="store">
                <StoreShellProvider>
                  <ProductSheetProvider>
                    <Probe />
                    {children}
                  </ProductSheetProvider>
                </StoreShellProvider>
              </ToastProvider>
            </OrderModeProvider>
          </CartProvider>
        </DemoSessionProvider>
      </DataProvider>
    </NextIntlClientProvider>
  );

  const result = render(ui, { wrapper: Wrapper });
  const api = () => {
    if (!current) throw new Error('Probe no montado');
    return current;
  };
  // Estado persistido de módulos (carrito, modo, sesión) → limpio entre pruebas.
  await act(async () => {
    api().cart.clear();
    api().mode.reset();
    api().session.signOutCustomer();
  });
  return Object.assign(result, { api });
}
