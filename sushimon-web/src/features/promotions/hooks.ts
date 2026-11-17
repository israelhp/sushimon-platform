'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isApiError } from '@/lib/data-access/errors';
import type { UpdatePromotionRequest } from '@/lib/data-access/models';
import { useDataClient } from '@/lib/data-access/provider';
import {
  createAdminPromotion,
  getAdminPromotion,
  listAdminPromotions,
  listStorePromotions,
  updateAdminPromotion,
  updateAdminPromotionStatus,
  type AdminPromotionFilters,
  type CreatePromotionInput,
  type StorePromotionState,
} from '@/services/promotions';
import { queryKeys } from '../query-keys';
import { useDemoSession } from '../session/demo-session';
import { invalidateStoreAggregates } from '../store/invalidate';

/**
 * F15 — Hooks de promociones. Tienda: por sucursal y estado, con refetch programado en `nextChangeAt` y al cambiar de sucursal
 * (la clave lleva `branchId`). Backoffice: solo con sesión de personal (la API decide 401/403/404); toda mutación invalida las
 * promociones admin y las públicas (aunque la caché pública tarde hasta 30 s en el servidor).
 */

/** Ventana de obsolescencia de la lista pública (≤ la caché HTTP de 30 s de la API). */
export const STORE_PROMOTIONS_STALE_MS = 15_000;
/** `setTimeout` admite como máximo 2^31−1 ms. */
const MAX_TIMER_MS = 2_147_000_000;
/** Holgura tras `nextChangeAt` para que el servidor ya devuelva el nuevo estado. */
const REFETCH_SLACK_MS = 1_000;

/**
 * Milisegundos hasta `nextChangeAt` medidos con el RELOJ DEL SERVIDOR: `nextChangeAt − generatedAt` menos lo transcurrido desde que
 * llegó la respuesta (reloj local solo para el transcurso). Así un reloj del dispositivo desfasado no adelanta ni retrasa el refetch.
 * `null` si no hay próximo cambio.
 */
export function msUntilNextChange(
  list: { generatedAt?: string; nextChangeAt?: string | null },
  receivedAtMs: number,
  nowMs: number,
): number | null {
  if (!list.nextChangeAt || !list.generatedAt) return null;
  const serverGap = Date.parse(list.nextChangeAt) - Date.parse(list.generatedAt);
  const elapsed = Math.max(0, nowMs - receivedAtMs);
  if (Number.isNaN(serverGap)) return null;
  return Math.min(MAX_TIMER_MS, Math.max(0, serverGap - elapsed) + REFETCH_SLACK_MS);
}

/** Vuelve a pedir la lista cuando llegue `nextChangeAt` (sin sondeo). Se reprograma con cada respuesta. */
export function useRefetchAtNextChange(query: {
  data?: { generatedAt?: string; nextChangeAt?: string | null };
  dataUpdatedAt: number;
  refetch: () => unknown;
}): void {
  const { data, dataUpdatedAt, refetch } = query;
  useEffect(() => {
    if (!data) return;
    const wait = msUntilNextChange(data, dataUpdatedAt, Date.now());
    if (wait === null) return;
    const timer = setTimeout(() => void refetch(), wait);
    return () => clearTimeout(timer);
  }, [data, dataUpdatedAt, refetch]);
}

/** Promociones de la sucursal (`null` = ninguna: no consulta). 4xx no se reintenta. */
export function useStorePromotions(
  branchId: string | null,
  state: StorePromotionState = 'live',
  /** F17: sin `items` ni `productIds` (el servidor no lee productos): para el banner de Happy Hour del menú. */
  options: { compact?: boolean } = {},
) {
  const compact = options.compact === true;
  const client = useDataClient();
  const query = useQuery({
    queryKey: queryKeys.catalog.storePromotions(branchId ?? '', state, compact),
    queryFn: () => listStorePromotions(client, branchId as string, state, { compact }),
    enabled: Boolean(branchId),
    staleTime: STORE_PROMOTIONS_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 2,
  });
  useRefetchAtNextChange(query);
  return query;
}

export function useAdminPromotions(filters: AdminPromotionFilters = {}) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.backoffice.promotionList(filters),
    queryFn: () => listAdminPromotions(client, filters),
    enabled: Boolean(staff),
    placeholderData: keepPreviousData,
  });
}

/** Detalle (con `version`, tramos y productos). `staleTime: 0`: el formulario parte siempre de la versión vigente. */
export function useAdminPromotion(id: string | null) {
  const client = useDataClient();
  const { staff } = useDemoSession();
  return useQuery({
    queryKey: queryKeys.backoffice.promotion(id ?? ''),
    queryFn: () => getAdminPromotion(client, id as string),
    enabled: Boolean(staff) && Boolean(id),
    staleTime: 0,
    retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 2,
  });
}

/** Tras CADA mutación: promociones admin (listas y detalle) y públicas de TODAS las sucursales. Se espera el refetch. */
function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.backoffice.promotions }),
      qc.invalidateQueries({ queryKey: queryKeys.catalog.promotions }),
      invalidateStoreAggregates(qc),
    ]);
}

export function useCreatePromotion() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreatePromotionInput) => createAdminPromotion(client, input),
    onSuccess: invalidate,
  });
}

export function useUpdatePromotion() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePromotionRequest }) =>
      updateAdminPromotion(client, id, input),
    onSuccess: invalidate,
  });
}

export function useSetPromotionStatus() {
  const client = useDataClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, active, reason }: { id: string; active: boolean; reason?: string }) =>
      updateAdminPromotionStatus(client, id, { active, ...(reason ? { reason } : {}) }),
    onSuccess: invalidate,
  });
}
