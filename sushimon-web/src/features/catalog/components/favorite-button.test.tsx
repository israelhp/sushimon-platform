import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { FavoriteButton } from './favorite-button';

const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('FavoriteButton', () => {
  it('es un button type=button con aria-pressed, etiqueta es y glifo oculto', async () => {
    await renderStore(<FavoriteButton productId="dumplings" name="Dumplings" />);
    const button = screen.getByRole('button', { name: 'Agregar Dumplings a favoritos' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('etiqueta en inglés y estado marcado con sesión', async () => {
    const view = await renderStore(
      <FavoriteButton productId="platanito-roll" name="Platanito Roll" />,
      {
        locale: 'en',
      },
    );
    expect(
      screen.getByRole('button', { name: 'Add Platanito Roll to favorites' }),
    ).toBeInTheDocument();
    await act(async () => view.api().session.signInCustomer(DEMO));
    const pressed = await screen.findByRole('button', {
      name: 'Remove Platanito Roll from favorites',
    });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
  });

  it('visitante: abre el login y no llama a la API', async () => {
    const user = userEvent.setup();
    const spy = createSpyClient();
    const view = await renderStore(<FavoriteButton productId="dumplings" name="Dumplings" />, {
      wrapClient: spy.wrap,
    });
    spy.calls.length = 0;
    await user.click(screen.getByRole('button', { name: /Agregar Dumplings/ }));
    expect(view.api().shell.authOpen).toBe(true);
    expect(spy.calls).toHaveLength(0);
  });

  it('aria-busy mientras se conoce el estado y mientras la alta está en vuelo (sin doble envío)', async () => {
    const user = userEvent.setup();
    const spy = createSpyClient();
    const view = await renderStore(<FavoriteButton productId="dumplings" name="Dumplings" />, {
      wrapClient: spy.wrap,
    });
    const idsGate = spy.hold('GET', /^\/v1\/me\/favorites$/);
    await act(async () => view.api().session.signInCustomer(DEMO));
    const button = screen.getByRole('button', { name: /Dumplings/ });
    await waitFor(() => expect(idsGate.held()).toBe(true));
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(spy.count('PUT', /favorites\//)).toBe(0);
    idsGate.release();
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));

    const putGate = spy.hold('PUT', /favorites\//);
    await user.click(button);
    await waitFor(() => expect(putGate.held()).toBe(true));
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    putGate.release();
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
    expect(spy.count('PUT', /favorites\//)).toBe(1);
  });
});
