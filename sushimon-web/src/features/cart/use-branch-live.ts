'use client';

import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { isApiError } from '@/lib/data-access/errors';
import { useDataClient } from '@/lib/data-access/provider';
import type { PublicProductDetail } from '@/lib/data-access/models';
import {
  DETAIL_NOT_FOUND,
  type CartLine,
  type LiveCard,
  type LiveDetail,
  type RevalidationStatus,
} from '@/lib/cart-rules';
import { STORE_AGGREGATE_STALE_MS } from '@/lib/store-rules';
import { getStoreProduct } from '@/services/products';
import { useStoreMenu } from '../catalog/hooks';
import type { CatalogProduct } from '../catalog/catalog-product';
import { queryKeys } from '../query-keys';
import { productToLiveCard } from './add-input';

/** Fichas pedidas en paralelo como máximo (peor caso: 30 productos únicos). */
export const DETAIL_CONCURRENCY = 4;

const EMPTY: ReadonlyMap<string, LiveDetail | typeof DETAIL_NOT_FOUND> = new Map();

export interface BranchLive {
  status: RevalidationStatus;
  /** Productos del menú de la sucursal por id (`null` = aún no cargó). */
  products: ReadonlyMap<string, CatalogProduct> | null;
  cards: ReadonlyMap<string, LiveCard> | null;
  /** Fichas por slug (ausente = aún no cargó). 404 `PRODUCT_NOT_FOUND` = `DETAIL_NOT_FOUND`. */
  details: ReadonlyMap<string, LiveDetail | typeof DETAIL_NOT_FOUND>;
  retry: () => void;
}

/**
 * F18 — Lo vigente de UNA sucursal para unas líneas, SIN endpoints nuevos (spec 019 §5): precio y disponibilidad del MENÚ de la
 * sucursal (`useStoreMenu`, la misma consulta y clave que menú y checkout: sin petición extra si ya está en caché; una por
 * sucursal, no por línea) y extras de la FICHA por slug (`getStoreProduct`, clave `products.storeDetail` y `staleTime` de F17)
 * solo para productos ÚNICOS. Las claves no incluyen cantidades: cambiar cantidades nunca revalida. Se refresca por `staleTime`,
 * al volver al foco y al cambiar de sucursal (cambia la clave).
 */
export function useBranchLive(args: {
  branchId: string | null;
  lines: readonly Pick<CartLine, 'slug'>[];
  enabled: boolean;
}): BranchLive {
  const { branchId, lines, enabled } = args;
  const client = useDataClient();
  const active = enabled && branchId !== null && lines.length > 0;
  const menu = useStoreMenu({ branchId, enabled: active });
  const slugKey = [...new Set(lines.map((l) => l.slug))].sort().join('\n');
  const slugs = useMemo(() => (slugKey ? slugKey.split('\n') : []), [slugKey]);
  const queryClient = useQueryClient();
  // Concurrencia limitada: como mucho `DETAIL_CONCURRENCY` fichas SIN resolver a la vez. Se habilita la siguiente cuando alguna
  // termina (la caché ya se lee en cada render, y cada resultado vuelve a renderizar este hook).
  const settled = slugs.filter((slug) => {
    const state = queryClient.getQueryState(queryKeys.products.storeDetail(slug, branchId));
    return state !== undefined && state.status !== 'pending';
  }).length;
  const detailQueries = useQueries({
    queries: slugs.map((slug, index) => ({
      queryKey: queryKeys.products.storeDetail(slug, branchId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getStoreProduct(client, slug, branchId, signal),
      enabled: active && index < settled + DETAIL_CONCURRENCY,
      staleTime: STORE_AGGREGATE_STALE_MS,
      // Solo el MENÚ refresca al volver al foco; las fichas (extras) se revalidan por `staleTime` al reabrir el carrito.
      refetchOnWindowFocus: false,
    })),
  });

  const products = useMemo(
    () => (menu.data ? new Map(menu.data.items.map((p) => [p.id, p])) : null),
    [menu.data],
  );
  const cards = useMemo(() => {
    if (!products) return null;
    const out = new Map<string, LiveCard>();
    for (const p of products.values()) out.set(p.id, productToLiveCard(p));
    return out;
  }, [products]);

  const results = detailQueries.map((q) => q);
  const detailKey = results
    .map((q, i) => `${slugs[i]}:${q.dataUpdatedAt}:${q.errorUpdatedAt}:${q.status}`)
    .join('|');
  const { details, detailsFailed, detailsPending } = useMemo(() => {
    const map = new Map<string, LiveDetail | typeof DETAIL_NOT_FOUND>();
    let failed = false;
    let pending = false;
    results.forEach((q, i) => {
      const slug = slugs[i] as string;
      const data = q.data as PublicProductDetail | undefined;
      if (data) map.set(slug, { groups: data.modifierGroups ?? [] });
      else if (
        isApiError(q.error) &&
        q.error.status === 404 &&
        q.error.businessCode === 'PRODUCT_NOT_FOUND'
      ) {
        map.set(slug, DETAIL_NOT_FOUND);
      } else if (q.isError) failed = true;
      else pending = true;
    });
    return { details: map, detailsFailed: failed, detailsPending: pending };
    // `results` cambia de identidad en cada render: `detailKey` resume lo que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey, slugs]);

  const status: RevalidationStatus = !active
    ? 'idle'
    : !menu.data && menu.isError
      ? 'error'
      : detailsFailed
        ? 'error'
        : !menu.data || detailsPending
          ? 'pending'
          : 'ready';

  const { refetch } = menu;
  const retry = () => {
    void refetch();
    detailQueries.forEach((q) => {
      if (q.isError) void q.refetch();
    });
  };
  return { status, products, cards, details: active ? details : EMPTY, retry };
}
