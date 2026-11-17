'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useDataClient } from '@/lib/data-access/provider';
import { STORE_AGGREGATE_STALE_MS, type StoreMenuParams } from '@/lib/store-rules';
import { getStoreProduct } from '@/services/products';
import { listCategories } from '@/services/store';
import { queryKeys } from '../query-keys';
import { useOptionalOrderMode } from '../order-mode/order-mode-context';
import { useRefetchAtNextChange } from '../promotions/hooks';
import { useClientReady } from '../store/client-ready';
import { loadStoreMenu, type ProductFilters } from './catalog-product';

/** Categorías visibles (incluye la de acceso a Happy Hour, `kind: 'happy_hour'`). */
export function useCategories() {
  const client = useDataClient();
  return useQuery({
    queryKey: queryKeys.catalog.categories,
    queryFn: () => listCategories(client),
  });
}

export type StoreMenuFilters = Omit<StoreMenuParams, 'branchId' | 'page' | 'pageSize'> & {
  /** `null` = sin sucursal (precios base, `available=null`). */
  branchId: string | null;
  /** `false` = no consulta (carga perezosa). */
  enabled?: boolean;
};

/**
 * F17 — Menú de UNA sucursal (`GET /v1/store/menu`, tarjetas) reunido en todas sus páginas, con filtros por categoría, orden y
 * disponibilidad. Reemplaza «catálogo completo + overlay»: una solicitud (de 100 en 100 solo si hay más). La clave lleva sucursal y
 * filtros: cambiar de sucursal NO reutiliza ni mezcla los precios de otra. 4xx (p. ej. sucursal inexistente) no se reintenta ni cae a
 * precios base: el error se muestra. Refetch en `nextChangeAt`, al volver al foco y tras mutaciones del backoffice (prefijo `store.menu`).
 */
export function useStoreMenu({ branchId, enabled = true, ...filters }: StoreMenuFilters) {
  const client = useDataClient();
  // Hasta hidratar no se conoce la sucursal guardada (localStorage): evita una solicitud «sin sucursal» que se descarta enseguida.
  const ready = useClientReady();
  const query = useQuery({
    queryKey: queryKeys.store.menu(branchId, { ...filters, page: 'all' }),
    queryFn: ({ signal }) => loadStoreMenu(client, { ...filters, branchId }, signal),
    enabled: enabled && ready,
    staleTime: STORE_AGGREGATE_STALE_MS,
    refetchOnWindowFocus: true,
  });
  useRefetchAtNextChange(query);
  return query;
}

/**
 * Catálogo de la tienda para menú, carrito, checkout, favoritos y reorden: las tarjetas de `GET /v1/store/menu` de la sucursal
 * elegida (precio efectivo, disponibilidad y promoción que decide el servidor). Sin sucursal: precios base y todo «disponible»
 * (`available=null`). `enabled: false` (carga perezosa) no consulta pero sí lee lo que ya esté en caché.
 */
export function useProducts(filters: ProductFilters = {}) {
  const selected = useOptionalOrderMode()?.mode.branchId ?? null;
  const branchId = filters.branchId === undefined ? selected : filters.branchId;
  const menu = useStoreMenu({ branchId, enabled: filters.enabled ?? true });
  const data = useMemo(() => menu.data?.items, [menu.data]);
  const { refetch } = menu;
  return {
    data,
    isPending: menu.isPending,
    isError: menu.isError,
    error: menu.error,
    branchId,
    refetch: () => refetch(),
  };
}

/**
 * Ficha pública por slug (`GET /v1/store/products/{slug}?branchId`): trae `categoryAncestors`, los extras (F12) y, con sucursal,
 * `offer` y `promotions`. Sin sucursal (`null`) es la ficha de F11/F12. 404 `PRODUCT_NOT_FOUND` o `BRANCH_NOT_FOUND` no se reintenta.
 * La clave lleva la sucursal. Refetch en `nextChangeAt` (solo con sucursal) y al volver al foco.
 */
export function useStoreProduct(slug: string | null, branchId: string | null = null) {
  const client = useDataClient();
  const query = useQuery({
    queryKey: queryKeys.products.storeDetail(slug ?? '', branchId),
    queryFn: ({ signal }) => getStoreProduct(client, slug as string, branchId, signal),
    enabled: Boolean(slug),
    staleTime: STORE_AGGREGATE_STALE_MS,
    refetchOnWindowFocus: true,
  });
  useRefetchAtNextChange(query);
  return query;
}
