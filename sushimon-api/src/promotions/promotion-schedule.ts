import {
  addDays,
  instantOf,
  isoWeekdayOf,
  memoizedOffsets,
  MS_PER_DAY,
  parseClock,
  toLocal,
  type LocalDateTime,
  type OffsetResolver,
} from '../branch-schedule/business-time.js';
import type { PromotionLifecycle, ScheduleSlot } from './promotions.types.js';

/**
 * Vigencia y horario de las promociones (spec F15 D6/D14). Módulo PURO: sin I/O ni reloj (recibe el instante) y
 * sin `Date#getDay()`: el día y la hora salen de `toLocal` (Intl con la zona del negocio).
 * - Vigencia `[startsAt, endsAt)` en instantes; tramo semanal `[startsAt, endsAt)` en hora local del día ISO.
 * - Tramos contiguos (`24:00` + `00:00` del día siguiente) se FUSIONAN solo para los próximos cambios.
 * - NO consulta el horario de apertura de la sucursal (F08).
 */

/** Horizonte de «próximas» y de `nextChangeAt` (como F08 D10). */
export const HORIZON_DAYS = 14;
export const HORIZON_MS = HORIZON_DAYS * MS_PER_DAY;

export interface TimedPromotion {
  startsAt: Date;
  endsAt: Date;
  active: boolean;
  schedule: readonly ScheduleSlot[];
}

interface MinuteSlot {
  weekday: number;
  start: number;
  end: number;
}

const toMinuteSlots = (schedule: readonly ScheduleSlot[]): MinuteSlot[] =>
  schedule.map((s) => {
    const start = parseClock(s.startsAt);
    const end = parseClock(s.endsAt);
    if (start === null || end === null) throw new Error('Tramo con hora inválida');
    return { weekday: s.weekday, start, end };
  });

/** Día ISO y minuto del día LOCALES de un instante: se calcula UNA vez por solicitud y se reutiliza en los bucles. */
export type LocalClock = Pick<LocalDateTime, 'weekday' | 'minuteOfDay'>;

export function localClockOf(atMs: number, timeZone: string): LocalClock {
  const { weekday, minuteOfDay } = toLocal(atMs, timeZone);
  return { weekday, minuteOfDay };
}

/** Como `isInSchedule` con el reloj local ya resuelto (sin llamar a Intl). */
export function isInScheduleLocal(schedule: readonly ScheduleSlot[], local: LocalClock): boolean {
  if (schedule.length === 0) return true;
  return toMinuteSlots(schedule).some(
    (s) => s.weekday === local.weekday && s.start <= local.minuteOfDay && local.minuteOfDay < s.end,
  );
}

/** ¿El instante cae en un tramo semanal (o no hay tramos)? Día y hora LOCALES del instante. */
export function isInSchedule(
  schedule: readonly ScheduleSlot[],
  atMs: number,
  timeZone: string,
): boolean {
  if (schedule.length === 0) return true;
  return isInScheduleLocal(schedule, localClockOf(atMs, timeZone));
}

/** Vigente: `active`, `startsAt <= t < endsAt` y en horario. */
export function isLive(p: TimedPromotion, atMs: number, timeZone: string): boolean {
  return (
    p.active &&
    p.startsAt.getTime() <= atMs &&
    atMs < p.endsAt.getTime() &&
    isInSchedule(p.schedule, atMs, timeZone)
  );
}

export function lifecycleOf(
  p: Pick<TimedPromotion, 'startsAt' | 'endsAt' | 'active'>,
  atMs: number,
): PromotionLifecycle {
  if (!p.active) return 'INACTIVE';
  if (atMs >= p.endsAt.getTime()) return 'EXPIRED';
  if (atMs < p.startsAt.getTime()) return 'SCHEDULED';
  return 'RUNNING';
}

export interface Period {
  start: number;
  end: number;
}

/**
 * Periodos de vigencia efectiva (fusionados y recortados por la vigencia) que se cruzan con la ventana
 * `[nowMs - 1 día, nowMs + horizonte + 1 día]`. Vacío si la promoción está inactiva.
 */
/** Datos compartidos por todas las promociones de una misma evaluación (mismo `now`). */
export interface SharedTiming {
  today: LocalDateTime;
  offsets: OffsetResolver;
}

export function sharedTimingOf(nowMs: number, timeZone: string): SharedTiming {
  return { today: toLocal(nowMs, timeZone), offsets: memoizedOffsets(timeZone) };
}

export function livePeriods(
  p: TimedPromotion,
  nowMs: number,
  timeZone: string,
  shared: SharedTiming = sharedTimingOf(nowMs, timeZone),
): Period[] {
  if (!p.active) return [];
  const from = p.startsAt.getTime();
  const to = p.endsAt.getTime();
  if (p.schedule.length === 0) return from < to ? [{ start: from, end: to }] : [];
  const slots = toMinuteSlots(p.schedule);
  const { offsets, today } = shared;
  const raw: Period[] = [];
  for (let k = -1; k <= HORIZON_DAYS + 1; k += 1) {
    const day = addDays({ year: today.year, month: today.month, day: today.day }, k);
    const weekday = isoWeekdayOf(day);
    for (const s of slots) {
      if (s.weekday !== weekday) continue;
      raw.push({
        start: instantOf(day, s.start, timeZone, offsets),
        end: instantOf(day, s.end, timeZone, offsets),
      });
    }
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Period[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const clipped: Period[] = [];
  for (const m of merged) {
    const start = Math.max(m.start, from);
    const end = Math.min(m.end, to);
    if (start < end) clipped.push({ start, end });
  }
  return clipped;
}

export interface PromotionTiming {
  live: boolean;
  /** Activa, no vigente y con un próximo inicio dentro del horizonte. */
  upcoming: boolean;
  /** Próximo instante en que pasa a regir (tras el periodo actual si está vigente). */
  nextStartsAt: number | null;
  /** Solo si está vigente: fin del periodo actual (tramos contiguos fusionados). */
  nextEndsAt: number | null;
  /** Primer instante futuro (en el horizonte) en que cambia su estado de vigencia. */
  nextChangeAt: number | null;
}

export function analyzeTiming(
  p: TimedPromotion,
  nowMs: number,
  timeZone: string,
  shared?: SharedTiming,
): PromotionTiming {
  const horizon = nowMs + HORIZON_MS;
  const periods = livePeriods(p, nowMs, timeZone, shared);
  const current = periods.find((x) => x.start <= nowMs && nowMs < x.end) ?? null;
  const nextStart = periods.find((x) => x.start > nowMs && x.start <= horizon) ?? null;
  const transitions: number[] = [];
  for (const x of periods) {
    if (x.start > nowMs && x.start <= horizon) transitions.push(x.start);
    if (x.end > nowMs && x.end <= horizon) transitions.push(x.end);
  }
  const live = current !== null;
  return {
    live,
    upcoming: p.active && !live && nextStart !== null,
    nextStartsAt: nextStart ? nextStart.start : null,
    nextEndsAt: current && current.end <= horizon ? current.end : null,
    nextChangeAt: transitions.length > 0 ? Math.min(...transitions) : null,
  };
}
