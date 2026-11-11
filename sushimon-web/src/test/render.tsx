import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';

/** Renderiza con next-intl (es por defecto) para probar componentes que usan `useTranslations`. */
export function renderWithIntl(
  ui: ReactElement,
  { locale = 'es', ...options }: RenderOptions & { locale?: 'es' | 'en' } = {},
) {
  const messages = locale === 'en' ? en : es;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Guatemala">
      {children}
    </NextIntlClientProvider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
}
