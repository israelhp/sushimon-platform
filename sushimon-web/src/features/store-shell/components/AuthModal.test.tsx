import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderStore } from '@/test/store-providers';
import { AuthModal } from './AuthModal';

describe('AuthModal (inicio de sesión simulado)', () => {
  it('rotula la simulación, elige una cuenta de prueba y abre la sesión de demostración', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AuthModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => view.api().shell.openAuth());

    const dialog = await screen.findByRole('dialog', { name: 'Iniciar sesión' });
    expect(within(dialog).getByText('Simulación')).toBeInTheDocument();
    expect(within(dialog).getByText(/Demo: inicio de sesión simulado/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Continuar con Google/ }));
    await user.click(within(dialog).getByRole('button', { name: /Cliente Demo/ }));
    expect(await within(dialog).findByText('Iniciando sesión…')).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(view.api().session.customer).toMatchObject({
      email: 'cliente@ejemplo.com',
      provider: 'google-demo',
    });
  });

  it('"Seguir como invitado" y Esc cierran sin iniciar sesión', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<AuthModal />);
    await act(async () => view.api().shell.openAuth());
    await screen.findByRole('dialog', { name: 'Iniciar sesión' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await act(async () => view.api().shell.openAuth());
    await user.click(await screen.findByRole('button', { name: 'Seguir como invitado' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(view.api().session.customer).toBeNull();
  });
});
