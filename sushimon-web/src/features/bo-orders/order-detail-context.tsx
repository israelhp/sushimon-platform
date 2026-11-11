'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Detalle global del pedido (drawer + modal Rechazar), como en el prototipo donde el detalle se abre desde
 * cualquier pantalla (panel, pedidos, notificaciones, entregas…).
 *
 *   const detail = useOrderDetail();
 *   detail.open(order.id);   // abre el drawer
 *   detail.open(order.id, { day }); // pedido de otro día (YYYY-MM-DD), p. ej. desde Entregas
 *   detail.close();
 */
export interface OrderDetailApi {
  orderId: string | null;
  /** Día (YYYY-MM-DD) del pedido abierto si no es de hoy; null = hoy. */
  day: string | null;
  open: (orderId: string, options?: { day?: string }) => void;
  close: () => void;
  rejectOpen: boolean;
  openReject: () => void;
  closeReject: () => void;
}

const OrderDetailContext = createContext<OrderDetailApi | null>(null);

export function OrderDetailProvider({ children }: { children: ReactNode }) {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const open = useCallback((id: string, options?: { day?: string }) => {
    setOrderId(id);
    setDay(options?.day ?? null);
    setRejectOpen(false);
  }, []);
  const close = useCallback(() => {
    setOrderId(null);
    setDay(null);
    setRejectOpen(false);
  }, []);
  const openReject = useCallback(() => setRejectOpen(true), []);
  const closeReject = useCallback(() => setRejectOpen(false), []);

  const api = useMemo<OrderDetailApi>(
    () => ({ orderId, day, open, close, rejectOpen, openReject, closeReject }),
    [orderId, day, open, close, rejectOpen, openReject, closeReject],
  );

  return <OrderDetailContext.Provider value={api}>{children}</OrderDetailContext.Provider>;
}

export function useOrderDetail(): OrderDetailApi {
  const ctx = useContext(OrderDetailContext);
  if (!ctx) throw new Error('useOrderDetail debe usarse dentro de <OrderDetailProvider>');
  return ctx;
}
