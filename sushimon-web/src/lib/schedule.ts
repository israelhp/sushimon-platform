import type { BranchHours, OrderSchedule, StoreConfig } from '@/lib/data-access/models';
import {
  addDaysISO,
  dayOfWeekOf,
  hmToMinutes,
  localDate,
  localDayOfWeek,
  localMinutes,
  minutesToHM,
} from '@/lib/time';

/**
 * Reglas de programación de pedidos de la tienda (pasos de 30 min, último pedido 30 min antes del
 * cierre, 45 min de anticipación mínima, 7 días). Pura: recibe la hora (`serverTime`) y el horario.
 * La usan la UI (para ofrecer horarios) y el adaptador mock (para validar).
 */
export type ScheduleRules = StoreConfig['schedule'];

export function hoursForDate(hours: BranchHours[], dateISO: string): BranchHours | null {
  const h = hours.find((x) => x.day === dayOfWeekOf(dateISO));
  return h && !h.closed ? h : null;
}

/** Horarios `HH:mm` disponibles para una fecha local. */
export function slotsFor(
  rules: ScheduleRules,
  hours: BranchHours[],
  dateISO: string,
  now: Date,
): string[] {
  const h = hoursForDate(hours, dateISO);
  if (!h) return [];
  let start = hmToMinutes(h.open);
  const end = hmToMinutes(h.close) - rules.lastOrderBeforeClose;
  if (dateISO === localDate(now)) {
    const earliest = localMinutes(now) + rules.minLeadMinutes;
    start = Math.max(start, Math.ceil(earliest / rules.stepMinutes) * rules.stepMinutes);
  } else if (dateISO < localDate(now)) {
    return [];
  }
  const out: string[] = [];
  for (let m = start; m <= end; m += rules.stepMinutes) out.push(minutesToHM(m));
  return out;
}

/** Fechas (`YYYY-MM-DD`) con al menos un horario disponible, empezando hoy. */
export function availableDates(rules: ScheduleRules, hours: BranchHours[], now: Date): string[] {
  const today = localDate(now);
  const out: string[] = [];
  for (let i = 0; i < rules.days; i++) {
    const date = addDaysISO(today, i);
    if (slotsFor(rules, hours, date, now).length > 0) out.push(date);
  }
  return out;
}

/** ¿Está dentro del horario de atención en este momento? */
export function isWithinHours(hours: BranchHours[], now: Date): boolean {
  const h = hours.find((x) => x.day === localDayOfWeek(now));
  if (!h || h.closed) return false;
  const m = localMinutes(now);
  return m >= hmToMinutes(h.open) && m < hmToMinutes(h.close);
}

export function isScheduleValid(
  rules: ScheduleRules,
  hours: BranchHours[],
  schedule: OrderSchedule,
  now: Date,
): boolean {
  if (schedule.kind === 'now') return true;
  if (!schedule.date || !schedule.time) return false;
  if (!availableDates(rules, hours, now).includes(schedule.date)) return false;
  return slotsFor(rules, hours, schedule.date, now).includes(schedule.time);
}
