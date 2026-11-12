'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { isApiError } from './errors';
import type { DataClient } from './types';
import { getDataClient } from './index';

const DataClientContext = createContext<DataClient | null>(null);

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // No reintentar errores de cliente (4xx) ni sin conexión simulada.
        retry: (count, error) =>
          !(isApiError(error) && (error.status === 0 || error.status < 500)) && count < 2,
      },
    },
  });
}

/**
 * Provee el DataClient (mock o http) y TanStack Query a la app. Las pantallas no usan este
 * contexto directamente: los hooks de cada feature lo leen con `useDataClient()`.
 */
export function DataProvider({
  children,
  client,
  queryClient: customQueryClient,
}: {
  children: ReactNode;
  client?: DataClient;
  /** Para pruebas (p. ej. sin reintentos). */
  queryClient?: QueryClient;
}) {
  const [dataClient] = useState(() => client ?? getDataClient());
  const [queryClient] = useState(() => customQueryClient ?? createQueryClient());
  return (
    <DataClientContext.Provider value={dataClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </DataClientContext.Provider>
  );
}

export function useDataClient(): DataClient {
  const client = useContext(DataClientContext);
  if (!client) throw new Error('useDataClient debe usarse dentro de <DataProvider>');
  return client;
}
