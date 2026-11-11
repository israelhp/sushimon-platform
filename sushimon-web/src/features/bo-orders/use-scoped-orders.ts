'use client';

import { useBackofficeOrders } from '@/features/backoffice/hooks';
import { useShell } from '@/features/backoffice-shell/shell-context';

/** Intervalo de refresco del tablero (pedidos que llegan desde la web). */
export const ORDERS_REFRESH_MS = 15_000;

/** Pedidos de hoy de la sucursal activa del shell (todas si es admin sin filtro). Comparte caché con el detalle. */
export function useScopedOrders() {
  const { branchId } = useShell();
  return useBackofficeOrders({ branchId }, { refetchInterval: ORDERS_REFRESH_MS });
}
