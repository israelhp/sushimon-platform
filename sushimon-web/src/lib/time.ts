/**
 * Utilidades de hora local de Guatemala (UTC−6, sin horario de verano), independientes de la zona
 * horaria de la máquina. No leen la hora actual: reciben fechas (la hora la da el reloj inyectable
 * de `mocks/clock.ts` o `StoreConfig.serverTime`).
 */
export const GT_TIMEZONE = 'America/Guatemala';
/** Desfase fijo de Guatemala respecto de UTC (minutos). */
export const GT_OFFSET_MINUTES = -360;

/** ISO 8601: 1 = lunes … 7 = domingo (NUNCA `Date#getDay`). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

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

/**
 * Día de la semana local (0 = domingo). SOLO para presentación (etiquetas indexadas por `getDay`). Los datos de
 * dominio de horarios (F08) usan ISO 1–7: `localIsoWeekday` / `isoWeekdayOf`.
 */
export function localDayOfWeek(date: Date): number {
  return shifted(date).getUTCDay();
}

/** Día de la semana de una fecha `YYYY-MM-DD` (0 = domingo). Solo presentación; para dominio usa `isoWeekdayOf`. */
export function dayOfWeekOf(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** Convierte un día `getDay`/`getUTCDay` (0 = domingo … 6 = sábado) a ISO 8601 (1 = lunes … 7 = domingo). */
export function isoWeekdayFromJsDay(jsDay: number): IsoWeekday {
  return ((((jsDay % 7) + 6) % 7) + 1) as IsoWeekday;
}

/** Día ISO (1 = lunes … 7 = domingo) de una fecha de calendario `YYYY-MM-DD`. Independiente de la zona del navegador. */
export function isoWeekdayOf(dateISO: string): IsoWeekday {
  return isoWeekdayFromJsDay(dayOfWeekOf(dateISO));
}

/** Día ISO (1–7) del día LOCAL de Guatemala de un instante. Independiente de la zona del navegador o del servidor. */
export function localIsoWeekday(date: Date): IsoWeekday {
  return isoWeekdayFromJsDay(localDayOfWeek(date));
}

/**
 * ÚNICO punto para convertir un `Date` del NAVEGADOR (`getDay`, zona del dispositivo) a ISO 1–7. Úsalo solo cuando el
 * dato proviene de un `Date` local del dispositivo; para instantes del servidor usa `localIsoWeekday`.
 */
export function browserDateIsoWeekday(date: Date): IsoWeekday {
  return isoWeekdayFromJsDay(date.getDay());
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

/** Valor de `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`, hora de Guatemala) → instante ISO UTC con `Z`. */
export function localInputToIso(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = fromLocal(m[1] as string, m[2]);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Instante → valor de `<input type="datetime-local">` en hora de Guatemala. */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${localDate(d)}T${localTime(d)}`;
}
