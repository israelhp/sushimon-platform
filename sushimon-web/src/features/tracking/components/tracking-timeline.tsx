'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { OrderTracking } from '@/lib/data-access/models';
import { formatDateTime } from '@/lib/format';
import { phaseTextKey } from '../tracking-model';

/**
 * F21 (spec 022 §4, §9.4) — Línea de tiempo con los eventos REALES (`order_status_history`) en el ORDEN del servidor: no se
 * reordena, no se deduplica ni se «corrige» (un salto o un duplicado se muestran tal cual). La clave es `seq` (estable). Sin
 * motivo, sin responsable ni identificadores internos: el contrato no los envía.
 */
export function TrackingTimeline({
  events,
  truncated,
  fulfillmentType,
}: Pick<OrderTracking, 'events' | 'fulfillmentType'> & { truncated: boolean }) {
  const t = useTranslations('tracking');
  const locale = useLocale();
  if (!events || events.length === 0) {
    return (
      <p className="m-0 text-[14px] text-muted" data-testid="timeline-empty">
        {t('timelineEmpty')}
      </p>
    );
  }
  return (
    <>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label={t('timelineAria')}>
        {events.map((event) => (
          <li
            key={event.seq}
            className="flex items-baseline justify-between gap-3 border-b border-dashed border-line pb-2 last:border-b-0 last:pb-0"
            data-testid="timeline-event"
          >
            <span className="min-w-0 font-bold">
              {t(`phase.${phaseTextKey(event.publicStatus, fulfillmentType)}`)}
            </span>
            <time dateTime={event.occurredAt} className="flex-none text-[13px] text-muted">
              {formatDateTime(event.occurredAt, locale)}
            </time>
          </li>
        ))}
      </ol>
      {truncated ? <p className="m-0 mt-2 text-[13px] text-muted">{t('eventsTruncated')}</p> : null}
    </>
  );
}
