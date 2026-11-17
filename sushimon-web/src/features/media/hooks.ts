'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import {
  attachProductMedia,
  deleteMedia,
  detachProductMedia,
  listMedia,
  reorderProductMedia,
  updateProductMedia,
  type MediaFilters,
} from '@/services/media';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { invalidateStoreAggregates } from '../store/invalidate';

/**
 * F14 — Hooks de medios del backoffice. Toda mutación invalida la biblioteca (`media`), los productos (administración y
 * fichas/búsquedas públicas, prefijo `products`) y el catálogo unido de la tienda (`catalog`: lista y tarjetas). La mutación
 * queda pendiente hasta que termina el refetch para que el editor nunca muestre datos viejos.
 */
export function useInvalidateMedia() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.media.all }),
      qc.invalidateQueries({ queryKey: queryKeys.products.all }),
      qc.invalidateQueries({ queryKey: queryKeys.catalog.all }),
      invalidateStoreAggregates(qc),
    ]);
}

/** Biblioteca (solo con sesión de personal; la API decide 401/403). */
export function useMediaLibrary(filters: MediaFilters = {}, enabled = true) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.media.library(filters),
    queryFn: () => listMedia(client, filters),
    enabled: enabled && Boolean(staff),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

export function useDeleteMedia() {
  const client = useDataClient();
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationFn: (id: string) => deleteMedia(client, id),
    onSuccess: invalidate,
  });
}

export function useAttachProductMedia(productId: string) {
  const client = useDataClient();
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationFn: (input: { assetId: string; altText?: string | null }) =>
      attachProductMedia(client, productId, input),
    onSuccess: invalidate,
  });
}

export function useUpdateProductMedia(productId: string) {
  const client = useDataClient();
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationFn: ({ mediaId, altText }: { mediaId: string; altText: string | null }) =>
      updateProductMedia(client, productId, mediaId, altText),
    onSuccess: invalidate,
  });
}

export function useReorderProductMedia(productId: string) {
  const client = useDataClient();
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationFn: (orderedIds: string[]) => reorderProductMedia(client, productId, orderedIds),
    onSuccess: invalidate,
  });
}

export function useDetachProductMedia(productId: string) {
  const client = useDataClient();
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationFn: (mediaId: string) => detachProductMedia(client, productId, mediaId),
    onSuccess: invalidate,
  });
}
