'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DispatchModalHost } from './dispatch-modal-host';

/**
 * PUNTO DE INTEGRACIÓN del modal "Despachar pedido" (PedidosYa simulado / repartidor propio).
 *
 * Contrato estable para las pantallas (Pedidos, Panel, Entregas…):
 *   const dispatchModal = useDispatchModal();
 *   dispatchModal.open(order.id);   // abre el modal de despacho del pedido
 *   dispatchModal.close();
 *   dispatchModal.orderId;          // id del pedido abierto (o null)
 *
 * Hoy `DispatchModalHost` es un STUB que muestra un aviso TODO visible. El bloque de Entregas lo reemplaza
 * por el modal real (cotizar con `useCourierQuote`, despachar con `useDispatchOrder`) sin tocar las pantallas.
 */
export interface DispatchModalApi {
  open: (orderId: string) => void;
  close: () => void;
  orderId: string | null;
  isOpen: boolean;
}

const DispatchModalContext = createContext<DispatchModalApi | null>(null);

export function DispatchModalProvider({ children }: { children: ReactNode }) {
  const [orderId, setOrderId] = useState<string | null>(null);
  const open = useCallback((id: string) => setOrderId(id), []);
  const close = useCallback(() => setOrderId(null), []);
  const api = useMemo<DispatchModalApi>(
    () => ({ open, close, orderId, isOpen: orderId !== null }),
    [open, close, orderId],
  );
  return (
    <DispatchModalContext.Provider value={api}>
      {children}
      {orderId ? <DispatchModalHost orderId={orderId} onClose={close} /> : null}
    </DispatchModalContext.Provider>
  );
}

export function useDispatchModal(): DispatchModalApi {
  const ctx = useContext(DispatchModalContext);
  if (!ctx) throw new Error('useDispatchModal debe usarse dentro de <DispatchModalProvider>');
  return ctx;
}
