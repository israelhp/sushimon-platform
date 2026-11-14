import { hmToMin, mergeIntervals, minToHm } from '@/lib/branch-hours';
import type {
  BranchHoursDay,
  BranchHoursInterval,
  OrderSchedule,
  PublicClosureWindow,
  StoreConfig,
} from '@/lib/data-access/models';
import { addDaysISO, fromLocal, isoWeekdayOf, localDate, localMinutes } from '@/lib/time';

/**
 * Reglas de programación de pedidos de la tienda (pasos de 30 min, último pedido 30 min antes del cierre, 45 min de
 * anticipación mínima, 7 días): borrador F19/F20, aún mock. Pura: recibe la hora (`serverTime`) y el horario REAL de la
 * sucursal (F08: `PublicBranchHours.days`, ISO 1–7, varios intervalos) y, opcionalmente, sus cierres próximos.
 * Solo ofrece horarios; QUIEN decide si un pedido se acepta es el servidor (F20) con `BranchAvailabilityPort`.
 * «Abierta ahora» NO se calcula aquí: se consume de `getBranchAvailability`.
 */
export type ScheduleRules = StoreConfig['schedule'];

/** Intervalos del día de una fecha de calendario (contiguos fusionados). */
export function intervalsForDate(
  days: readonly BranchHoursDay[],
  dateISO: string,
): BranchHoursInterval[] {
  const day = days.find((d) => d.weekday === isoWeekdayOf(dateISO));
  return mergeIntervals(day?.intervals ?? []);
}

const inClosure = (dateISO: string, hm: string, closures: readonly PublicClosureWindow[]) => {
  const at = fromLocal(dateISO, hm).getTime();
  return closures.some(
    (c) => new Date(c.startsAt).getTime() <= at && at < new Date(c.endsAt).getTime(),
  );
};

/** Horarios `HH:mm` disponibles para una fecha local. */
export function slotsFor(
  rules: ScheduleRules,
  days: readonly BranchHoursDay[],
  dateISO: string,
  now: Date,
  closures: readonly PublicClosureWindow[] = [],
): string[] {
  const today = localDate(now);
  if (dateISO < today) return [];
  const earliest =
    dateISO === today
      ? Math.ceil((localMinutes(now) + rules.minLeadMinutes) / rules.stepMinutes) *
        rules.stepMinutes
      : 0;
  const out: string[] = [];
  for (const interval of intervalsForDate(days, dateISO)) {
    const end = hmToMin(interval.closesAt) - rules.lastOrderBeforeClose;
    for (let m = Math.max(hmToMin(interval.opensAt), earliest); m <= end; m += rules.stepMinutes) {
      if (m < 1440) out.push(minToHm(m));
    }
  }
  return [...new Set(out)].filter((hm) => !inClosure(dateISO, hm, closures)).sort();
}

/** Fechas (`YYYY-MM-DD`) con al menos un horario disponible, empezando hoy. */
export function availableDates(
  rules: ScheduleRules,
  days: readonly BranchHoursDay[],
  now: Date,
  closures: readonly PublicClosureWindow[] = [],
): string[] {
  const today = localDate(now);
  const out: string[] = [];
  for (let i = 0; i < rules.days; i++) {
    const date = addDaysISO(today, i);
    if (slotsFor(rules, days, date, now, closures).length > 0) out.push(date);
  }
  return out;
}

export function isScheduleValid(
  rules: ScheduleRules,
  days: readonly BranchHoursDay[],
  schedule: OrderSchedule,
  now: Date,
  closures: readonly PublicClosureWindow[] = [],
): boolean {
  if (schedule.kind === 'now') return true;
  if (!schedule.date || !schedule.time) return false;
  if (!availableDates(rules, days, now, closures).includes(schedule.date)) return false;
  return slotsFor(rules, days, schedule.date, now, closures).includes(schedule.time);
}
