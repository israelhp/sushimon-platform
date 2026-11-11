'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Detalle global del pedido (drawer + modal Rechazar), como en el prototipo donde el detalle se abre desde
 * cualquier pantalla (panel, pedidos, notificaciones, entregas…).
 *
 *   const detail = useOrderDetail();
 *   detail.open(order.id);   // abre el drawer
 *   detail.close();
 */
export interface OrderDetailApi {
  orderId: string | null;
  open: (orderId: string) => void;
  close: () => void;
  rejectOpen: boolean;
  openReject: () => void;
  closeReject: () => void;
}

const OrderDetailContext = createContext<OrderDetailApi | null>(null);

export function OrderDetailProvider({ children }: { children: ReactNode }) {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const open = useCallback((id: string) => {
    setOrderId(id);
    setRejectOpen(false);
  }, []);
  const close = useCallback(() => {
    setOrderId(null);
    setRejectOpen(false);
  }, []);
  const openReject = useCallback(() => setRejectOpen(true), []);
  const closeReject = useCallback(() => setRejectOpen(false), []);

  const api = useMemo<OrderDetailApi>(
    () => ({ orderId, open, close, rejectOpen, openReject, closeReject }),
    [orderId, open, close, rejectOpen, openReject, closeReject],
  );

  return <OrderDetailContext.Provider value={api}>{children}</OrderDetailContext.Provider>;
}

export function useOrderDetail(): OrderDetailApi {
  const ctx = useContext(OrderDetailContext);
  if (!ctx) throw new Error('useOrderDetail debe usarse dentro de <OrderDetailProvider>');
  return ctx;
}
