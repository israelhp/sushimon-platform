import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackofficeShell } from '@/features/backoffice-shell/BackofficeShell';
import { SOUND_PREF_KEY } from '@/features/backoffice-shell/shell-context';
import { renderBackoffice } from '@/test/backoffice-providers';
import { resetNavigationMock } from '@/test/next-navigation-mock';
import { OrdersScreen } from './components/OrdersScreen';

vi.mock('next/navigation', async () => await import('@/test/next-navigation-mock'));

const beep = vi.hoisted(() => ({ play: vi.fn(), prime: vi.fn() }));
vi.mock('@/lib/beep', () => ({ playBeep: beep.play, primeBeep: beep.prime }));

beforeEach(() => {
  resetNavigationMock('/backoffice/pedidos');
  window.localStorage.removeItem(SOUND_PREF_KEY);
  beep.play.mockClear();
  beep.prime.mockClear();
});
afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.title = '';
});

const renderOrders = () =>
  renderBackoffice(
    <BackofficeShell>
      <OrdersScreen />
    </BackofficeShell>,
    { role: 'manager' },
  );

/** Hace llegar un pedido nuevo con el botón de demostración (solo mock) y espera a que el tablero lo muestre. */
async function arrive() {
  await userEvent.click(screen.getByRole('button', { name: /Demo: llega un pedido/ }));
}

describe('indicador de pedidos nuevos (spec 023 §10.4)', () => {
  it('la primera carga fija la línea base: sin resaltado, sin aviso y sin sonido', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    expect(document.querySelector('.kcard.fresh')).toBeNull();
    expect(screen.queryByText(/nuevos? ·|Pedido nuevo:/)).toBeNull();
    expect(beep.play).not.toHaveBeenCalled();
    const live = document.querySelector('p[role="status"].sr-only');
    expect(live).toHaveTextContent('');
  });

  it('un pedido nuevo → contador, resaltado y UN solo aviso educado (aria-live)', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await arrive();
    await waitFor(() => expect(document.querySelector('.kcard.fresh')).not.toBeNull());
    const chip = within(screen.getByRole('region', { name: 'Nuevo' })).getByText('1 nuevo');
    expect(chip).toBeVisible();
    const lives = document.querySelectorAll('p[role="status"][aria-live="polite"].sr-only');
    expect(lives).toHaveLength(1);
    expect(lives[0]!.textContent).toMatch(/^Pedido nuevo: MON-\d+$/);
  });

  it('escribir en la búsqueda NO quita el resaltado ni el contador', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await arrive();
    await waitFor(() => expect(document.querySelector('.kcard.fresh')).not.toBeNull());
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), 'ana');
    expect(document.querySelector('.kcard.fresh')).not.toBeNull();
    expect(screen.getByText('Recién llegado')).toBeVisible();
    // Interactuar con el tablero sí lo da por visto.
    await userEvent.click(document.querySelector<HTMLElement>('.kcard.fresh .kcard-main')!);
    await waitFor(() => expect(document.querySelector('.kcard.fresh')).toBeNull());
  });

  it('el resaltado se quita al interactuar con la lista', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await arrive();
    await waitFor(() => expect(document.querySelector('.kcard.fresh')).not.toBeNull());
    await userEvent.click(document.querySelector<HTMLElement>('.kcard.fresh .kcard-main')!);
    await waitFor(() => expect(document.querySelector('.kcard.fresh')).toBeNull());
    expect(screen.queryByText('1 nuevo')).toBeNull();
  });

  it('con la pestaña oculta el título lleva el contador y se restablece al volver', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    document.title = 'Pedidos';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await arrive();
    await waitFor(() => expect(document.title).toBe('(1) Pedidos'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(document.title).toBe('Pedidos'));
  });
});

describe('sonido opt-in', () => {
  it('está APAGADO por defecto: un pedido nuevo no suena y nada se guarda', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    expect(
      screen.getByRole('button', { name: /Sonido de pedidos nuevos: apagado/ }),
    ).toHaveAttribute('aria-pressed', 'false');
    await arrive();
    await waitFor(() => expect(document.querySelector('.kcard.fresh')).not.toBeNull());
    expect(beep.play).not.toHaveBeenCalled();
    expect(beep.prime).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SOUND_PREF_KEY)).toBeNull();
  });

  it('al activarlo (gesto) prepara el audio, guarda SOLO la preferencia y suena una vez por tanda', async () => {
    await renderOrders();
    await screen.findByText('#MON-307057');
    await userEvent.click(
      screen.getByRole('button', { name: /Sonido de pedidos nuevos: apagado/ }),
    );
    expect(beep.prime).toHaveBeenCalled();
    expect(window.localStorage.getItem(SOUND_PREF_KEY)).toBe('1');
    expect(beep.play).not.toHaveBeenCalled(); // activarlo no suena
    await arrive();
    await waitFor(() => expect(beep.play).toHaveBeenCalledTimes(1));
    // El sondeo siguiente sin pedidos nuevos no vuelve a sonar.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(beep.play).toHaveBeenCalledTimes(1);
  });
});
