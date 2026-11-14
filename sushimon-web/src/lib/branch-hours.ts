import type { BranchHoursDay, BranchHoursInterval } from '@/lib/data-access/models';
import { formatClock } from '@/lib/format';
import { type IsoWeekday } from '@/lib/time';

/**
 * Horario semanal de una sucursal (F08, ADR-0011). Funciones puras, sin red ni reloj.
 *
 * Convención del contrato: `weekday` ISO 1 = lunes … 7 = domingo (NUNCA `Date#getDay`), horas locales `HH:mm` de
 * America/Guatemala, intervalos semiabiertos `[opensAt, closesAt)` con `opensAt < closesAt` estricto, `closesAt` puede
 * ser `24:00`, sin cruce de medianoche (se divide en dos días, D4) y máximo 6 intervalos por día (D6).
 *
 * `validateWeek` aplica los MISMOS criterios que el servidor (mock y editor lo comparten): forma inválida => 400
 * (`kind: 'shape'`), reglas de negocio => 422 `SCHEDULE_INVALID` (`kind: 'business'`).
 */

export const WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
export const MAX_INTERVALS_PER_DAY = 6;
export const MINUTES_PER_DAY = 1440;

const HM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** `HH:mm` válido (00:00–23:59) o `24:00` (solo tiene sentido como cierre). */
export const isValidHm = (value: unknown): value is string =>
  typeof value === 'string' && (HM_RE.test(value) || value === '24:00');

/** Minutos desde la medianoche (`24:00` = 1440). Asume `isValidHm`. */
export function hmToMin(value: string): number {
  const [h = 0, m = 0] = value.split(':').map(Number);
  return h * 60 + m;
}

export function minToHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const nextWeekday = (weekday: IsoWeekday): IsoWeekday => ((weekday % 7) + 1) as IsoWeekday;

export interface WeekIssue {
  /** Ruta 0-based del arreglo recibido (`days[i].intervals[j]`), igual que `ErrorViolation.path`. */
  path: string;
  code:
    | 'INTERVAL_FORMAT'
    | 'TOO_MANY_INTERVALS'
    | 'INTERVAL_RANGE_INVALID'
    | 'INTERVAL_OVERLAP'
    | 'DAY_INVALID';
  message: string;
  /** `shape` = 400; `business` = 422 `SCHEDULE_INVALID`. */
  kind: 'shape' | 'business';
}

export const RANGE_MESSAGE =
  'La hora de apertura debe ser menor que la de cierre; para cruzar la medianoche divide el turno en dos días.';

const label = (i: BranchHoursInterval) => `${i.opensAt}-${i.closesAt}`;

/**
 * Valida los 7 días tal como los recibiría `PUT /v1/admin/branches/{id}/hours`. Devuelve todos los problemas:
 * forma (formato HH:mm, máx. 6 intervalos, 7 días ISO distintos) y negocio (rango y solape `[a,b)`; contiguos OK).
 */
export function validateWeek(days: readonly BranchHoursDay[]): WeekIssue[] {
  const issues: WeekIssue[] = [];
  if (days.length !== 7) {
    issues.push({
      path: 'days',
      code: 'DAY_INVALID',
      message: 'Debes enviar los 7 días de la semana.',
      kind: 'shape',
    });
  }
  const seen = new Set<number>();
  days.forEach((day, i) => {
    const base = `days[${i}]`;
    if (!Number.isInteger(day.weekday) || day.weekday < 1 || day.weekday > 7) {
      issues.push({
        path: `${base}.weekday`,
        code: 'DAY_INVALID',
        message: 'El día debe ser 1 (lunes) a 7 (domingo).',
        kind: 'shape',
      });
    } else if (seen.has(day.weekday)) {
      issues.push({
        path: `${base}.weekday`,
        code: 'DAY_INVALID',
        message: 'El día está repetido.',
        kind: 'shape',
      });
    } else {
      seen.add(day.weekday);
    }
    if (day.intervals.length > MAX_INTERVALS_PER_DAY) {
      issues.push({
        path: `${base}.intervals`,
        code: 'TOO_MANY_INTERVALS',
        message: `Máximo ${MAX_INTERVALS_PER_DAY} intervalos por día.`,
        kind: 'shape',
      });
    }
    const wellFormed: number[] = [];
    day.intervals.forEach((interval, j) => {
      const path = `${base}.intervals[${j}]`;
      if (!isValidHm(interval.opensAt) || !isValidHm(interval.closesAt)) {
        issues.push({
          path,
          code: 'INTERVAL_FORMAT',
          message: 'Usa el formato HH:mm (00:00 a 23:59; el cierre admite 24:00).',
          kind: 'shape',
        });
        return;
      }
      if (hmToMin(interval.opensAt) >= hmToMin(interval.closesAt)) {
        issues.push({
          path,
          code: 'INTERVAL_RANGE_INVALID',
          message: RANGE_MESSAGE,
          kind: 'business',
        });
        return;
      }
      wellFormed.push(j);
    });
    // Solape entre pares válidos: [a,b) y [c,d) se solapan si a < d y c < b (contiguos no).
    for (let b = 0; b < wellFormed.length; b++) {
      const jb = wellFormed[b] as number;
      const later = day.intervals[jb] as BranchHoursInterval;
      for (let a = 0; a < b; a++) {
        const ja = wellFormed[a] as number;
        const earlier = day.intervals[ja] as BranchHoursInterval;
        if (
          hmToMin(earlier.opensAt) < hmToMin(later.closesAt) &&
          hmToMin(later.opensAt) < hmToMin(earlier.closesAt)
        ) {
          issues.push({
            path: `${base}.intervals[${jb}]`,
            code: 'INTERVAL_OVERLAP',
            message: `Se solapa con ${base}.intervals[${ja}] (${label(earlier)})`,
            kind: 'business',
          });
          break;
        }
      }
    }
  });
  return issues;
}

