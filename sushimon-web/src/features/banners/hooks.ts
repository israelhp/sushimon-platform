'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/data-access/errors';
import type { UpdateBannerRequest } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { isBannerExpiredByDate, moveId, sanitizeReason } from '@/lib/banner-rules';
import {
  createAdminBanner,
  getAdminBanner,
  listAdminBanners,
  listAllAdminBanners,
  reorderAdminBanners,
  updateAdminBanner,
  updateAdminBannerStatus,
  type AdminBannerFilters,
  type CreateBannerInput,
} from '@/services/banners';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { invalidateStoreAggregates } from '../store/invalidate';

/**
 * F16 — Hooks de banners del backoffice: solo con sesión de personal (la API decide 401/403/404); toda mutación invalida los banners
 * admin, los agregados públicos (F17: el Inicio recibe los banners dentro del bootstrap; la caché compartida tarda ≤ 15 s) y la
 * biblioteca de medios (conteo de usos). La lectura pública del carrusel pasó a `useStoreBootstrap` (`features/store/hooks.ts`).
 */

export function useAdminBanners(filters: AdminBannerFilters = {}) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.backoffice.bannerList(filters),
    queryFn: () => listAdminBanners(client, filters),
    enabled: Boolean(staff),
    placeholderData: keepPreviousData,
  });
}

/** Todos los banners en orden de prioridad (para saber el primero/último no vencido y reordenar). */
export function useAdminBannerOrder() {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.backoffice.bannerOrder,
    queryFn: () => listAllAdminBanners(client),
    enabled: Boolean(staff),
    placeholderData: keepPreviousData,
  });
}

/** Detalle (con `version` y ambas traducciones). `staleTime: 0`: el formulario parte siempre de la versión vigente. */
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

/** Tras CADA mutación: banners admin (listas, orden y detalle), públicos de TODAS las sucursales e idiomas, y la biblioteca. */
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

export function useSetBannerStatus() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, active, reason }: { id: string; active: boolean; reason?: string }) => {
      const clean = sanitizeReason(reason);
      return updateAdminBannerStatus(client, id, { active, ...(clean ? { reason: clean } : {}) });
    },
    onSuccess: invalidate,
  });
}

/**
 * Sube o baja UN banner dentro del orden global de los no vencidos. Lee el orden vigente justo antes de enviarlo (el PUT exige el
 * conjunto exacto) y devuelve `false` sin escribir si ya está en el borde. 422 `BANNER_REORDER_MISMATCH` => recargar y reintentar.
 */
export function useMoveBanner() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({
      id,
      direction,
      now,
    }: {
      id: string;
      direction: 'up' | 'down';
      /** Reloj del servidor (`useNow`): fija qué banners están vencidos por fecha. */
      now: Date;
    }) => {
      const all = await listAllAdminBanners(client);
      const ids = all.filter((b) => !isBannerExpiredByDate(b, now)).map((b) => b.id);
      const next = moveId(ids, id, direction);
      if (next.every((x, i) => x === ids[i])) return false;
      await reorderAdminBanners(client, next);
      return true;
    },
    onSuccess: invalidate,
  });
}
