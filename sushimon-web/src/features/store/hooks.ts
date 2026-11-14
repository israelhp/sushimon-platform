'use client';

import { useQuery } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import {
  getStoreConfig,
  listBranches,
  quoteDelivery,
  type DeliveryQuoteArgs,
} from '@/services/store';
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

/**
 * Tarifa y ETA por zona. Se ejecuta solo con `args` completos (null = deshabilitado).
 * Un 400 indica dirección incompleta; `covered: false` indica sin cobertura.
 */
export function useDeliveryQuote(args: DeliveryQuoteArgs | null) {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.store.deliveryQuote(args ?? { department: '', municipality: '' }),
    queryFn: () => quoteDelivery(client, args as DeliveryQuoteArgs),
    enabled: !!args && !!args.department && !!args.municipality,
  });
}
