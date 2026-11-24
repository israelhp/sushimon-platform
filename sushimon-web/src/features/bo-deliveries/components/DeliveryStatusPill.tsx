'use client';

import { useTranslations } from 'next-intl';
import { Pill } from '@/components/ui/Pill';
import type { AdminDeliveryStatus } from '@/lib/data-access/models';
import { DELIVERY_STATUS_TONE, isKnownStatus } from '../delivery-model';

/** Estado de la entrega con texto SIEMPRE (nunca solo color). Tolera estados futuros del contrato. */
export function DeliveryStatusPill({ status }: { status: AdminDeliveryStatus | (string & {}) }) {
  const t = useTranslations('backoffice.deliveries.fleet.status');
  const known = isKnownStatus(status);
  return (
    <Pill zone="bo" tone={known ? DELIVERY_STATUS_TONE[status] : 'muted'}>
      {known ? t(status) : t('unknown')}
    </Pill>
  );
}
