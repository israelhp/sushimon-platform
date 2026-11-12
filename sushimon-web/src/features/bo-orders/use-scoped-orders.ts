'use client';

import { useBackofficeOrders } from '@/features/backoffice/hooks';
import { useShell } from '@/features/backoffice-shell/shell-context';

/** Intervalo de refresco del tablero (pedidos que llegan desde la web). */
export const ORDERS_REFRESH_MS = 30_000;

/**
 * Pedidos de hoy de la sucursal activa del shell (todas si es admin sin filtro). Comparte caché (misma clave)
 * con el detalle y el resto de pantallas. Solo el observador con `poll: true` (el shell, siempre montado)
 * programa el refresco: cada observador con `refetchInterval` crearía su propio temporizador.
 */
export function useScopedOrders({ poll = false }: { poll?: boolean } = {}) {
  const { branchId } = useShell();
  return useBackofficeOrders(
    { branchId },
    { refetchInterval: poll ? ORDERS_REFRESH_MS : undefined },
  );
}