/** Intervalos ordenados por `opensAt` (copia). */
export const sortIntervals = (intervals: readonly BranchHoursInterval[]): BranchHoursInterval[] =>
  [...intervals].sort(
    (a, b) => hmToMin(a.opensAt) - hmToMin(b.opensAt) || hmToMin(a.closesAt) - hmToMin(b.closesAt),
  );

/** 7 días `weekday` 1..7 ascendentes con intervalos ordenados (rellena los que falten con `[]`). */
export function normalizeWeek(days: readonly BranchHoursDay[]): BranchHoursDay[] {
  return WEEKDAYS.map((weekday) => ({
    weekday,
    intervals: sortIntervals(days.find((d) => d.weekday === weekday)?.intervals ?? []).map((i) => ({
      opensAt: i.opensAt,
      closesAt: i.closesAt,
    })),
  }));
}

export const emptyWeek = (): BranchHoursDay[] =>
  WEEKDAYS.map((weekday) => ({ weekday, intervals: [] }));

/** ¿Ningún intervalo en toda la semana? (la sucursal queda «sin horario configurado»). */
export const isWeekEmpty = (days: readonly BranchHoursDay[]): boolean =>
  days.every((d) => d.intervals.length === 0);

/** Igualdad semántica (orden de intervalos irrelevante). */
export function weeksEqual(a: readonly BranchHoursDay[], b: readonly BranchHoursDay[]): boolean {
  return JSON.stringify(normalizeWeek(a)) === JSON.stringify(normalizeWeek(b));
}

/** Fusiona intervalos contiguos o solapados de un día (solo para MOSTRAR; no se guarda así). */
export function mergeIntervals(intervals: readonly BranchHoursInterval[]): BranchHoursInterval[] {
  const out: BranchHoursInterval[] = [];
  for (const i of sortIntervals(intervals)) {
    const last = out[out.length - 1];
    if (last && hmToMin(i.opensAt) <= hmToMin(last.closesAt)) {
      if (hmToMin(i.closesAt) > hmToMin(last.closesAt)) last.closesAt = i.closesAt;
    } else {
      out.push({ opensAt: i.opensAt, closesAt: i.closesAt });
    }
  }
  return out;
}

export interface OvernightSplit {
  /** Intervalos a guardar: `[weekday: opensAt–24:00]` y `[siguiente día: 00:00–closesAt]`. */
  first: { weekday: IsoWeekday; interval: BranchHoursInterval };
  second: { weekday: IsoWeekday; interval: BranchHoursInterval };
}

/**
 * Atajo de presentación «pasa de medianoche» (D4, estrategia B): `viernes 18:00 → 02:00` se guarda como viernes
 * `18:00–24:00` + sábado `00:00–02:00`. Devuelve null si no cruza la medianoche (cierre > apertura, igual o `24:00`)
 * o si las horas no son válidas. Dom → lun es cíclico.
 */
export function splitOvernight(
  weekday: IsoWeekday,
  opensAt: string,
  closesAt: string,
): OvernightSplit | null {
  if (!isValidHm(opensAt) || !HM_RE.test(closesAt)) return null;
  const opens = hmToMin(opensAt);
  const closes = hmToMin(closesAt);
  if (closes >= opens || closes === 0) return null;
  return {
    first: { weekday, interval: { opensAt, closesAt: '24:00' } },
    second: { weekday: nextWeekday(weekday), interval: { opensAt: '00:00', closesAt } },
  };
}

/** `HH:mm` legible (es/en); `24:00` → «medianoche» no existe en `formatClock`, se muestra como 12:00 a. m. */
export const formatHm = (value: string, locale: string): string =>
  formatClock(value === '24:00' ? '00:00' : value, locale);

export const formatInterval = (i: BranchHoursInterval, locale: string): string =>
  `${formatHm(i.opensAt, locale)} – ${formatHm(i.closesAt, locale)}`;
