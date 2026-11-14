'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { BranchAvailability } from '@/lib/data-access/models';
import { formatClock } from '@/lib/format';
import { clockOf, relativeDay, statusKind } from './availability-view';

/** Textos (es/en) de la disponibilidad que devuelve el servidor: estado, «cierra …», «abre …». */
export function useAvailabilityText() {
  const t = useTranslations('branchSchedule');
  const locale = useLocale();

  /** «hoy a las 10:00 p. m.», «mañana a las …», «el viernes a las …». */
  const when = (instant: string, serverTime: string): string => {
    const rel = relativeDay(instant, serverTime);
    const day =
      rel.kind === 'today'
        ? t('relative.today')
        : rel.kind === 'tomorrow'
          ? t('relative.tomorrow')
          : t(`weekdaysInline.${rel.weekday}`);
    return t('detail.when', { day, time: formatClock(clockOf(instant), locale) });
  };

  const label = (a: Pick<BranchAvailability, 'reason'>): string => t(`status.${statusKind(a)}`);

  /** Línea de detalle: próximo cierre o próxima apertura; null si no hay nada que decir. */
  const detail = (a: BranchAvailability): string | null => {
    const kind = statusKind(a);
    if (kind === 'open') {
      return a.nextClosesAt
        ? t('detail.closes', { when: when(a.nextClosesAt, a.serverTime) })
        : null;
    }
    if (kind === 'notConfigured') return t('detail.notConfigured');
    if (!a.nextOpensAt) return t('detail.noNextOpening');
    const key = kind === 'closure' ? 'detail.reopens' : 'detail.opens';
    return t(key, { when: when(a.nextOpensAt, a.serverTime) });
  };

  return { label, detail, when };
}
