'use client';

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { usePublicBranches } from '@/features/branches/hooks';
import { queryKeys } from '@/features/query-keys';
import { useOrderSheet } from '@/features/store-shell/store-shell-context';
import { useOrderMode } from './order-mode-context';

/**
 * Selección de sucursal de la tienda. La lista pública (F07) trae SOLO sucursales activas: si la persistida ya no
 * está, se limpia el modo de pedido y se pide elegir otra. Al cambiar de sucursal se invalidan solo las consultas
 * dependientes (catálogo/disponibilidad y cotizaciones de envío), no toda la app.
 */

export const isBranchAvailable = (branchId: string | null, list: readonly { id: string }[]) =>
  branchId === null || list.some((b) => b.id === branchId);

export function invalidateBranchScopedQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.storeMenu.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.deliveryCoverage.all }),
  ]);
}

/** Devuelve una función que invalida lo dependiente de la sucursal cuando esta cambia. */
export function useBranchChangeInvalidation() {
  const queryClient = useQueryClient();
  return (previous: string | null, next: string | null) => {
    if (previous !== next) void invalidateBranchScopedQueries(queryClient);
  };
}

/** Componente sin UI: vigila que la sucursal persistida siga activa. Se monta una vez en los overlays de la tienda. */
export function BranchSelectionGuard() {
  const { mode, reset } = useOrderMode();
  const { open } = useOrderSheet();
  const queryClient = useQueryClient();
  const branches = usePublicBranches();
  const list = branches.data;

  useEffect(() => {
    if (!list || isBranchAvailable(mode.branchId, list)) return;
    reset();
    void invalidateBranchScopedQueries(queryClient);
    open('now', 'branchRemoved');
  }, [list, mode.branchId, reset, open, queryClient]);

  return null;
}
