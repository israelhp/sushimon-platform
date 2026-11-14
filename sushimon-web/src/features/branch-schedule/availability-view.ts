import type { PillTone } from '@/components/ui/Pill';
import type { BranchAvailability } from '@/lib/data-access/models';
import { addDaysISO, localDate, localIsoWeekday, localTime, type IsoWeekday } from '@/lib/time';

/**
 * Presentación de la disponibilidad que devuelve el SERVIDOR (F08). Puro: no decide si la sucursal está abierta; solo
 * traduce `reason`/`nextOpensAt`… a una categoría visual y a un día relativo (hoy / mañana / día de la semana) en la hora
 * de Guatemala, comparando contra `serverTime` (nunca contra el reloj del dispositivo).
 */
export type StatusKind = 'open' | 'closed' | 'closure' | 'notConfigured';

export function statusKind(a: Pick<BranchAvailability, 'reason'>): StatusKind {
  switch (a.reason) {
    case 'OPEN':
      return 'open';
    case 'EXCEPTIONAL_CLOSURE':
      return 'closure';
    case 'SCHEDULE_NOT_CONFIGURED':
      return 'notConfigured';
    default:
      return 'closed';
  }
}

export const STATUS_TONE: Record<StatusKind, PillTone> = {
  open: 'success',
  closed: 'muted',
  closure: 'warning',
  notConfigured: 'muted',
};

export type RelativeDay =
  { kind: 'today' } | { kind: 'tomorrow' } | { kind: 'weekday'; weekday: IsoWeekday };

/** Día (hora de Guatemala) de `instantISO` respecto del día de `serverTimeISO`. */
export function relativeDay(instantISO: string, serverTimeISO: string): RelativeDay {
  const day = localDate(new Date(instantISO));
  const today = localDate(new Date(serverTimeISO));
  if (day === today) return { kind: 'today' };
  if (day === addDaysISO(today, 1)) return { kind: 'tomorrow' };
  return { kind: 'weekday', weekday: localIsoWeekday(new Date(instantISO)) };
}

/** Hora local `HH:mm` (Guatemala) de un instante. */
export const clockOf = (instantISO: string): string => localTime(new Date(instantISO));

/** ¿La sucursal NO recibe pedidos ahora según el servidor? `undefined` mientras no hay datos (no se asume cerrada). */
export const isNotAccepting = (a: BranchAvailability | undefined): boolean | undefined =>
  a ? !a.isAcceptingOrders : undefined;
