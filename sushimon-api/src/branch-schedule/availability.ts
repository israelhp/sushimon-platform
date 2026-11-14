import {
  addDays,
  instantOf,
  isoWeekdayOf,
  memoizedOffsets,
  MS_PER_DAY,
  MS_PER_MINUTE,
  toLocal,
  type LocalDate,
  type OffsetResolver,
} from './business-time.js';

/**
 * Dominio puro de disponibilidad (F08, spec D3/D4/D9/D10). Sin I/O ni reloj: recibe el instante `at`.
 * Todos los instantes son ms UTC.
 */

export type AvailabilityReason =
  | 'OPEN'
  | 'INACTIVE'
  | 'OUTSIDE_BUSINESS_HOURS'
  | 'EXCEPTIONAL_CLOSURE'
  | 'SCHEDULE_NOT_CONFIGURED';

/** Intervalo semanal semiabierto `[opensMin, closesMin)` en minutos locales del día (`closesMin` hasta 1440). */
export interface WeeklyInterval {
  /** ISO 1 = lunes … 7 = domingo. */
  weekday: number;
  opensMin: number;
  closesMin: number;
}

/** Cierre excepcional `[startsAt, endsAt)` en ms UTC. */
export interface ClosureWindow {
  startsAt: number;
  endsAt: number;
}

export interface EvaluateInput {
  /** Estado administrativo de la sucursal. */
  active: boolean;
  intervals: readonly WeeklyInterval[];
  closures: readonly ClosureWindow[];
  at: number;
  timeZone: string;
  /** Punto de extensión (sin valor por defecto): minutos antes del cierre real en que se dejan de aceptar pedidos. */
  orderCutoffMinutes?: number;
}

export interface Evaluation {
  reason: AvailabilityReason;
  isOpenNow: boolean;
  isAcceptingOrders: boolean;
  nextOpensAt: number | null;
  nextClosesAt: number | null;
  nextTransitionAt: number | null;
}

/** Horizonte de transiciones: 14 × 24 h de reloj (D10). */
export const HORIZON_DAYS = 14;
export const HORIZON_MS = HORIZON_DAYS * MS_PER_DAY;

interface Span {
  start: number;
  end: number;
}

/** Ordena y fusiona tramos que se solapan o son contiguos (`a.end >= b.start`). */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** `open` menos `closures` (ambos ya fusionados y ordenados). */
function subtractSpans(open: Span[], closures: Span[]): Span[] {
  const out: Span[] = [];
  for (const o of open) {
    let cursor = o.start;
    for (const c of closures) {
      if (c.end <= cursor) continue;
      if (c.start >= o.end) break;
      if (c.start > cursor) out.push({ start: cursor, end: c.start });
      cursor = Math.max(cursor, c.end);
      if (cursor >= o.end) break;
    }
    if (cursor < o.end) out.push({ start: cursor, end: o.end });
  }
  return out;
}

/**
 * Tramos abiertos semanales (en instantes) para los días de calendario locales `[firstDay, firstDay + days)`.
 * Itera un número acotado de días (≤ 17) × intervalos por día; fusiona contiguos entre días (vie 24:00 + sáb
 * 00:00; la semana es cíclica: domingo 7 → lunes 1).
 */
function weeklySpans(
  intervals: readonly WeeklyInterval[],
  firstDay: LocalDate,
  days: number,
  timeZone: string,
  offsets: OffsetResolver,
): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(firstDay, i);
    const weekday = isoWeekdayOf(date);
    for (const iv of intervals) {
      if (iv.weekday !== weekday) continue;
      spans.push({
        start: instantOf(date, iv.opensMin, timeZone, offsets),
        end: instantOf(date, iv.closesMin, timeZone, offsets),
      });
    }
  }
  return mergeSpans(spans);
}

const contains = (s: Span, t: number): boolean => s.start <= t && t < s.end;

/** Evalúa la disponibilidad en `at`. Función pura y determinista (D9, D10). */
export function evaluateAvailability(input: EvaluateInput): Evaluation {
  const { at, timeZone } = input;
  const closed = (reason: AvailabilityReason): Evaluation => ({
    reason,
    isOpenNow: false,
    isAcceptingOrders: false,
    nextOpensAt: null,
    nextClosesAt: null,
    nextTransitionAt: null,
  });

  if (!input.active) return closed('INACTIVE');
  if (input.intervals.length === 0) return closed('SCHEDULE_NOT_CONFIGURED');

  // Ventana de cálculo: del día local anterior a `at` hasta 15 días después (cubre el horizonte de 14 × 24 h
  // aun con cambios de desfase). Número de días fijo => iteración acotada.
  const today = toLocal(at, timeZone);
  const firstDay = addDays(today, -1);
  const weekly = weeklySpans(input.intervals, firstDay, 17, timeZone, memoizedOffsets(timeZone));
  const closureSpans = mergeSpans(
    input.closures.map((c) => ({ start: c.startsAt, end: c.endsAt })),
  );
  const effective = mergeSpans(subtractSpans(weekly, closureSpans));

  const horizonEnd = at + HORIZON_MS;
  const inClosure = closureSpans.some((c) => contains(c, at));
  const inWeekly = weekly.some((s) => contains(s, at));

  let reason: AvailabilityReason;
  if (inClosure) reason = 'EXCEPTIONAL_CLOSURE';
  else if (!inWeekly) reason = 'OUTSIDE_BUSINESS_HOURS';
  else reason = 'OPEN';

  const isOpenNow = reason === 'OPEN';
  let nextOpensAt: number | null = null;
  let nextClosesAt: number | null = null;
  if (isOpenNow) {
    const current = effective.find((s) => contains(s, at));
    if (current && current.end <= horizonEnd) nextClosesAt = current.end;
  } else {
    const upcoming = effective.find((s) => s.start > at);
    if (upcoming && upcoming.start <= horizonEnd) nextOpensAt = upcoming.start;
  }

  const candidates = [nextOpensAt, nextClosesAt].filter((v): v is number => v !== null);
  const nextTransitionAt = candidates.length > 0 ? Math.min(...candidates) : null;

  let isAcceptingOrders = isOpenNow;
  const cutoff = input.orderCutoffMinutes;
  if (isAcceptingOrders && cutoff !== undefined && nextClosesAt !== null) {
    isAcceptingOrders = at < nextClosesAt - cutoff * MS_PER_MINUTE;
  }

  return { reason, isOpenNow, isAcceptingOrders, nextOpensAt, nextClosesAt, nextTransitionAt };
}
