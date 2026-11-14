import type { BranchHoursDay, BranchHoursInterval } from '@/lib/data-access/models';
import { emptyWeek } from '@/lib/branch-hours';

/**
 * Horarios y cierres extraordinarios sembrados (F08, spec 007). Hora LOCAL de America/Guatemala, `weekday` ISO
 * 1 = lunes … 7 = domingo, intervalos semiabiertos, turnos nocturnos divididos en dos días (D4). Deterministas.
 * "Ahora" del mock = miércoles 2026-11-11 14:25 GT: las sucursales 1–3 están abiertas.
 */

const iv = (opensAt: string, closesAt: string): BranchHoursInterval => ({ opensAt, closesAt });
const week = (byDay: Record<number, BranchHoursInterval[]>): BranchHoursDay[] =>
  emptyWeek().map((d) => ({ weekday: d.weekday, intervals: byDay[d.weekday] ?? [] }));

export const BRANCH_HOURS_SEEDS: Record<string, BranchHoursDay[]> = {
  // Todos los días 12:00–22:00.
  'sucursal-1': week({
    1: [iv('12:00', '22:00')],
    2: [iv('12:00', '22:00')],
    3: [iv('12:00', '22:00')],
    4: [iv('12:00', '22:00')],
    5: [iv('12:00', '22:00')],
    6: [iv('12:00', '22:00')],
    7: [iv('12:00', '22:00')],
  }),
  // Fin de semana nocturno: viernes hasta 24:00 y sábado/domingo con tramo de madrugada (00:00–01:00).
  'sucursal-2': week({
    1: [iv('12:00', '23:00')],
    2: [iv('12:00', '23:00')],
    3: [iv('12:00', '23:00')],
    4: [iv('12:00', '23:00')],
    5: [iv('12:00', '24:00')],
    6: [iv('00:00', '01:00'), iv('12:00', '24:00')],
    7: [iv('00:00', '01:00'), iv('12:00', '23:00')],
  }),
  // Cierra los lunes (día sin atención).
  'sucursal-3': week({
    2: [iv('12:00', '22:00')],
    3: [iv('12:00', '22:00')],
    4: [iv('12:00', '22:00')],
    5: [iv('12:00', '22:00')],
    6: [iv('12:00', '22:00')],
    7: [iv('12:00', '22:00')],
  }),
  // Inactivas ("próximamente"): sin horario configurado.
  'sucursal-4': emptyWeek(),
  'sucursal-5': emptyWeek(),
};

export interface ClosureRecord {
  /** El contrato real devuelve UUID; el mock usa ids legibles. */
  id: string;
  branchId: string;
  /** Instantes ISO UTC con `Z` y milisegundos. */
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export const CLOSURE_SEEDS: ClosureRecord[] = [
  {
    id: 'cierre-1',
    branchId: 'sucursal-1',
    startsAt: '2026-11-18T18:00:00.000Z',
    endsAt: '2026-11-18T22:00:00.000Z',
    reason: 'Mantenimiento de campana extractora',
  },
  {
    id: 'cierre-2',
    branchId: 'sucursal-1',
    startsAt: '2026-11-04T18:00:00.000Z',
    endsAt: '2026-11-04T20:00:00.000Z',
    reason: 'Capacitación del equipo',
  },
  {
    id: 'cierre-3',
    branchId: 'sucursal-2',
    startsAt: '2026-12-25T00:00:00.000Z',
    endsAt: '2026-12-26T18:00:00.000Z',
    reason: 'Feriado de Navidad',
  },
];

/** Escenario `branch-closed`: cierre extraordinario EN CURSO en cada sucursal activa (el reloj base es 20:25Z). */
export function branchClosedScenarioClosures(branchIds: string[]): ClosureRecord[] {
  return branchIds.map((branchId, i) => ({
    id: `cierre-esc-${i + 1}`,
    branchId,
    startsAt: '2026-11-11T19:00:00.000Z',
    endsAt: '2026-11-12T19:00:00.000Z',
    reason: 'Escenario de prueba: sucursal cerrada',
  }));
}
