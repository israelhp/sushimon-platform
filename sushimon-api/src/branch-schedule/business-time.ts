/**
 * Tiempo del negocio (F08, ADR-0011): conversión instante <-> hora local de una zona IANA.
 *
 * Módulo PURO. Garantías:
 * - Solo `Intl.DateTimeFormat(timeZone)` y `Date.UTC`/`Date#getTime`; JAMÁS `getDay()/getHours()/…` ni
 *   `new Date(string)` sin zona: el resultado no depende de `process.env.TZ`, de la BD ni del navegador.
 * - Día de la semana ISO (1 = lunes … 7 = domingo) por aritmética de días desde la época.
 * - Los instantes se manejan como milisegundos UTC (`number`).
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;
export const MINUTES_PER_DAY = 1_440;

/** Fecha de calendario local (sin hora ni zona). */
export interface LocalDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

export interface LocalDateTime extends LocalDate {
  hour: number; // 0..23
  minute: number;
  second: number;
  /** ISO 8601: 1 = lunes … 7 = domingo. */
  weekday: number;
  /** Minutos transcurridos desde 00:00 local (0..1439). */
  minuteOfDay: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Día de la semana ISO (1..7) de una fecha de calendario, por aritmética (1970-01-01 fue jueves = 4). */
export function isoWeekdayOf(date: LocalDate): number {
  const days = Math.floor(Date.UTC(date.year, date.month - 1, date.day) / MS_PER_DAY);
  return ((((days + 3) % 7) + 7) % 7) + 1;
}

/** Suma `delta` días a una fecha de calendario (aritmética de calendario; independiente de zona). */
export function addDays(date: LocalDate, delta: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Instante (ms UTC) -> fecha y hora local de `timeZone`, con día ISO y minuto del día. */
export function toLocal(instantMs: number, timeZone: string): LocalDateTime {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Intl no devolvió '${type}' para ${timeZone}`);
    return Number(part.value);
  };
  const date: LocalDate = { year: get('year'), month: get('month'), day: get('day') };
  // Algunos motores devuelven "24" para la medianoche aun con h23: se normaliza.
  const hour = get('hour') % 24;
  const minute = get('minute');
  return {
    ...date,
    hour,
    minute,
    second: get('second'),
    weekday: isoWeekdayOf(date),
    minuteOfDay: hour * 60 + minute,
  };
}

/** Desfase (ms) de la zona respecto de UTC en `instantMs`: hora local interpretada como UTC menos el instante. */
function offsetAt(instantMs: number, timeZone: string): number {
  const l = toLocal(instantMs, timeZone);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Resuelve el desfase de la zona en un instante; las implementaciones pueden memoizar. */
export interface OffsetResolver {
  offsetAt(instantMs: number): number;
}

/** Sin caché: una llamada a Intl por consulta (exacto). */
export const exactOffsets = (timeZone: string): OffsetResolver => ({
  offsetAt: (ms) => offsetAt(ms, timeZone),
});

/**
 * Resolver con memoria SOLO para una evaluación (nunca entre peticiones): calcula el desfase al inicio y al final
 * de cada día UTC; si coinciden, lo reutiliza para todo el día (sin transición de horario dentro del día); si no,
 * calcula cada instante de ese día de forma exacta. Reduce las llamadas a `Intl` de ~400 a ~40 por evaluación sin
 * cambiar resultados (supuesto: no hay dos transiciones de desfase en el mismo día UTC, cierto en tzdb actual).
 */
export function memoizedOffsets(timeZone: string): OffsetResolver {
  const perDay = new Map<number, number | null>();
  return {
    offsetAt(ms) {
      const day = Math.floor(ms / MS_PER_DAY);
      let cached = perDay.get(day);
      if (cached === undefined) {
        const start = offsetAt(day * MS_PER_DAY, timeZone);
        const end = offsetAt(day * MS_PER_DAY + MS_PER_DAY - 1000, timeZone);
        cached = start === end ? start : null;
        perDay.set(day, cached);
      }
      return cached ?? offsetAt(ms, timeZone);
    },
  };
}

/**
 * Instante (ms UTC) de «fecha local + minuto del día». `minuteOfDay` admite 0..1440: 1440 (`24:00`) es
 * 00:00 del día siguiente. Resuelve el desfase iterando (válido también con horario de verano).
 */
export function instantOf(
  date: LocalDate,
  minuteOfDay: number,
  timeZone: string,
  offsets: OffsetResolver = exactOffsets(timeZone),
): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day) + minuteOfDay * MS_PER_MINUTE;
  const first = wall - offsets.offsetAt(wall);
  return wall - offsets.offsetAt(first);
}

/** `HH:mm` (o `24:00`) -> minutos del día (0..1440); `null` si el formato es inválido. */
export function parseClock(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (min > 59) return null;
  if (h === 24) return min === 0 ? MINUTES_PER_DAY : null;
  return h > 23 ? null : h * 60 + min;
}

/** Minutos del día (0..1440) -> `HH:mm` (`24:00` para 1440). */
export function formatClock(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `HH:mm[:ss]` de PostgreSQL (`opens_at::text`, incluido `24:00:00`) -> minutos del día. */
export function parsePgTime(value: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) throw new Error('Hora de base de datos con formato inesperado');
  return Number(m[1]) * 60 + Number(m[2]);
}

export const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/**
 * ISO 8601 CON zona (`Z` o `±hh:mm`) -> ms UTC truncados al segundo; `null` si no hay zona, el formato es
 * inválido o la fecha no existe (p. ej. 31 de febrero). No usa `Date.parse` (que rodaría fechas inexistentes).
 */
export function parseInstant(value: string): number | null {
  const m = INSTANT_PATTERN.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const second = Number(m[6] ?? '0');
  if (month < 1 || month > 12) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const zone = m[7] as string;
  let offsetMin = 0;
  if (zone !== 'Z') {
    offsetMin = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6));
    if (zone.startsWith('-')) offsetMin = -offsetMin;
  }
  return Date.UTC(year, month - 1, day, hour, minute, second) - offsetMin * MS_PER_MINUTE;
}

/** Trunca ms al segundo (los instantes de entrada se truncan). */
export const truncateToSecond = (ms: number): number => Math.floor(ms / 1000) * 1000;
