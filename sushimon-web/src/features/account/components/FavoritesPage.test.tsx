import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MockStore } from '@/mocks/store';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { FavoritesPage } from './FavoritesPage';

const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };

type View = Awaited<ReturnType<typeof renderStore>>;
const signIn = (view: View) => act(async () => view.api().session.signInCustomer(DEMO));
const favoritesOf = (store: MockStore) => store.accounts['cliente@ejemplo.com']!.favorites;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('Mis favoritos (F06)', () => {
  it('visitante: invita a iniciar sesión (texto sin "este dispositivo"), estado vacío y sin peticiones', async () => {
    const user = userEvent.setup();
    const spy = createSpyClient();
    const view = await renderStore(<FavoritesPage />, { wrapClient: spy.wrap });
    spy.calls.length = 0;
    const note = screen.getByRole('button', { name: /Iniciá sesión con Google/ });
    expect(note).not.toHaveTextContent(/este dispositivo/);
    expect(screen.getByText('Todavía no tenés favoritos')).toBeVisible();
    await user.click(note);
    expect(view.api().shell.authOpen).toBe(true);
    expect(spy.calls.filter((c) => c.path.includes('favorites'))).toHaveLength(0);
  });

  it('cargando: esqueleto accesible mientras llega la lista', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<FavoritesPage />, { wrapClient: spy.wrap });
    spy.calls.length = 0;
    // Dos lecturas del mismo endpoint: los ids de los corazones (pageSize=0) y la página de Mis favoritos.
    const first = spy.hold('GET', /^\/v1\/me\/favorites$/);
    const second = spy.hold('GET', /^\/v1\/me\/favorites$/);
    await signIn(view);
    await waitFor(() => expect(first.held() && second.held()).toBe(true));
    expect(screen.getByLabelText('Cargando…')).toHaveAttribute('aria-busy', 'true');
    first.release();
    second.release();
    expect(await screen.findByRole('list', { name: 'Tus productos favoritos' })).toBeVisible();
    expect(spy.count('GET', /^\/v1\/me\/favorites$/)).toBe(2);
    expect(spy.count('GET', /^\/v1\/me\/favorites$/, '0')).toBe(1);
    expect(
      await screen.findByRole('button', { name: /Quitar Platanito Roll de favoritos/ }),
    ).not.toHaveAttribute('aria-busy');
  });

  it('las filas con resumen de la API se pintan sin esperar al catálogo completo', async () => {
    const spy = createSpyClient();
    const catalog = spy.hold('GET', /^\/v1\/store\/products$/); // antes de montar: el catálogo carga al montar
    const view = await renderStore(<FavoritesPage />, { wrapClient: spy.wrap });
    await signIn(view);
    const list = await screen.findByRole('list', { name: 'Tus productos favoritos' });
    // Catálogo retenido: filas mínimas (nombre de la API, sin precio ni «no disponible»).
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('Platanito Roll');
    expect(list).not.toHaveTextContent(/Q\d/);
    expect(list).not.toHaveTextContent('No disponible por ahora');
    catalog.release();
    await waitFor(() => expect(list).toHaveTextContent(/Q\d/));
  });

  it('con datos: orden de la API, precio del catálogo y contador', async () => {
    const view = await renderStore(<FavoritesPage />);
    await signIn(view);
    const list = await screen.findByRole('list', { name: 'Tus productos favoritos' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Platanito Roll');
    await waitFor(() => expect(items[0]).toHaveTextContent('Q')); // precio del catálogo, no de la relación
    expect(items[1]).toHaveTextContent('Calientito Roll');
    expect(screen.getByText('2 favoritos')).toBeVisible();
  });

  it('quitar desde la lista: desaparece de inmediato y llega al vacío', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<FavoritesPage />);
    await signIn(view);
    await user.click(
      await screen.findByRole('button', { name: /Quitar Platanito Roll de favoritos/ }),
    );
    await user.click(
      await screen.findByRole('button', { name: /Quitar Calientito Roll de favoritos/ }),
    );
    expect(await screen.findByText('Todavía no tenés favoritos')).toBeVisible();
    expect(screen.getByRole('link', { name: /menú/i })).toHaveAttribute('href', '/menu');
  });

  it('vacío: cuenta sin favoritos con acción al menú', async () => {
    const view = await renderStore(<FavoritesPage />, { scenario: 'empty' });
    await signIn(view);
    expect(await screen.findByText('Todavía no tenés favoritos')).toBeVisible();
  });

  it('error de carga: aviso con reintento', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<FavoritesPage />, { scenario: 'error' });
    await signIn(view);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No pudimos actualizar tus favoritos');
    await user.click(within(alert).getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByRole('alert')).toBeVisible();
  });

  it('catálogo no disponible (UNAVAILABLE): aviso, filas "no podemos mostrar detalles" y se pueden quitar', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<FavoritesPage />, {
      prepareStore: (store) => {
        store.favoritesCatalog = 'unavailable';
      },
    });
    await signIn(view);
    expect(
      await screen.findByText(/No podemos mostrar los detalles de tus favoritos ahora/),
    ).toBeVisible();
    const rows = screen.getAllByText('No podemos mostrar los detalles ahora');
    expect(rows).toHaveLength(2);
    // Sin ids ni slugs crudos en pantalla.
    expect(screen.queryByText(/platanito-roll/)).not.toBeInTheDocument();
    // El nombre sale del catálogo de la tienda (otra fuente); el estado/precio de la API no se inventan.
    const remove = screen.getByRole('button', { name: /Quitar Platanito Roll de favoritos/ });
    expect(remove).toHaveTextContent('Quitar');
    expect(screen.queryByText(/Q\d/)).not.toBeInTheDocument();
    await user.click(remove);
    await waitFor(() =>
      expect(screen.getAllByText('No podemos mostrar los detalles ahora')).toHaveLength(1),
    );
  });

  it('estados REMOVED / INACTIVE / UNAVAILABLE: filas discretas y seguras con "Quitar"', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<FavoritesPage />, {
      prepareStore: (store) => {
        favoritesOf(store).splice(
          0,
          favoritesOf(store).length,
          { productId: 'fantasma-removido', addedAt: '2026-11-10T00:00:00.000Z' },
          { productId: 'platanito-roll', addedAt: '2026-11-09T00:00:00.000Z' },
        );
        const roll = store.products.find((p) => p.id === 'platanito-roll')!;
        roll.availability = roll.availability.map((a) => ({ ...a, available: false }));
      },
    });
    await signIn(view);
    expect(await screen.findByText('Ya no está disponible')).toBeVisible();
    expect(screen.getByText('No disponible por ahora')).toBeVisible();
    expect(screen.queryByText(/fantasma-removido/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Quitar Producto guardado de favoritos/ }));
    await waitFor(() =>
      expect(screen.queryByText('Ya no está disponible')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('No disponible por ahora')).toBeVisible();
  });

  it('en inglés usa el nombre inglés y textos en inglés', async () => {
    const view = await renderStore(<FavoritesPage />, { locale: 'en' });
    await signIn(view);
    expect(await screen.findByText('2 favorites')).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: /Remove .* from favorites/ }).length,
    ).toBeGreaterThan(0);
  });

  it('paginación: más de 20 favoritos muestran la navegación por páginas', async () => {
    const user = userEvent.setup();
    const view = await renderStore(<FavoritesPage />, {
      prepareStore: (store) => {
        favoritesOf(store).splice(
          0,
          favoritesOf(store).length,
          ...Array.from({ length: 25 }, (_, i) => ({
            productId: i === 0 ? 'platanito-roll' : `retirado-${i}`,
            addedAt: `2026-11-01T00:00:${String(59 - i).padStart(2, '0')}.000Z`,
          })),
        );
      },
    });
    await signIn(view);
    expect(await screen.findByText('Página 1 de 2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Página 2 de 2')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});
