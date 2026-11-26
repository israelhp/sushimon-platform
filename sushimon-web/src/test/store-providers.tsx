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
  writeOrderModeForTests,
  type OrderModeApi,
} from '@/features/order-mode/order-mode-context';
import { FavoritesProvider } from '@/features/favorites/favorites-provider';
import { CustomerCacheGuard } from '@/features/session/customer-scope';
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
import type { DataClient } from '@/lib/data-access/types';
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
  /** F13: sucursal elegida en el modo de pedido (recoger) antes de montar; sin ella no hay overlay (precios base). */
  branchId?: string;
  /** Envuelve el DataClient (p. ej., para contar solicitudes o retener respuestas). */
  wrapClient?: (client: DataClient) => DataClient;
}

/**
 * Renderiza con los proveedores REALES de la tienda: next-intl, DataProvider con `createMockDataClient`
 * (latencia 0, reloj fijo, sin persistencia ni reintentos), sesión de demostración, carrito, modo de pedido,
 * avisos, overlays y ficha de producto. Limpia el estado persistido del cliente antes de cada render.
 */
/** Dirección a domicilio de las pruebas (ADR-0036: la tienda es solo a domicilio). */
const TEST_ADDRESS = {
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone: '10',
  line: '6a avenida 10-50',
  references: '',
};

export async function renderStore(
  ui: ReactElement,
  {
    scenario = 'default',
    locale = 'es',
    prepareStore,
    wrapClient,
    branchId,
  }: RenderStoreOptions = {},
): Promise<RenderResult & { api: () => StoreTestApi; queryClient: QueryClient }> {
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

  writeOrderModeForTests(
    branchId
      ? { type: 'delivery', branchId, address: TEST_ADDRESS }
      : { type: null, branchId: null, address: null },
  );
  const seeded = createSeedStore(scenario);
  prepareStore?.(seeded);
  const mockClient = createMockDataClient({
    scenario,
    latencyMs: 0,
    persist: false,
    store: seeded,
    clock: createFixedClock(),
  });
  const client = wrapClient ? wrapClient(mockClient) : mockClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'en' ? en : es}
      timeZone="America/Guatemala"
    >
      <DataProvider client={client} queryClient={queryClient}>
        <DemoSessionProvider>
          <CustomerCacheGuard />
          <CartProvider>
            <OrderModeProvider>
              <ToastProvider zone="store">
                <StoreShellProvider>
                  <ProductSheetProvider>
                    <FavoritesProvider>
                      <Probe />
                      {children}
                    </FavoritesProvider>
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
    if (branchId) {
      api().mode.setMode({ type: 'delivery', branchId, address: TEST_ADDRESS });
    }
  });
  return Object.assign(result, { api, queryClient });
}
