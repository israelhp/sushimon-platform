/**
 * Formato de dinero, fechas y horas (es → es-GT, en → en-US), replicando el prototipo de la tienda.
 * Las fechas se formatean en la zona horaria de Guatemala para que servidor y navegador coincidan.
 */

export type AppLocale = 'es' | 'en';

export const INTL_LOCALE: Record<AppLocale, string> = { es: 'es-GT', en: 'en-US' };
export const TIME_ZONE = 'America/Guatemala';

export function toIntlLocale(locale: string): string {
  return locale === 'en' || locale.startsWith('en-') ? INTL_LOCALE.en : INTL_LOCALE.es;
}

export interface MoneyOptions {
  /**
   * `2` (por defecto): siempre dos decimales, p. ej. totales (`xe` del prototipo) → "Q1,234.50".
   * `'auto'`: de 0 a 2 decimales, p. ej. precios de menú (`kt` del prototipo) → "Q85", "Q85.5".
   */
  decimals?: 2 | 'auto';
}

/**
 * Quetzales con el formato del prototipo: prefijo "Q" sin espacio y números en en-US en ambos idiomas
 * (en Guatemala se usa coma de miles y punto decimal). `locale` se acepta por simetría con el resto de utilidades.
 */
export function formatMoney(
  value: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma común con formatDate/formatTime
  _locale: string = 'es',
  options: MoneyOptions = {},
): string {
  const min = options.decimals === 'auto' ? 0 : 2;
  const sign = value < 0 ? '-' : '';
  return (
    sign +
    'Q' +
    numberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: 2 }).format(
      Math.abs(value),
    )
  );
}

// Crear un Intl.*Format es caro: se reutilizan por locale + opciones (a nivel de módulo).
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat(locale, options)));
  return f;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = dateFormats.get(key);
  if (!f) dateFormats.set(key, (f = new Intl.DateTimeFormat(locale, options)));
  return f;
}

/** Cantidad de formateadores en caché (solo para pruebas). */
export const formatterCacheSize = () => numberFormats.size + dateFormats.size;

type DateInput = Date | string | number;

const toDate = (d: DateInput) => (d instanceof Date ? d : new Date(d));

/** Fecha con `Intl.DateTimeFormat` (por defecto "11 nov 2026" / "Nov 11, 2026"). Quita los puntos de abreviatura como el prototipo. */
export function formatDate(
  date: DateInput,
  locale: string = 'es',
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  return dateFormat(toIntlLocale(locale), { timeZone: TIME_ZONE, ...options })
    .format(toDate(date))
    .replace(/\./g, '');
}

/** Fecha y hora (como `Cs` del prototipo): "11 nov 2026, 12:05 p. m." / "Nov 11, 2026, 12:05 PM". */
export function formatDateTime(date: DateInput, locale: string = 'es'): string {
  return dateFormat(toIntlLocale(locale), {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(toDate(date));
}

/** Hora de un instante (`Date`/ISO) en Guatemala, con Intl. */
export function formatTime(date: DateInput, locale: string = 'es'): string {
  return dateFormat(toIntlLocale(locale), {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(toDate(date));
}

/**
 * Hora de reloj "HH:MM" (horarios de sucursal, franjas programadas) con el formato fijo del prototipo (`si`):
 * es → "1:30 p. m.", en → "1:30 p.m.".
 */
export function formatClock(hhmm: string, locale: string = 'es'): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const en = toIntlLocale(locale) === INTL_LOCALE.en;
  const suffix = h >= 12 ? (en ? 'p.m.' : 'p. m.') : en ? 'a.m.' : 'a. m.';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}
