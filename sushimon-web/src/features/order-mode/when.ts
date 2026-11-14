import type { BranchHoursDay, OrderSchedule, PublicClosureWindow } from '@/lib/data-access/models';
import { formatClock, toIntlLocale } from '@/lib/format';
import { availableDates, slotsFor, type ScheduleRules } from '@/lib/schedule';
import { addDaysISO, localDate } from '@/lib/time';

/**
 * Etiquetas de "cuándo" del pedido (Hoy / Mañana / día de la semana + hora) con el formato del prototipo.
 * Puras: reciben la fecha local de hoy (de `StoreConfig.serverTime`), nunca leen el reloj.
 */
export interface WhenLabels {
  asap: string;
  today: string;
  tomorrow: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Formatea una fecha `YYYY-MM-DD` (calendario, sin zona horaria) con Intl. */
function formatCalendarDate(
  dateISO: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Intl.DateTimeFormat(toIntlLocale(locale), { ...options, timeZone: 'UTC' })
    .format(new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)))
    .replace(/\./g, '');
}

function dayLabel(dateISO: string, todayISO: string | null, locale: string, labels: WhenLabels) {
  if (todayISO && dateISO === todayISO) return labels.today;
  if (todayISO && dateISO === addDaysISO(todayISO, 1)) return labels.tomorrow;
  return cap(formatCalendarDate(dateISO, locale, { weekday: 'short' }));
}

/** "Lo antes posible" o "Hoy, 3:30 p. m." / "Jue 12 nov, 7:00 p. m.". */
export function formatWhen(
  when: OrderSchedule,
  todayISO: string | null,
  locale: string,
  labels: WhenLabels,
): string {
  if (when.kind === 'now' || !when.date || !when.time) return labels.asap;
  const day =
    todayISO && (when.date === todayISO || when.date === addDaysISO(todayISO, 1))
      ? dayLabel(when.date, todayISO, locale, labels)
      : cap(
          formatCalendarDate(when.date, locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
        );
  return `${day}, ${formatClock(when.time, locale)}`;
}

export interface DateOption {
  date: string;
  label: string;
  sub: string;
}

/** Días con horarios disponibles (hasta `rules.days`), con etiqueta y subtítulo ("Hoy" / "11 nov"). */
export function dateOptions(
  rules: ScheduleRules,
  hours: readonly BranchHoursDay[],
  now: Date,
  locale: string,
  labels: WhenLabels,
  closures: readonly PublicClosureWindow[] = [],
): DateOption[] {
  const today = localDate(now);
  return availableDates(rules, hours, now, closures).map((date) => ({
    date,
    label: dayLabel(date, today, locale, labels),
    sub: formatCalendarDate(date, locale, { day: 'numeric', month: 'short' }),
  }));
}

/** Primer horario disponible de un día (o null). */
export function firstSlot(
  rules: ScheduleRules,
  hours: readonly BranchHoursDay[],
  date: string,
  now: Date,
  closures: readonly PublicClosureWindow[] = [],
): string | null {
  return slotsFor(rules, hours, date, now, closures)[0] ?? null;
}
