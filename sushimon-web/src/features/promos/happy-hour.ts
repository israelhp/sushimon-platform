import type { PromotionScheduleSlot, StorePromotion } from '@/lib/data-access/models';
import { formatClock, formatDate } from '@/lib/format';
import { addDaysISO, fromLocal, localDate, localTime } from '@/lib/time';

/**
 * Lógica PURA de presentación de promociones y Happy Hour de la tienda (F15). NO calcula vigencia ni precios: la API decide qué está
 * `live`/`upcoming`, cuándo termina (`nextEndsAt`) o vuelve (`nextStartsAt`) y los precios indicativos (`items`). Aquí solo se
 * agrupan tramos por día, se formatean instantes en hora de Guatemala y se ordena lo recibido. Días ISO (1 = lunes … 7 = domingo).
 */
export type HappyHourPhase =
  /** `endsAt` = fin del tramo actual (instante del servidor), `null` si no vino. */
  { kind: 'live'; endsAt: string | null } | { kind: 'upcoming'; startsAt: string };

/** Happy Hour a destacar: el vigente; si no, el que empieza antes. */
export function pickHappyHour(
  live: readonly StorePromotion[],
  upcoming: readonly StorePromotion[],
): StorePromotion | undefined {
  return (
    live.find((p) => p.isHappyHour) ??
    [...upcoming]
      .filter((p) => p.isHappyHour)
      .sort((a, b) => (a.nextStartsAt ?? '9999').localeCompare(b.nextStartsAt ?? '9999'))[0]
  );
}

/** Fase según lo que dijo el servidor (`state`, `nextEndsAt`, `nextStartsAt`); `null` si una próxima no trae fecha. */
export function happyHourPhase(p: StorePromotion): HappyHourPhase | null {
  if (p.state === 'live') return { kind: 'live', endsAt: p.nextEndsAt ?? null };
  return p.nextStartsAt ? { kind: 'upcoming', startsAt: p.nextStartsAt } : null;
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

/** Hora `HH:mm` o `24:00` (medianoche) → "3:00 p. m." / "12:00 a. m.". */
export const clockLabel = (hm: string, locale: string): string =>
  formatClock(hm === '24:00' ? '00:00' : hm, locale);

/** "3:00 p. m. – 6:00 p. m." */
export function hoursLabel(start: string, end: string, locale: string): string {
  return `${clockLabel(start, locale)} – ${clockLabel(end, locale)}`;
}

/** "3:00–6:00 p. m." (un solo sufijo si ambas horas son del mismo periodo). */
export function shortHoursLabel(start: string, end: string, locale: string): string {
  const a = clockLabel(start, locale);
  const b = clockLabel(end, locale);
  const [timeA = '', ...suffixA] = a.split(' ');
  const [, ...suffixB] = b.split(' ');
  return suffixA.join(' ') === suffixB.join(' ') ? `${timeA}–${b}` : `${a}–${b}`;
}

export interface ScheduleGroup {
  /** Días ISO con exactamente los mismos tramos, ascendentes. */
  days: number[];
  /** Tramos del día `[inicio, fin)` en hora local, ascendentes (los contiguos se fusionan: 22:00–24:00 + 00:00–02:00 no, son días distintos). */
  ranges: { startsAt: string; endsAt: string }[];
}

/**
 * Agrupa los días con los mismos tramos («Lunes a jueves · 3:00–6:00 p. m.»). Dentro de un día fusiona tramos contiguos.
 * Vacío = sin restricción semanal (todos los días y todo el día).
 */
export function groupSchedule(schedule: readonly PromotionScheduleSlot[]): ScheduleGroup[] {
  const byDay = new Map<number, { startsAt: string; endsAt: string }[]>();
  const sorted = [...schedule].sort(
    (a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt),
  );
  for (const s of sorted) {
    const list = byDay.get(s.weekday) ?? [];
    const prev = list[list.length - 1];
    if (prev && prev.endsAt === s.startsAt) prev.endsAt = s.endsAt;
    else list.push({ startsAt: s.startsAt, endsAt: s.endsAt });
    byDay.set(s.weekday, list);
  }
  const groups = new Map<string, ScheduleGroup>();
  for (const [day, ranges] of [...byDay].sort((a, b) => a[0] - b[0])) {
    const key = JSON.stringify(ranges);
    const group = groups.get(key);
    if (group) group.days.push(day);
    else groups.set(key, { days: [day], ranges });
  }
  return [...groups.values()];
}

/** Hora local `HH:mm` de un instante del servidor (zona de Guatemala). */
export const instantClock = (instant: string): string => localTime(new Date(instant));

/** ¿Son el mismo día local de Guatemala? */
export const sameLocalDay = (a: string, b: string): boolean =>
  localDate(new Date(a)) === localDate(new Date(b));

/** Fin de vigencia a mostrar: `validUntil` es EXCLUSIVO, así que el último día incluido es el del instante anterior. */
export const lastIncludedInstant = (validUntil: string): Date =>
  new Date(Date.parse(validUntil) - 60_000);

export interface ItemGroup<T> {
  category: string;
  items: T[];
}

/** Agrupa por categoría del producto conservando el orden de primera aparición. */
export function groupByCategory<T>(
  entries: readonly T[],
  categoryOf: (entry: T) => string,
): ItemGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = categoryOf(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups].map(([category, items]) => ({ category, items }));
}

/** `"25.00"` → `"25"`, `"12.50"` → `"12.5"` (solo para MOSTRAR el porcentaje que dio la API). */
export const percentText = (value: string): string =>
  value.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
