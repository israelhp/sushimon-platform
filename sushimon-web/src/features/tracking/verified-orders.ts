'use client';

import { useSyncExternalStore } from 'react';
import { createPersistedStore } from '@/lib/persisted-store';

/**
 * Pedidos que el invitado ya consultó con número + teléfono en esta pestaña (`sessionStorage`).
 * Es una PREFERENCIA de conveniencia (listas "Tus últimos pedidos" del Reclamo, pedido a destacar):
 * NUNCA autoriza nada. Ver un pedido siempre se le pide al servidor (`GET /v1/orders/:id`), que decide
 * según la sesión o la verificación número + teléfono; esta lista solo evita volver a escribirlos.
 */
export const VERIFIED_ORDERS_KEY = 'monsushi-verified-orders-v1';

const MAX_REMEMBERED = 20;

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string' && /^MON-\d+$/.test(v));
  } catch {
    return [];
  }
}

const store = createPersistedStore<string[]>({
  key: VERIFIED_ORDERS_KEY,
  initial: [],
  parse,
  storage: 'session',
});

/** Recuerda (solo esta pestaña) que el invitado consultó el pedido. */
export function rememberVerifiedOrder(orderId: string): void {
  store.set((prev) => (prev.includes(orderId) ? prev : [...prev, orderId].slice(-MAX_REMEMBERED)));
}

/** Olvida todos los pedidos recordados (pruebas y cierre de sesión). */
export function forgetVerifiedOrders(): void {
  store.set([]);
}

export function readVerifiedOrderIds(): string[] {
  return store.get();
}

export function useVerifiedOrderIds(): string[] {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}
