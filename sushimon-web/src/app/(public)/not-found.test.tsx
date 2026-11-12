import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import es from '@/i18n/messages/es.json';
import StoreNotFound from './not-found';

// `getTranslations` (servidor) lee la configuración de la petición: aquí se resuelve con el catálogo es.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const messages = (await import('@/i18n/messages/es.json')).default;
  return {
    getTranslations: async () => createTranslator({ locale: 'es', messages }),
  };
});

describe('404 de la tienda', () => {
  it('"Este roll no existe" con enlace de vuelta al inicio', async () => {
    const ui = await StoreNotFound();
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        {ui}
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Este roll no existe' })).toBeVisible();
    expect(screen.getByText('La página que buscás no está disponible.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
  });
});
