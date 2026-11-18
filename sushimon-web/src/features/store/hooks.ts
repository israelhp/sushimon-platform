'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { isBannerLocale } from '@/lib/banner-rules';
import { isApiError } from '@/lib/data-access/errors';
import type { BannerLocale } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  STORE_AGGREGATE_STALE_MS,
  STORE_SEARCH_GC_MS,
  canonicalSearchText,
  isSearchable,
  nextSearchPage,
} from '@/lib/store-rules';
import {
  getStoreBootstrap,
  getStoreConfig,
  listBranches,
  searchStoreProducts,
} from '@/services/store';
import { useOptionalOrderMode } from '../order-mode/order-mode-context';
import { useRefetchAtNextChange } from '../promotions/hooks';
import { useClientReady } from './client-ready';
import { queryKeys } from '../query-keys';

/**
 * SIMULADO (MOCK_ONLY, F10): configuración de la tienda (reglas de programación, zonas inexistentes, contacto, serverTime).
 * La API aún no expone `/v1/store/config`: con el adaptador http NO se emite la solicitud (`getStoreConfig` falla de inmediato con
 * el mismo 404 que ya manejaban las pantallas) y estas consultas muestran su estado de error.
 */
export function useStoreConfig() {
  const client = useDataClient();
  const query = useQuery({
    queryKey: queryKeys.store.config,
    queryFn: () => getStoreConfig(client),
    staleTime: 5 * 60_000,
    // 404 = el endpoint no existe en la API (permanente): reintentar no sirve.
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 2,
  });
  /** `true` cuando `GET /v1/store/config` no existe en la API (adaptador http): las pantallas ocultan el bloque en vez de ofrecer «Reintentar». */
  const unavailable = isApiError(query.error) && query.error.status === 404;
  return Object.assign(query, { unavailable });
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

/**
 * F17 — Agregado de arranque del Inicio (`GET /v1/store/bootstrap`) para la sucursal y el idioma dados (`null` = sin sucursal: sin
 * disponibilidad ni promociones, solo banners para todas). UNA solicitud en lugar de categorías + catálogo + overlay + banners. Si la
 * sucursal guardada en el navegador ya no existe o está inactiva (404 `BRANCH_NOT_FOUND`) se reintenta SIN sucursal en vez de dejar el
 * Inicio vacío. Refetch programado en `nextChangeAt` (medido con `generatedAt` del SERVIDOR), al volver al foco y al cambiar de
 * sucursal/idioma (clave). Sin HydrationBoundary: la sucursal vive en localStorage.
 */
export function useStoreBootstrap(branchId: string | null, locale: BannerLocale) {
  const client = useDataClient();
  // La sucursal vive en localStorage: durante la hidratación el modo de pedido aún es el inicial (sin sucursal). No se consulta hasta
  // conocerla, para no emitir una solicitud «sin sucursal» que enseguida se descarta.
  const ready = useClientReady();
  const query = useQuery({
    enabled: ready,
    queryKey: queryKeys.store.bootstrap(branchId, locale),
    queryFn: async ({ signal }) => {
      try {
        return await getStoreBootstrap(client, { branchId, locale }, signal);
      } catch (error) {
        if (
          branchId !== null &&
          isApiError(error) &&
          error.status === 404 &&
          error.businessCode === 'BRANCH_NOT_FOUND'
        ) {
          return await getStoreBootstrap(client, { branchId: null, locale }, signal);
        }
        throw error;
      }
    },
    staleTime: STORE_AGGREGATE_STALE_MS,
    refetchOnWindowFocus: true,
  });
  useRefetchAtNextChange(query);
  return query;
}

/** Bootstrap del Inicio con la sucursal del modo de pedido y el idioma activo (todas las secciones del Inicio comparten la clave). */
export function useHomeBootstrap() {
  const rawLocale = useLocale();
  const locale = isBannerLocale(rawLocale) ? rawLocale : 'es';
  const branchId = useOptionalOrderMode()?.mode.branchId ?? null;
  return useStoreBootstrap(branchId, locale);
}

export interface StoreSearchFilters {
  branchId?: string | null;
  categorySlug?: string;
  /** `true` = solo disponibles (exige sucursal). */
  available?: boolean;
}

/**
 * F17 — Búsqueda pública con «Ver más» (`GET /v1/store/search`). Pasa el texto YA con debounce (300 ms): solo corre con 2 a 80
 * caracteres tras recortar; la clave lleva el texto canónico (minúsculas), la sucursal y los filtros. `signal` se reenvía: al cambiar
 * el texto la solicitud anterior se CANCELA y una respuesta tardía nunca pisa la vigente (otra clave). `placeholderData` conserva
 * los resultados previos mientras llegan los nuevos (sin parpadeo; `isPlaceholderData` indica que están desfasados).
 */
export function useStoreSearch(text: string, filters: StoreSearchFilters = {}) {
  const client = useDataClient();
  const q = canonicalSearchText(text);
  const branchId = filters.branchId ?? null;
  const rest = { categorySlug: filters.categorySlug, available: filters.available };
  return useInfiniteQuery({
    queryKey: queryKeys.store.search(branchId, q, rest),
    queryFn: ({ pageParam, signal }) =>
      searchStoreProducts(client, { q, branchId, ...rest, page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => nextSearchPage(last),
    enabled: isSearchable(q),
    // Se conservan los resultados previos SOLO si cambia el texto (misma sucursal y mismos filtros). Al cambiar de sucursal NUNCA:
    // los precios y la disponibilidad de otra sucursal no pueden quedar a la vista (ni «Ver más» de la anterior).
    placeholderData: (previous, previousQuery) =>
      previousQuery &&
      sameSearchScope(previousQuery.queryKey, queryKeys.store.search(branchId, q, rest))
        ? previous
        : undefined,
    staleTime: STORE_AGGREGATE_STALE_MS,
    gcTime: STORE_SEARCH_GC_MS,
  });
}

/** ¿Dos claves de búsqueda comparten sucursal y filtros (difieren a lo sumo en el texto)? */
export function sameSearchScope(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a[2] === b[2] && JSON.stringify(a[4]) === JSON.stringify(b[4]);
}
