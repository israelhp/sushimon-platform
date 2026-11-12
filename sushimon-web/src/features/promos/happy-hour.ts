import type { HappyHourItem, Promotion } from '@/lib/data-access/models';
import { formatClock, formatDate } from '@/lib/format';
import {
  addDaysISO,
  fromLocal,
  hmToMinutes,
  localDate,
  localDayOfWeek,
  localMinutes,
} from '@/lib/time';

/**
 * Lógica pura del Happy Hour. Recibe la hora (`StoreConfig.serverTime`), nunca lee el reloj.
 * Días ISO (1 = lunes … 7 = domingo), como el contrato.
 */
export type HappyHourPhase =
  | { kind: 'live'; endsAt: string }
  | { kind: 'today'; startsAt: string }
  | { kind: 'upcoming'; date: string; startsAt: string }
  | { kind: 'scheduled'; date: string }
  | { kind: 'expired'; on: string }
  | { kind: 'inactive' };

/** Promoción que se presenta como "Happy Hour": la de la tienda, con ítems por grupos. */
export function pickHappyHour(promotions: readonly Promotion[]): Promotion | undefined {
  return (
    promotions.find((p) => p.id === 'happy-hour') ?? promotions.find((p) => p.items.length > 0)
  );
}

function isoDayOf(date: Date): number {
  const d = localDayOfWeek(date);
  return d === 0 ? 7 : d;
}

export function happyHourPhase(promotion: Promotion, now: Date): HappyHourPhase {
  if (promotion.status === 'expired') return { kind: 'expired', on: promotion.validTo };
  if (promotion.status === 'inactive' || !promotion.active) return { kind: 'inactive' };
  if (promotion.status === 'scheduled') return { kind: 'scheduled', date: promotion.validFrom };

  const minutes = localMinutes(now);
  const start = hmToMinutes(promotion.startTime);
  const end = hmToMinutes(promotion.endTime);
  if (promotion.daysOfWeek.includes(isoDayOf(now))) {
    if (minutes >= start && minutes < end) return { kind: 'live', endsAt: promotion.endTime };
    if (minutes < start) return { kind: 'today', startsAt: promotion.startTime };
  }
  const today = localDate(now);
  for (let i = 1; i <= 7; i++) {
    const date = addDaysISO(today, i);
    if (date > promotion.validTo) break;
    if (promotion.daysOfWeek.includes(isoDayOf(fromLocal(date, '12:00')))) {
      return { kind: 'upcoming', date, startsAt: promotion.startTime };
    }
  }
  return { kind: 'expired', on: promotion.validTo };
}

/** Un lunes cualquiera: sirve para obtener el nombre de un día ISO con `Intl`. */
const MONDAY = '2026-11-09';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function weekdayName(isoDay: number, locale: string, style: 'long' | 'short' = 'long') {
  return formatDate(fromLocal(addDaysISO(MONDAY, isoDay - 1), '12:00'), locale, {
    weekday: style,
  });
}

/** "Lunes a jueves" / "Monday to Thursday" (largo) o "Lun–Jue" / "Mon–Thu" (corto). */
export function daysLabel(
  days: readonly number[],
  locale: string,
  style: 'long' | 'short',
  rangeLong: (a: string, b: string) => string,
): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const name = (d: number) => weekdayName(d, locale, style);
  if (sorted.length >= 3 && last - first + 1 === sorted.length) {
    return capitalize(
      style === 'long'
        ? rangeLong(name(first), name(last))
        : `${capitalize(name(first))}–${capitalize(name(last))}`,
    );
  }
  const list = new Intl.ListFormat(locale === 'en' ? 'en-US' : 'es-GT', {
    style: style === 'long' ? 'long' : 'narrow',
    type: 'conjunction',
  }).format(sorted.map(name));
  return capitalize(list);
}

/** "3:00 p. m. – 6:00 p. m." */
export function hoursLabel(start: string, end: string, locale: string): string {
  return `${formatClock(start, locale)} – ${formatClock(end, locale)}`;
}

/** "3:00–6:00 p. m." (un solo sufijo si ambas horas son del mismo periodo). */
export function shortHoursLabel(start: string, end: string, locale: string): string {
  const a = formatClock(start, locale);
  const b = formatClock(end, locale);
  const [timeA = '', ...suffixA] = a.split(' ');
  const [, ...suffixB] = b.split(' ');
  return suffixA.join(' ') === suffixB.join(' ') ? `${timeA}–${b}` : `${a}–${b}`;
}

/** Grupos de la promoción en orden estable: los conocidos primero, luego los que aparezcan. */
export const HAPPY_HOUR_GROUP_ORDER = ['Entradas', 'Rolls', 'Cervezas'] as const;

export function groupHappyHourItems(
  items: readonly HappyHourItem[],
): { group: string; items: HappyHourItem[] }[] {
  const groups = [
    ...HAPPY_HOUR_GROUP_ORDER.filter((g) => items.some((i) => i.group === g)),
    ...new Set(
      items
        .map((i) => i.group)
        .filter((g) => !(HAPPY_HOUR_GROUP_ORDER as readonly string[]).includes(g)),
    ),
  ];
  return groups.map((group) => ({ group, items: items.filter((i) => i.group === group) }));
}
