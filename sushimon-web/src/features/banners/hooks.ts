'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/data-access/errors';
import type { UpdateBannerRequest } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  createAdminBanner,
  deleteAdminBanner,
  getAdminBanner,
  listAdminBanners,
  updateAdminBanner,
  type CreateBannerInput,
} from '@/services/banners';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { invalidateStoreAggregates } from '../store/invalidate';

/**
 * F16 (simplificado) — Hooks de banners del backoffice: solo con sesión de personal (la API decide 401/403/404); toda mutación invalida
 * los banners admin, los agregados públicos (F17: el Inicio recibe los banners dentro del bootstrap; la caché compartida tarda ≤ 15 s)
 * y la biblioteca de medios (conteo de usos). La lectura pública del carrusel vive en `useStoreBootstrap` (`features/store/hooks.ts`).
 */

/** Todos los banners (máx. 5) en orden de creación. */
export function useAdminBanners() {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.backoffice.bannerList,
    queryFn: () => listAdminBanners(client),
    enabled: Boolean(staff),
  });
}

/** Detalle (con `version`). `staleTime: 0`: el formulario parte siempre de la versión vigente. */
export function useAdminBanner(id: string | null) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.backoffice.banner(id ?? ''),
    queryFn: () => getAdminBanner(client, id as string),
    enabled: Boolean(staff) && Boolean(id),
    staleTime: 0,
    retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 2,
  });
}

/** Tras CADA mutación: banners admin (lista y detalle), públicos, agregados de la tienda y la biblioteca. */
function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.backoffice.banners }),
      qc.invalidateQueries({ queryKey: queryKeys.catalog.banners }),
      invalidateStoreAggregates(qc),
      qc.invalidateQueries({ queryKey: queryKeys.media.all }),
    ]);
}

export function useCreateBanner() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateBannerInput) => createAdminBanner(client, input),
    onSuccess: invalidate,
  });
}

export function useUpdateBanner() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBannerRequest }) =>
      updateAdminBanner(client, id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteBanner() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion: number }) =>
      deleteAdminBanner(client, id, expectedVersion),
    onSuccess: invalidate,
  });
}
