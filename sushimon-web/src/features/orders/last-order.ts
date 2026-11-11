'use client';

import { useSyncExternalStore } from 'react';
import type { Order, OrderLine } from '@/lib/data-access/models';
import { createPersistedStore } from '@/lib/persisted-store';
import { useMyOrders } from '@/features/account/hooks';
import { useDemoSession } from '@/features/session/demo-session';
import { isOrderInProgress } from '@/lib/order-status';

/**
 * "Tu último pedido" del Inicio. Con sesión (de demostración) sale de los pedidos de la cuenta; como
 * invitado, de un resumen que el checkout guarda en el dispositivo (`saveLastOrder`) como preferencia
 * (`monsushi-last-order-v1`, igual que el prototipo). Nunca autoriza nada: ver un pedido siempre
 * requiere sesión o número + teléfono ante el servidor.
 */
export const LAST_ORDER_STORAGE_KEY = 'monsushi-last-order-v1';

export interface LastOrderSummary {
  id: string;
  total: number;
  lines: OrderLine[];
}

function parseLastOrder(raw: string | null): LastOrderSummary | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const o = v as Partial<LastOrderSummary>;
    if (typeof o.id !== 'string' || typeof o.total !== 'number' || !Array.isArray(o.lines)) {
      return null;
    }
    const lines = o.lines.filter(
      (l): l is OrderLine =>
        !!l &&
        typeof l.productId === 'string' &&
        Number(l.quantity) > 0 &&
        typeof l.name === 'string',
    );
    return lines.length ? { id: o.id, total: o.total, lines } : null;
  } catch {
    return null;
  }
}

const lastOrderStore = createPersistedStore<LastOrderSummary | null>({
  key: LAST_ORDER_STORAGE_KEY,
  initial: null,
  parse: parseLastOrder,
});

/** Guarda el resumen del pedido recién creado (lo llama el checkout al confirmar). */
export function saveLastOrder(order: Pick<Order, 'id' | 'total' | 'lines'>): void {
  lastOrderStore.set({ id: order.id, total: order.total, lines: order.lines });
}

export interface LastOrderState {
  order: LastOrderSummary | null;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

/** Último pedido del cliente (cuenta de demostración o resumen del dispositivo). */
export function useLastOrder(): LastOrderState {
  const { customer } = useDemoSession();
  const mine = useMyOrders();
  const stored = useSyncExternalStore(
    lastOrderStore.subscribe,
    lastOrderStore.get,
    lastOrderStore.getServer,
  );
  if (customer) {
    // El pedido en curso se ve en su propio aviso: aquí va el más reciente ya finalizado.
    const sorted = [...(mine.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = sorted.find((o) => !isOrderInProgress(o)) ?? sorted[0];
    return {
      order: latest ? { id: latest.id, total: latest.total, lines: latest.lines } : null,
      isPending: mine.isPending,
      isError: mine.isError,
      refetch: () => void mine.refetch(),
    };
  }
  return { order: stored, isPending: false, isError: false, refetch: () => {} };
}
