/** Idiomas de la app (ADR-0005): sin prefijo en la URL; la preferencia vive en la cookie `NEXT_LOCALE`. */
export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
/** Nombres de idioma en su propia lengua (endónimos): no se traducen. */
export const LOCALE_LABELS: Record<Locale, { short: string; full: string }> = {
  es: { short: 'ES', full: 'Español' },
  en: { short: 'EN', full: 'English' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
