import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import '@fontsource/archivo-black/400.css';
import '@fontsource-variable/dm-sans/index.css';
import '@fontsource/dela-gothic-one/400.css';
import './globals.css';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { THEME_COLORS, THEME_SCRIPT } from '@/components/theme/theme-config';
import { AppProviders } from './providers';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: { default: t('title'), template: '%s · MON SUSHI' },
    description: 'Pedidos de Sushi Mon en Guatemala.',
  };
}

// Valor inicial (tema claro); el script de tema y ThemeProvider lo actualizan según la preferencia.
export const viewport: Viewport = { themeColor: THEME_COLORS.light };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    // `data-scroll-behavior`: Next desactiva el scroll suave solo durante las transiciones de ruta
    // (store.css usa `scroll-behavior: smooth` en <html>).
    <html lang={locale} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* Extensiones del navegador (p. ej. ColorZilla: `cz-shortcut-listen`) añaden atributos al <body> antes de hidratar. */}
      <body suppressHydrationWarning>
        <NextIntlClientProvider>
          <ThemeProvider>
            <AppProviders>{children}</AppProviders>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
