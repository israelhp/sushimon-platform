import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from './config';

/** Configuración por petición de next-intl: idioma desde la cookie `NEXT_LOCALE` (por defecto `es`). */
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(value) ? value : DEFAULT_LOCALE;
  return {
    locale,
    timeZone: 'America/Guatemala',
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
