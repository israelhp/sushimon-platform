'use client';

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createPersistedStore } from '@/lib/persisted-store';
import {
  addLine,
  changeQuantity,
  CART_STORAGE_KEY,
  itemCount,
  parseCart,
  quantityOf,
  removeLine,
  removeOne,
  setNote,
  setQuantity,
  type CartLine,
} from './cart';

/** Carrito del cliente en localStorage (`monsushi-cart-v1`). Solo preferencia, no autoriza nada. */
const cartStore = createPersistedStore<CartLine[]>({
  key: CART_STORAGE_KEY,
  initial: [],
  parse: parseCart,
});

export interface CartApi {
  lines: CartLine[];
  /** Unidades totales. */
  count: number;
  add: (productId: string, quantity?: number, note?: string) => void;
  increment: (index: number) => void;
  decrement: (index: number) => void;
  setQuantity: (index: number, quantity: number) => void;
  setNote: (index: number, note: string) => void;
  remove: (index: number) => void;
  removeOne: (productId: string) => void;
  /** Reemplaza todo el carrito (p. ej., "repetir pedido" en modo reemplazar). */
  replace: (lines: CartLine[]) => void;
  clear: () => void;
  quantityOf: (productId: string) => number;
}

const CartContext = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const lines = useSyncExternalStore(cartStore.subscribe, cartStore.get, cartStore.getServer);
  const api = useMemo<CartApi>(
    () => ({
      lines,
      count: itemCount(lines),
      add: (productId, quantity = 1, note = '') =>
        cartStore.set((l) => addLine(l, productId, quantity, note)),
      increment: (i) => cartStore.set((l) => changeQuantity(l, i, 1)),
      decrement: (i) => cartStore.set((l) => changeQuantity(l, i, -1)),
      setQuantity: (i, q) => cartStore.set((l) => setQuantity(l, i, q)),
      setNote: (i, note) => cartStore.set((l) => setNote(l, i, note)),
      remove: (i) => cartStore.set((l) => removeLine(l, i)),
      removeOne: (productId) => cartStore.set((l) => removeOne(l, productId)),
      replace: (next) => cartStore.set(parseCart(JSON.stringify(next))),
      clear: () => cartStore.set([]),
      quantityOf: (productId) => quantityOf(lines, productId),
    }),
    [lines],
  );
  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart debe usarse dentro de <CartProvider>');
  return ctx;
}
