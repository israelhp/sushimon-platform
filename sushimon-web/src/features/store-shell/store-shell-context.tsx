'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** Aviso opcional al abrir la hoja (p. ej., la sucursal elegida dejó de estar disponible). */
export type OrderSheetNotice = 'branchRemoved';

export interface StoreShellApi {
  cartOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  /** Hoja «Pedir ahora» (dirección de entrega) abierta. */
  orderSheet: boolean;
  orderSheetNotice: OrderSheetNotice | null;
  openOrderSheet: (notice?: OrderSheetNotice) => void;
  closeOrderSheet: () => void;
  /** Modal de inicio de sesión simulado. */
  authOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;
}

const StoreShellContext = createContext<StoreShellApi | null>(null);

/**
 * Estado de apertura de los overlays globales de la tienda (carrito, modo de pedido, inicio de sesión).
 * Es estado de UI local de la zona `(public)`: no se persiste ni autoriza nada.
 */
export function StoreShellProvider({ children }: { children: ReactNode }) {
  const [cartOpen, setCartOpen] = useState(false);
  const [orderSheet, setOrderSheet] = useState(false);
  const [orderSheetNotice, setOrderSheetNotice] = useState<OrderSheetNotice | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const api = useMemo<StoreShellApi>(
    () => ({
      cartOpen,
      openCart: () => setCartOpen(true),
      closeCart: () => setCartOpen(false),
      orderSheet,
      orderSheetNotice,
      openOrderSheet: (notice) => {
        setOrderSheetNotice(notice ?? null);
        setOrderSheet(true);
      },
      closeOrderSheet: () => {
        setOrderSheet(false);
        setOrderSheetNotice(null);
      },
      authOpen,
      openAuth: () => setAuthOpen(true),
      closeAuth: () => setAuthOpen(false),
    }),
    [cartOpen, orderSheet, orderSheetNotice, authOpen],
  );
  return <StoreShellContext.Provider value={api}>{children}</StoreShellContext.Provider>;
}

export function useStoreShell(): StoreShellApi {
  const ctx = useContext(StoreShellContext);
  if (!ctx) throw new Error('useStoreShell debe usarse dentro de <StoreShellProvider>');
  return ctx;
}

/** Abre/cierra el modal de inicio de sesión simulado (selector de cuenta "Google" rotulado como demostración). */
export function useAuthModal() {
  const { authOpen, openAuth, closeAuth } = useStoreShell();
  return { isOpen: authOpen, open: openAuth, close: closeAuth };
}

/** Abre/cierra la hoja «Pedir ahora» (dirección de entrega). */
export function useOrderSheet() {
  const { orderSheet, orderSheetNotice, openOrderSheet, closeOrderSheet } = useStoreShell();
  return {
    isOpen: orderSheet,
    notice: orderSheetNotice,
    open: openOrderSheet,
    close: closeOrderSheet,
  };
}

/** Abre/cierra el carrito lateral. */
export function useCartDrawer() {
  const { cartOpen, openCart, closeCart } = useStoreShell();
  return { isOpen: cartOpen, open: openCart, close: closeCart };
}
