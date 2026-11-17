import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { withShortcuts, type DataClient, type RequestOptions } from '@/lib/data-access/types';
import type { StoreBootstrap } from '@/lib/data-access/models';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { FavoritesSection, HomeFootnote } from './favorites-section';

const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const card = {
  productId: 'dumplings',
  slug: 'dumplings',
  price: '53.00',
  available: true,
  name: 'Dumplings',
  summary: 'Empanaditas',
  image: null,
  category: { id: 'cat-entradas', slug: 'entradas', name: 'Entradas' },
  promo: null,
};

/** Cliente que devuelve `featured` en el bootstrap (la API hoy responde `[]`: P23). */
const withFeatured = (featured: unknown[]) => (base: DataClient) =>
  withShortcuts('mock', async <T,>(path: string, options: RequestOptions = {}) => {
    const res = await base.request<T>(path, options);
    return path === '/v1/store/bootstrap' ? ({ ...(res as StoreBootstrap), featured } as T) : res;
  });

describe('FavoritesSection del Inicio (F17)', () => {
  it('visitante y sin destacados (P23: featured=[]): la sección NO se renderiza ni pide catálogo, menú o favoritos', async () => {
    const spy = createSpyClient();
    await renderStore(<FavoritesSection />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    await waitFor(() => expect(spy.count('GET', /store\/bootstrap/)).toBe(1));
    await act(async () => {});
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(spy.count('GET', /store\/(menu|products)|me\/favorites/)).toBe(0);
  });

  it('con destacados del bootstrap: tarjetas del servidor, sin solicitar el menú', async () => {
    const spy = createSpyClient();
    await renderStore(<FavoritesSection />, {
      branchId: 'sucursal-1',
      wrapClient: (base) => withFeatured([card])(spy.wrap(base)),
    });
    expect(await screen.findByRole('heading', { name: /Favoritos/ })).toBeVisible();
    expect(screen.getByText('Dumplings')).toBeVisible();
    expect(spy.count('GET', /store\/(menu|products)/)).toBe(0);
  });

  it('cliente autenticado con favoritos: los compone aparte con /me/favorites y precios del menú de su sucursal', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<FavoritesSection />, {
      branchId: 'sucursal-1',
      wrapClient: spy.wrap,
    });
    await act(async () => view.api().session.signInCustomer(DEMO));
    expect(await screen.findByRole('heading', { name: 'Tus favoritos' })).toBeVisible();
    expect(await screen.findByText('Platanito Roll')).toBeVisible();
    expect(spy.count('GET', /me\/favorites/)).toBeGreaterThanOrEqual(1);
    expect(spy.count('GET', /^\/v1\/store\/menu$/)).toBe(1);
    // Los favoritos del cliente NO se mezclan con la caché pública del bootstrap.
    const bootstrap = view.queryClient
      .getQueryCache()
      .findAll({ queryKey: ['store', 'bootstrap'] });
    expect(JSON.stringify(bootstrap.map((q) => q.state.data))).not.toMatch(/favorite/i);
  });

  it('error del bootstrap: aviso con «Reintentar» que vuelve a pedirlo', async () => {
    const spy = createSpyClient();
    const gate = spy.hold('GET', /store\/bootstrap/);
    await renderStore(<FavoritesSection />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    await act(async () => gate.fail(new ApiError(503, 'unavailable', 'STORE_BUSY')));
    const alert = await screen.findByRole('alert');
    expect(alert).toBeVisible();
    await act(async () => alert.querySelector('button')?.click());
    await waitFor(() => expect(spy.count('GET', /store\/bootstrap/)).toBe(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('HomeFootnote (F17)', () => {
  it('B3: plural ICU: «1 producto» / «2 productos» (y en inglés «1 item»)', async () => {
    const one = (base: DataClient) =>
      withShortcuts('mock', async <T,>(path: string, options: RequestOptions = {}) => {
        const res = await base.request<T>(path, options);
        return path === '/v1/store/bootstrap'
          ? ({ ...(res as StoreBootstrap), productCount: 1 } as T)
          : res;
      });
    const view = await renderStore(<HomeFootnote />, { branchId: 'sucursal-1', wrapClient: one });
    expect(await screen.findByText('1 producto en el menú · Precios en quetzales')).toBeVisible();
    view.unmount();
    await renderStore(<HomeFootnote />, { branchId: 'sucursal-1', wrapClient: one, locale: 'en' });
    expect(await screen.findByText('1 item on the menu · Prices in quetzales')).toBeVisible();
  });

  it('muestra productCount del bootstrap sin cargar el menú', async () => {
    const spy = createSpyClient();
    await renderStore(<HomeFootnote />, { branchId: 'sucursal-1', wrapClient: spy.wrap });
    expect(await screen.findByText(/29 productos en el menú/)).toBeVisible();
    expect(spy.count('GET', /store\/(menu|products)/)).toBe(0);
  });
});
