'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { StorePromotion } from '@/lib/data-access/models';
import { formatDate } from '@/lib/format';
import {
  clockLabel,
  daysLabel,
  groupSchedule,
  hoursLabel,
  instantClock,
  sameLocalDay,
  shortHoursLabel,
  type HappyHourPhase,
} from './happy-hour';

/**
 * Textos del Happy Hour (días, horas y estado) en el idioma activo, derivados de los tramos y de los instantes que dio la API.
 * `generatedAt` (hora del servidor) decide «hoy» vs. otro día; nunca el reloj del dispositivo.
 */
export function useHappyHourLabels(
  promotion: Pick<StorePromotion, 'schedule' | 'dineInOnly'> | undefined,
  phase: HappyHourPhase | null,
  generatedAt: string | null,
) {
  const t = useTranslations('promos');
  const locale = useLocale();
  if (!promotion) return null;
  const range = (a: string, b: string) => t('daysRange', { a, b });
  const groups = groupSchedule(promotion.schedule);
  const allWeek = groups.length === 0;
  const lines = allWeek
    ? [
        {
          days: t('everyDay'),
          hours: t('allDay'),
          shortHours: t('allDay'),
          shortDays: t('everyDay'),
        },
      ]
    : groups.flatMap((g) => {
        const days = daysLabel(g.days, locale, 'long', range);
        const shortDays = daysLabel(g.days, locale, 'short', range);
        return [
          {
            days,
            shortDays,
            hours: g.ranges.map((r) => hoursLabel(r.startsAt, r.endsAt, locale)).join(' · '),
            shortHours: g.ranges
              .map((r) => shortHoursLabel(r.startsAt, r.endsAt, locale))
              .join(' · '),
          },
        ];
      });

  let status: string | null = null;
  if (phase?.kind === 'live') {
    status = phase.endsAt
      ? t('statusLive', { a: clockLabel(instantClock(phase.endsAt), locale) })
      : t('statusLiveNoEnd');
  } else if (phase?.kind === 'upcoming') {
    const time = clockLabel(instantClock(phase.startsAt), locale);
    status =
      generatedAt && sameLocalDay(generatedAt, phase.startsAt)
        ? t('statusToday', { a: time })
        : t('statusUpcoming', {
            a: formatDate(phase.startsAt, locale, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            }),
            b: time,
          });
  }
  const dine = promotion.dineInOnly ? ` · ${t('onlyDineIn')}` : '';
  return {
    lines,
    /** "Lunes a jueves · 3:00 p. m. – 6:00 p. m. · Solo en restaurante". */
    longLine: lines.map((l) => `${l.days} · ${l.hours}`).join(' | ') + dine,
    /** "Lun–Jue · 3:00–6:00 p. m." */
    shortLine: lines.map((l) => `${l.shortDays} · ${l.shortHours}`).join(' | '),
    status,
  };
}
