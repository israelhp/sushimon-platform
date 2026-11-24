import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '@/lib/data-access/provider';
import { withShortcuts } from '@/lib/data-access/types';
import esMessages from '@/i18n/messages/es.json';
import { resetNavigationMock, router } from '@/test/next-navigation-mock';
import { DispatchModalHost } from './dispatch-modal-host';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

/**
 * F28 (spec 029 §13): con datos REALES (`http`) el despacho SIMULADO se retira y se manda a Entregas; PedidosYa sigue bloqueado
 * (no hay endpoint). Con datos simulados (`mock`) el modal rotulado «Simulación» se conserva.
 */
beforeEach(() => resetNavigationMock('/backoffice/pedidos'));

const httpClient = withShortcuts('http', async () => {
  throw new Error('el despacho simulado no debe llamar a la API');
});

describe('DispatchModalHost', () => {
  it('con http: no monta el modal simulado, se cierra y abre Entregas', async () => {
    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="es" messages={esMessages}>
        <DataProvider client={httpClient}>
          <DispatchModalHost orderId="MON-307051" onClose={onClose} />
        </DataProvider>
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/backoffice/entregas'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
