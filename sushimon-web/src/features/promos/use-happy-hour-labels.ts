'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { Promotion } from '@/lib/data-access/models';
import { formatClock, formatDate } from '@/lib/format';
import { daysLabel, hoursLabel, shortHoursLabel, type HappyHourPhase } from './happy-hour';

/** Textos del Happy Hour (días, horas y estado) en el idioma activo, derivados de la promoción. */
export function useHappyHourLabels(promotion: Promotion | undefined, phase: HappyHourPhase | null) {
  const t = useTranslations('promos');
  const locale = useLocale();
  if (!promotion) return null;
  const range = (a: string, b: string) => t('daysRange', { a, b });
  const days = daysLabel(promotion.daysOfWeek, locale, 'long', range);
  const hours = hoursLabel(promotion.startTime, promotion.endTime, locale);
  const dateText = (iso: string) =>
    formatDate(`${iso}T12:00:00-06:00`, locale, { day: 'numeric', month: 'long' });

  let status: string | null = null;
  if (phase) {
    switch (phase.kind) {
      case 'live':
        status = t('statusLive', { a: formatClock(phase.endsAt, locale) });
        break;
      case 'today':
        status = t('statusToday', { a: formatClock(phase.startsAt, locale) });
        break;
      case 'upcoming':
        status = t('statusUpcoming', {
          a: formatDate(`${phase.date}T12:00:00-06:00`, locale, { weekday: 'long' }),
          b: formatClock(phase.startsAt, locale),
        });
        break;
      case 'scheduled':
        status = t('statusScheduled', { a: dateText(phase.date) });
        break;
      case 'expired':
        status = t('statusExpired', { a: dateText(phase.on) });
        break;
      case 'inactive':
        status = t('statusInactive');
        break;
    }
  }
  return {
    days,
    hours,
    /** "Lunes a jueves · 3:00 p. m. – 6:00 p. m. · Solo en restaurante". */
    longLine: t('longLine', { a: days, b: hours }),
    /** "Lun–Jue · 3:00–6:00 p. m." */
    shortLine: `${daysLabel(promotion.daysOfWeek, locale, 'short', range)} · ${shortHoursLabel(promotion.startTime, promotion.endTime, locale)}`,
    status,
  };
}
