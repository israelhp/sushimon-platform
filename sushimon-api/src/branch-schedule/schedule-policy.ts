import { createHash } from 'node:crypto';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { AuditValues } from '../audit/audit.service.js';
import { codedException, type ErrorViolation } from '../common/errors/coded-exception.js';
import type { WeeklyInterval } from './availability.js';
import { MINUTES_PER_DAY, parseClock } from './business-time.js';

/** Reglas puras del horario semanal (spec F08 D1/D3/D4/D5/D6): sin I/O. */

export const MAX_INTERVALS_PER_DAY = 6;
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface HoursInterval {
  opensAt: string; // HH:mm
  closesAt: string; // HH:mm | 24:00
}

export interface HoursDay {
  weekday: number;
  intervals: HoursInterval[];
}

/** Forma recibida (ya validada por DTO: tipos, patrón HH:mm, 7 días, ≤ 6 intervalos). */
export interface HoursDayInput {
  weekday: number;
  intervals: HoursInterval[];
}

const bad = (message: string): never => {
  throw new BadRequestException([message]);
};

const minutes = (value: string): number => parseClock(value) ?? -1;

/**
 * Normaliza la semana recibida. 400: forma (weekday repetido o faltante, formato). 422 `SCHEDULE_INVALID` con
 * `violations` (`path` con índices del arreglo RECIBIDO): `INTERVAL_RANGE_INVALID` (`opensAt >= closesAt`; no hay
 * cruce de medianoche) e `INTERVAL_OVERLAP`. Los intervalos contiguos son válidos. Devuelve 7 días ordenados.
 */
export function normalizeHours(days: readonly HoursDayInput[]): HoursDay[] {
  const seen = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d.weekday) || d.weekday < 1 || d.weekday > 7)
      bad('weekday debe estar entre 1 (lunes) y 7 (domingo)');
    if (seen.has(d.weekday)) bad(`weekday ${d.weekday} está repetido`);
    seen.add(d.weekday);
    if (d.intervals.length > MAX_INTERVALS_PER_DAY)
      bad(`máximo ${MAX_INTERVALS_PER_DAY} intervalos por día`);
    for (const iv of d.intervals) {
      if (parseClock(iv.opensAt) === null || parseClock(iv.closesAt) === null)
        bad('opensAt/closesAt deben tener formato HH:mm (closesAt admite 24:00)');
    }
  }
  if (seen.size !== 7) bad('days debe incluir exactamente los 7 weekday (1..7), una vez cada uno');

  const violations: ErrorViolation[] = [];
  days.forEach((day, i) => {
    const valid: { index: number; opens: number; closes: number; iv: HoursInterval }[] = [];
    day.intervals.forEach((iv, j) => {
      const [opens, closes] = [minutes(iv.opensAt), minutes(iv.closesAt)];
      if (opens >= MINUTES_PER_DAY || opens >= closes) {
        violations.push({
          path: `days[${i}].intervals[${j}]`,
          code: 'INTERVAL_RANGE_INVALID',
          message:
            'opensAt debe ser menor que closesAt; para cruzar la medianoche divide el turno en dos días',
        });
        return;
      }
      valid.push({ index: j, opens, closes, iv });
    });
    valid.sort((a, b) => a.opens - b.opens || a.index - b.index);
    let reach: (typeof valid)[number] | undefined;
    for (const cur of valid) {
      if (reach && cur.opens < reach.closes) {
        violations.push({
          path: `days[${i}].intervals[${cur.index}]`,
          code: 'INTERVAL_OVERLAP',
          message: `Se solapa con days[${i}].intervals[${reach.index}] (${reach.iv.opensAt}-${reach.iv.closesAt})`,
        });
      }
      if (!reach || cur.closes > reach.closes) reach = cur;
    }
  });
  if (violations.length > 0) {
    throw codedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SCHEDULE_INVALID',
      'Horario inválido',
      violations,
    );
  }

  return [...days]
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({
      weekday: d.weekday,
      intervals: d.intervals
        .map((iv) => ({ opensAt: iv.opensAt, closesAt: iv.closesAt }))
        .sort((a, b) => minutes(a.opensAt) - minutes(b.opensAt)),
    }));
}

/** Filas `(weekday, HH:mm, HH:mm)` -> siempre 7 días ordenados, intervalos ordenados por `opensAt`. */
export function rowsToDays(
  rows: readonly { weekday: number; opensAt: string; closesAt: string }[],
): HoursDay[] {
  return WEEKDAYS.map((weekday) => ({
    weekday,
    intervals: rows
      .filter((r) => r.weekday === weekday)
      .map((r) => ({ opensAt: r.opensAt, closesAt: r.closesAt }))
      .sort((a, b) => minutes(a.opensAt) - minutes(b.opensAt)),
  }));
}

/**
 * Versión de concurrencia optimista: SHA-256 hex de `weekday|opensAt|closesAt` por intervalo (orden `weekday`,
 * `opensAt`) unidos con `\n`; `24:00` sin normalizar; semana vacía = SHA-256 de la cadena vacía.
 */
export function hoursVersion(days: readonly HoursDay[]): string {
  const lines: string[] = [];
  for (const d of [...days].sort((a, b) => a.weekday - b.weekday)) {
    for (const iv of [...d.intervals].sort((a, b) => minutes(a.opensAt) - minutes(b.opensAt))) {
      lines.push(`${d.weekday}|${iv.opensAt}|${iv.closesAt}`);
    }
  }
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export const hasAnyInterval = (days: readonly HoursDay[]): boolean =>
  days.some((d) => d.intervals.length > 0);

/** Intervalos semanales en minutos para el motor de disponibilidad. */
export function toWeeklyIntervals(days: readonly HoursDay[]): WeeklyInterval[] {
  return days.flatMap((d) =>
    d.intervals.map((iv) => ({
      weekday: d.weekday,
      opensMin: minutes(iv.opensAt),
      closesMin: minutes(iv.closesAt),
    })),
  );
}

const describeDay = (d: HoursDay): string =>
  d.intervals.map((iv) => `${iv.opensAt}-${iv.closesAt}`).join(',');

/**
 * Diff real entre dos semanas: solo los días que cambian, como `weekday_N` -> `HH:mm-HH:mm,…` (cadena vacía =
 * sin atención). `null` si no hay cambios. La versión vigente y la nueva se agregan para trazabilidad.
 */
export function diffHours(
  before: readonly HoursDay[],
  after: readonly HoursDay[],
): { oldValues: AuditValues; newValues: AuditValues } | null {
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  for (const weekday of WEEKDAYS) {
    const b = before.find((d) => d.weekday === weekday) ?? { weekday, intervals: [] };
    const a = after.find((d) => d.weekday === weekday) ?? { weekday, intervals: [] };
    if (describeDay(b) !== describeDay(a)) {
      oldValues[`weekday_${weekday}`] = describeDay(b);
      newValues[`weekday_${weekday}`] = describeDay(a);
    }
  }
  if (Object.keys(newValues).length === 0) return null;
  oldValues['version'] = hoursVersion(before);
  newValues['version'] = hoursVersion(after);
  return { oldValues, newValues };
}
