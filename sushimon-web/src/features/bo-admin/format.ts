import { dayOfWeekOf } from '@/lib/time';

/**
 * Formatos de fecha y dinero del backoffice administrativo (Sucursales, Usuarios y Reportes). El backoffice es solo
 * en español; los nombres de día y mes salen de las tablas del prototipo (`DOW`, `MON`, `DOW_L`, `MON_L`).
 */

const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
const DOW_LONG = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;
const MON = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;
const MON_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

function parts(dateISO: string) {
  const [y, m, d] = dateISO.split('-').map(Number);
  return { year: y ?? 0, month: (m ?? 1) - 1, day: d ?? 1 };
}

/** "Jue 5" (etiqueta de columna del gráfico). */
export function dayShort(dateISO: string): string {
  return `${DOW[dayOfWeekOf(dateISO)]} ${parts(dateISO).day}`;
}

/** "Jue 5 nov" (`fmtDay` del prototipo). */
export function dayWithMonth(dateISO: string): string {
  const p = parts(dateISO);
  return `${DOW[dayOfWeekOf(dateISO)]} ${p.day} ${MON[p.month]}`;
}

/** "Miércoles 11 de noviembre de 2026" (`fmtDayLong` del prototipo). */
export function dayLong(dateISO: string): string {
  const p = parts(dateISO);
  const text = `${DOW_LONG[dayOfWeekOf(dateISO)]} ${p.day} de ${MON_LONG[p.month]} de ${p.year}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Número del día del mes ("5"). */
export function dayNumber(dateISO: string): string {
  return String(parts(dateISO).day);
}

/** "Q6.8k" a partir de 1 000; por debajo, "Q842" (`fmtQk` del prototipo). */
export function formatMoneyCompact(value: number): string {
  return value >= 1000 ? `Q${(value / 1000).toFixed(1)}k` : `Q${Math.round(value)}`;
}

/** Días naturales entre dos fechas ISO, ambas incluidas. */
export function daysInRange(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86_400_000) + 1;
}
