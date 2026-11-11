'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, isLocale } from './config';

/**
 * Server Action: guarda el idioma preferido en la cookie `NEXT_LOCALE` (preferencia, no autenticación) y
 * refresca el router para volver a renderizar con los nuevos mensajes. La URL no cambia (igual que el prototipo).
 */
export async function setLocaleAction(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  refresh();
}
