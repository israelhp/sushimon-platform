/**
 * Utilidades de hora local de Guatemala (UTC−6, sin horario de verano), independientes de la zona
 * horaria de la máquina. No leen la hora actual: reciben fechas (la hora la da el reloj inyectable
 * de `mocks/clock.ts` o `StoreConfig.serverTime`).
 */
export const GT_TIMEZONE = 'America/Guatemala';
/** Desfase fijo de Guatemala respecto de UTC (minutos). */
export const GT_OFFSET_MINUTES = -360;

const pad = (n: number) => String(n).padStart(2, '0');

function shifted(date: Date): Date {
  return new Date(date.getTime() + GT_OFFSET_MINUTES * 60_000);
}

/** Fecha local `YYYY-MM-DD`. */
export function localDate(date: Date): string {
  const d = shifted(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Minutos desde la medianoche local. */
export function localMinutes(date: Date): number {
  const d = shifted(date);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Hora local `HH:mm`. */
export function localTime(date: Date): string {
  return minutesToHM(localMinutes(date));
}

/** Día de la semana local (0 = domingo). */
export function localDayOfWeek(date: Date): number {
  return shifted(date).getUTCDay();
}

/** Día de la semana de una fecha `YYYY-MM-DD` (0 = domingo). */
export function dayOfWeekOf(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** Instante UTC de una fecha y hora locales de Guatemala. */
export function fromLocal(dateISO: string, time = '00:00'): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(
    Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0) - GT_OFFSET_MINUTES * 60_000,
  );
}

/** Suma días a una fecha `YYYY-MM-DD`. */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToHM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function minutesBetween(from: string | Date, to: string | Date): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
}
