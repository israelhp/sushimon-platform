'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { CustomerFavorites } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { FAVORITES_PAGE_SIZE, listMyFavorites, listMyFavoriteIds } from '@/services/favorites';
import { useCustomerScope } from '../session/customer-scope';
import { queryKeys } from '../query-keys';

/**
 * F06 — Favoritos del cliente (spec 010 D15–D16). UNA sola fuente remota (`GET /v1/me/favorites`) con dos consultas
 * aisladas por identidad: `ids` (`pageSize=0`, compartida por TODAS las tarjetas: nunca una petición por tarjeta) y
 * `list(page)` (Mis favoritos). Solo corren con sesión de cliente; sin ella la API respondería 401.
 */

/**
 * 5 min: las propias altas/bajas ya actualizan la caché (optimista + invalidación), así que no hace falta refrescar a
 * menudo. Los cambios hechos desde OTRO dispositivo aparecen en el siguiente refetch (recarga, montaje en frío o tras
 * una mutación propia), no al instante.
 */
export const IDS_STALE_MS = 5 * 60_000;
const LIST_STALE_MS = 30_000;
/** Valor del `scope` cuando no hay sesión: la consulta queda deshabilitada y nunca se llena. */
export const NO_SCOPE = 'none';
/** Tope técnico por cliente mientras no se conozca el de la API (`limit` de la respuesta). */
export const DEFAULT_LIMIT = 200;

export interface FavoriteIds {
  /** `guest` (sin sesión) · `pending` (sesión resolviéndose) · `ready`. */
  state: 'guest' | 'pending' | 'ready';
  /** Ids favoritos (más reciente primero); vacío mientras carga o sin sesión. */
  ids: ReadonlySet<string>;
  total: number;
  limit: number;
  /** Aún no se conoce el estado de los corazones (cargando). */
  isPending: boolean;
  isError: boolean;
  /** Ya hay datos del servidor para esta identidad. */
  isLoaded: boolean;
  refetch: () => void;
}

/** Estado de TODOS los corazones y el contador (una sola consulta compartida por `queryKey`). */
export function useFavoriteIds(): FavoriteIds {
  const client = useDataClient();
  const identity = useCustomerScope();
  const scope = identity.state === 'ready' ? identity.scope : null;
  const query = useQuery({
    queryKey: queryKeys.customer.favorites.ids(scope ?? NO_SCOPE),
    queryFn: ({ signal }) => listMyFavoriteIds(client, signal),
    enabled: scope !== null,
    staleTime: IDS_STALE_MS,
  });
  const data = query.data;
  const ids = useMemo<ReadonlySet<string>>(() => new Set(data?.favoriteProductIds ?? []), [data]);
  return {
    state: identity.state,
    ids,
    total: data?.total ?? 0,
    limit: data?.limit ?? DEFAULT_LIMIT,
    isPending: identity.state === 'pending' || (scope !== null && query.isPending),
    isError: scope !== null && query.isError,
    isLoaded: scope !== null && !!data,
    refetch: () => void query.refetch(),
  };
}

/** Una página de Mis favoritos (`items` en orden de `addedAt`, más `catalogStatus`). */
export function useFavoritesList(page = 1) {
  const client = useDataClient();
  const queryClient = useQueryClient();
  const identity = useCustomerScope();
  const scope = identity.state === 'ready' ? identity.scope : null;
  return useQuery({
    queryKey: queryKeys.customer.favorites.list(scope ?? NO_SCOPE, page),
    queryFn: async ({ signal }) => {
      const data = await listMyFavorites(client, { page, pageSize: FAVORITES_PAGE_SIZE }, signal);
      // La respuesta ya trae TODOS los ids: se siembran para los corazones (sin una segunda petición), salvo que haya una
      // alta/baja en vuelo (su estado optimista no debe pisarse con una lectura anterior).
      if (
        scope !== null &&
        queryClient.isMutating({ mutationKey: queryKeys.customer.favorites.mutation(scope) }) === 0
      ) {
        queryClient.setQueryData<CustomerFavorites>(queryKeys.customer.favorites.ids(scope), {
          ...data,
          items: [],
          page: 1,
          pageSize: 0,
          catalogStatus: 'AVAILABLE',
        });
      }
      return data;
    },
    enabled: scope !== null,
    staleTime: LIST_STALE_MS,
    // Mantiene la página anterior mientras llega la nueva (sin parpadeo al paginar).
    placeholderData: (previous) => previous,
  });
}
