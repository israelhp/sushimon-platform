'use client';

import { useQuery } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import { getStoreConfig, listBranches } from '@/services/store';
import { queryKeys } from '../query-keys';

/** Configuración de la tienda (horarios, reglas de programación, contacto, serverTime). */
export function useStoreConfig() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.store.config,
    queryFn: () => getStoreConfig(client),
    staleTime: 5 * 60_000,
  });
}

/** Sucursales (activas y "próximamente") con `openNow`. */
export function useBranches() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.store.branchOperations,
    queryFn: () => listBranches(client),
  });
}
