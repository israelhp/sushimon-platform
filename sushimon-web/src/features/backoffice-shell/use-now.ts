'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import { getStoreConfig } from '@/services/store';
import { queryKeys } from '../query-keys';

/** Intervalo del contador de tiempo transcurrido del prototipo (cada minuto). */
export const NOW_TICK_MS = 60_000;

/**
 * "Ahora" de la demo: el reloj del servidor (`StoreConfig.serverTime`; en mock, el reloj inyectable que parte
 * de miércoles 2026-11-11 14:25 en Guatemala). Se vuelve a consultar cada minuto, igual que el contador
 * `mins + 1` del prototipo, de modo que los "hace N min" avanzan. Nunca lee `new Date()` para el dominio.
 * Devuelve `null` mientras carga.
 */
export function useNow(): Date | null {
  const client = useDataClient();
  const query = useQuery({
    queryKey: queryKeys.store.config,
    queryFn: () => getStoreConfig(client),
    staleTime: NOW_TICK_MS,
    refetchInterval: NOW_TICK_MS,
  });
  const serverTime = query.data?.serverTime;
  return useMemo(() => (serverTime ? new Date(serverTime) : null), [serverTime]);
}
