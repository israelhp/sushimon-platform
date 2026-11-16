'use client';

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createPersistedStore } from '@/lib/persisted-store';
import {
  DEFAULT_ORDER_MODE,
  ORDER_MODE_STORAGE_KEY,
  parseOrderMode,
  type OrderMode,
} from './order-mode';

const modeStore = createPersistedStore<OrderMode>({
  key: ORDER_MODE_STORAGE_KEY,
  initial: DEFAULT_ORDER_MODE,
  parse: parseOrderMode,
});

/** Solo para pruebas: fija el modo persistido ANTES de montar (evita que el estado de una prueba anterior dispare consultas). */
export function writeOrderModeForTests(next: OrderMode): void {
  modeStore.set(next);
}

export interface OrderModeApi {
  mode: OrderMode;
  /** true si el cliente ya eligió recoger o domicilio. */
  isSet: boolean;
  setMode: (next: OrderMode | ((prev: OrderMode) => OrderMode)) => void;
  update: (patch: Partial<OrderMode>) => void;
  reset: () => void;
}

const OrderModeContext = createContext<OrderModeApi | null>(null);

/** Modo de pedido (solo preferencia en localStorage; los horarios los valida el servidor). */
export function OrderModeProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(modeStore.subscribe, modeStore.get, modeStore.getServer);
  const api = useMemo<OrderModeApi>(
    () => ({
      mode,
      isSet: mode.type !== null,
      setMode: (next) => modeStore.set(next),
      update: (patch) => modeStore.set((m) => ({ ...m, ...patch })),
      reset: () => modeStore.set(DEFAULT_ORDER_MODE),
    }),
    [mode],
  );
  return <OrderModeContext.Provider value={api}>{children}</OrderModeContext.Provider>;
}

export function useOrderMode(): OrderModeApi {
  const ctx = useContext(OrderModeContext);
  if (!ctx) throw new Error('useOrderMode debe usarse dentro de <OrderModeProvider>');
  return ctx;
}

/** Como `useOrderMode`, pero `null` fuera del proveedor (hooks de datos que también corren en pruebas o fuera de la tienda). */
export function useOptionalOrderMode(): OrderModeApi | null {
  return useContext(OrderModeContext);
}
