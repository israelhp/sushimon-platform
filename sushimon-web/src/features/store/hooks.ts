'use client';

import { useQuery } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import { getStoreConfig, listBranches } from '@/services/store';
import { queryKeys } from '../query-keys';

/**
 * SIMULADO (MOCK_ONLY, F10): configuración de la tienda (reglas de programación, zonas inexistentes, contacto, serverTime).
 * La API aún no expone `/v1/store/config`; en modo `http` esta consulta falla y las pantallas muestran su estado de error.
 */
export function useStoreConfig() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.store.config,
    queryFn: () => getStoreConfig(client),
    staleTime: 5 * 60_000,
  });
}

/**
 * SIMULADO (MOCK_ONLY): vista operativa rica (`/v1/demo/branches/operations`, solo mock). Úsala SOLO donde se reproduce
 * un pedido simulado (F20: confirmación, seguimiento, incidencias) o el backoffice de demostración. Las pantallas de
 * tienda/checkout/selector de entrega usan `usePublicBranches()` (F07), `useBranchesAvailability()` (F08) y
 * `useAddressCoverage()` (F09), que sí tienen API real.
 */
export function useBranches() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.store.branchOperations,
    queryFn: () => listBranches(client),
  });
}
