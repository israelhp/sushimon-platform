'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import type { DraftOrder } from '@/lib/data-access/models';

/** Textos de presentación compartidos por Entregas y el modal Despachar (zona y dirección del envío). */
export function useDeliveryText() {
  const t = useTranslations('backoffice.deliveries');

  /** "Zona 4", o el municipio si no usa zonas (p. ej. "Mixco"); "Otra" si falta. */
  const zoneLabel = useCallback(
    (zoneNumber: string, municipality: string) =>
      zoneNumber
        ? t('filters.zoneName', { zone: zoneNumber })
        : municipality || t('table.otherZone'),
    [t],
  );

  /** Dirección de entrega en una línea ("4a Avenida 12-34 · Zona 4"). */
  const address = useCallback(
    (order: Pick<DraftOrder, 'address'>) => {
      const a = order.address;
      if (!a) return '—';
      const zone = a.zone ? t('filters.zoneName', { zone: a.zone }) : a.municipality;
      return zone ? `${a.line} · ${zone}` : a.line;
    },
    [t],
  );

  return useMemo(() => ({ zoneLabel, address }), [zoneLabel, address]);
}
