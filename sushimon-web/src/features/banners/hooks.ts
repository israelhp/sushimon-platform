'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isApiError } from '@/lib/data-access/errors';
import type { BannerLocale, StoreBannerList, UpdateBannerRequest } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import { isBannerExpiredByDate, moveId, sanitizeReason } from '@/lib/banner-rules';
import {
  createAdminBanner,
  getAdminBanner,
  listAdminBanners,
  listAllAdminBanners,
  listStoreBanners,
  reorderAdminBanners,
  updateAdminBanner,
  updateAdminBannerStatus,
  type AdminBannerFilters,
  type CreateBannerInput,
} from '@/services/banners';
import { msUntilNextChange } from '../promotions/hooks';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';

/**
 * F16 — Hooks de banners. Tienda: por sucursal e idioma, con refetch programado en `nextChangeAt` (medido con `generatedAt` del
 * SERVIDOR, no con el reloj del dispositivo) y al cambiar de sucursal o idioma (la clave los lleva). Backoffice: solo con sesión de
 * personal (la API decide 401/403/404); toda mutación invalida los banners admin y los públicos (aunque la caché pública tarde hasta
 * 30 s en el servidor) y la biblioteca de medios (conteo de usos).
 */

/** Ventana de obsolescencia de la lista pública (≤ la caché HTTP de 30 s de la API). */
export const STORE_BANNERS_STALE_MS = 15_000;

/** Vuelve a pedir la lista cuando llegue `nextChangeAt` (sin sondeo). Se reprograma con cada respuesta. */
function useRefetchAtNextChange(
  data: StoreBannerList | undefined,
  dataUpdatedAt: number,
  refetch: () => unknown,
): void {
  useEffect(() => {
    if (!data) return;
    const wait = msUntilNextChange(data, dataUpdatedAt, Date.now());
    if (wait === null) return;
    const timer = setTimeout(() => void refetch(), wait);
    return () => clearTimeout(timer);
  }, [data, dataUpdatedAt, refetch]);
}

/**
 * Banners publicados para la sucursal activa (`null` = sin sucursal: solo los de todas) y el idioma activo. Si la sucursal guardada
 * en el navegador ya no existe o está inactiva (404 `BRANCH_NOT_FOUND`) se reintenta SIN sucursal en vez de dejar el Inicio sin
 * carrusel. 4xx no se reintenta.
 */
export function useStoreBanners(branchId: string | null, locale: BannerLocale) {
  const client = useDataClient();
  const query = useQuery({
    queryKey: queryKeys.catalog.storeBanners(branchId, locale),
    queryFn: async () => {
      try {
        return await listStoreBanners(client, branchId, locale);
      } catch (error) {
        if (
          branchId !== null &&
          isApiError(error) &&
          error.status === 404 &&
          error.businessCode === 'BRANCH_NOT_FOUND'
        ) {
          return await listStoreBanners(client, null, locale);
        }
        throw error;
      }
    },
    staleTime: STORE_BANNERS_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 2,
  });
  useRefetchAtNextChange(query.data, query.dataUpdatedAt, query.refetch);
  return query;
}

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
