'use client';

import { useMemo } from 'react';
import { usePromotions } from '@/features/catalog/hooks';
import { useStoreConfig } from '@/features/store/hooks';
import { happyHourPhase, pickHappyHour } from './happy-hour';

/**
 * Happy Hour de la tienda + su fase según el reloj de la demo (`StoreConfig.serverTime`).
 * `phase` es `null` hasta que cargan promociones y configuración.
 */
export function useHappyHour() {
  const promotions = usePromotions();
  const config = useStoreConfig();
  const promotion = promotions.data ? pickHappyHour(promotions.data) : undefined;
  const serverTime = config.data?.serverTime;
  const phase = useMemo(
    () => (promotion && serverTime ? happyHourPhase(promotion, new Date(serverTime)) : null),
    [promotion, serverTime],
  );
  return {
    promotion,
    phase,
    now: serverTime ? new Date(serverTime) : null,
    isPending: promotions.isPending || config.isPending,
    isError: promotions.isError,
    refetch: () => void promotions.refetch(),
  };
}
