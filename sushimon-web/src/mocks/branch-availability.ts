import type {
  BranchAvailability,
  BranchAvailabilityReason,
  BranchHoursDay,
} from '@/lib/data-access/models';
import { isWeekEmpty } from '@/lib/branch-hours';
import { addDaysISO, fromLocal, isoWeekdayOf, localDate, GT_TIMEZONE } from '@/lib/time';

/**
 * Motor de disponibilidad del MOCK (F08, spec 007 D9–D10): emula `BranchAvailabilityService` del servidor con el mismo
 * algoritmo de la spec. La tienda y el backoffice NO lo importan: consumen `getBranchAvailability` / `getBranchHours`.
 * Puro y determinista (recibe `at`; el reloj lo inyecta el handler).
 *
 * Orden de evaluación (la primera regla que aplica gana): inactiva → sin intervalos en la semana → dentro de un cierre
 * → fuera de horario → abierta. Intervalos y cierres son semiabiertos `[inicio, fin)`. Transiciones: tramos
 * contiguos (incluida la medianoche y dom → lun) y cierres contiguos se fusionan; horizonte 14 × 24 h; iteración
 * acotada (16 días calendario × 6 intervalos).
 */

export const HORIZON_MS = 14 * 24 * 3_600_000;
/** Días calendario a recorrer: ayer + 15 (cubre el horizonte y los tramos que cruzan medianoche). */
const SCAN_BEFORE = 1;
const SCAN_AFTER = 15;

export interface ClosureInstants {
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityInput {
  active: boolean;
  days: readonly BranchHoursDay[];
  closures: readonly ClosureInstants[];
  at: Date;
}

export type AvailabilityResult = Pick<
  BranchAvailability,
  'isOpenNow' | 'isAcceptingOrders' | 'reason' | 'nextOpensAt' | 'nextClosesAt' | 'nextTransitionAt'
>;

interface Span {
  start: number;
  end: number;
}

/** Une tramos solapados o contiguos (`b.start <= a.end`). */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Tramos abiertos semanales en instantes UTC alrededor de `at` (hora local de Guatemala; sin horario de verano). */
function weeklySpans(days: readonly BranchHoursDay[], at: Date): Span[] {
  const today = localDate(at);
  const spans: Span[] = [];
  for (let offset = -SCAN_BEFORE; offset <= SCAN_AFTER; offset++) {
    const date = addDaysISO(today, offset);
    const day = days.find((d) => d.weekday === isoWeekdayOf(date));
    for (const i of day?.intervals ?? []) {
      spans.push({
        start: fromLocal(date, i.opensAt).getTime(),
        end: fromLocal(date, i.closesAt).getTime(),
      });
    }
  }
  return merge(spans);
}

/** Resta los cierres de los tramos abiertos. */
function subtract(spans: Span[], closures: Span[]): Span[] {
  let current = spans;
  for (const c of closures) {
    const next: Span[] = [];
    for (const s of current) {
      if (c.end <= s.start || c.start >= s.end) {
        next.push(s);
        continue;
      }
      if (s.start < c.start) next.push({ start: s.start, end: c.start });
      if (c.end < s.end) next.push({ start: c.end, end: s.end });
    }
    current = next;
  }
  return current;
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function evaluateAvailability(input: AvailabilityInput): AvailabilityResult {
  const at = input.at.getTime();
  const result = (
    reason: BranchAvailabilityReason,
    nextOpens: number | null = null,
    nextCloses: number | null = null,
  ): AvailabilityResult => {
    const open = reason === 'OPEN';
    const candidates = [nextOpens, nextCloses].filter((v): v is number => v !== null);
    return {
      isOpenNow: open,
      isAcceptingOrders: open,
      reason,
      nextOpensAt: iso(nextOpens),
      nextClosesAt: iso(nextCloses),
      nextTransitionAt: iso(candidates.length ? Math.min(...candidates) : null),
    };
  };

  if (!input.active) return result('INACTIVE');
  if (isWeekEmpty(input.days)) return result('SCHEDULE_NOT_CONFIGURED');

  const closures = merge(
    input.closures.map((c) => ({
      start: new Date(c.startsAt).getTime(),
      end: new Date(c.endsAt).getTime(),
    })),
  );
  const open = subtract(weeklySpans(input.days, input.at), closures);
  const limit = at + HORIZON_MS;
  const inClosure = closures.some((c) => c.start <= at && at < c.end);
  const current = open.find((s) => s.start <= at && at < s.end);

  if (current && !inClosure) {
    return result('OPEN', null, current.end > at && current.end <= limit ? current.end : null);
  }
  const nextStart = open.find((s) => s.start > at && s.start <= limit)?.start ?? null;
  return result(inClosure ? 'EXCEPTIONAL_CLOSURE' : 'OUTSIDE_BUSINESS_HOURS', nextStart, null);
}

/** Zona informativa de las respuestas (constante de negocio, D2). */
export const AVAILABILITY_TIMEZONE = GT_TIMEZONE;
