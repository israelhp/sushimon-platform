'use client';

import { useMemo } from 'react';
import { useOptionalOrderMode } from '@/features/order-mode/order-mode-context';
import { useStorePromotions } from '@/features/promotions/hooks';
import { happyHourPhase, pickHappyHour } from './happy-hour';

/**
 * Happy Hour de la sucursal elegida, tal como lo informa la API (`state`, `nextStartsAt`, `nextEndsAt`): la UI no recalcula la
 * vigencia. Sin sucursal elegida no consulta (no hay Happy Hour que mostrar). `phase` es `null` hasta que carga o si no hay.
 */
export function useHappyHour(branchId?: string | null) {
  const selected = useOptionalOrderMode()?.mode.branchId ?? null;
  const branch = branchId === undefined ? selected : branchId;
  const live = useStorePromotions(branch, 'live');
  const upcoming = useStorePromotions(branch, 'upcoming');
  const promotion = useMemo(
    () => pickHappyHour(live.data?.items ?? [], upcoming.data?.items ?? []),
    [live.data, upcoming.data],
  );
  const phase = useMemo(() => (promotion ? happyHourPhase(promotion) : null), [promotion]);
  const generatedAt =
    (promotion?.state === 'live' ? live.data : upcoming.data)?.generatedAt ?? null;
  return {
    promotion,
    phase,
    /** Hora del servidor de la respuesta que trajo la promoción. */
    generatedAt,
    isPending: Boolean(branch) && (live.isPending || upcoming.isPending),
    isError: live.isError || upcoming.isError,
    refetch: () => {
      void live.refetch();
      void upcoming.refetch();
    },
  };
}
