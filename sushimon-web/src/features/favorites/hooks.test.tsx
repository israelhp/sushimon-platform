import { act, screen, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FavoriteButton } from '@/features/catalog/components/favorite-button';
import { queryKeys } from '@/features/query-keys';
import { ApiError } from '@/lib/data-access/errors';
import type { CustomerFavorites } from '@/lib/data-access/models';
import type { MockStore } from '@/mocks/store';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';

const DEMO = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };
const OTHER = { email: 'invitado.nuevo@ejemplo.com', name: 'Invitado Nuevo' };
const LIST = /^\/v1\/me\/favorites$/;
const ITEM = /^\/v1\/me\/favorites\/[^/]+$/;

const CARDS = [
  ['platanito-roll', 'Platanito Roll'],
  ['calientito-roll', 'Calientito Roll'],
  ['dumplings', 'Dumplings'],
  ['gaseosas', 'Gaseosas'],
] as const;

const renders: Record<string, number> = {};
const countRender = (id: string) => {
  renders[id] = (renders[id] ?? 0) + 1;
};

function Cards() {
  return (
    <div>
      {CARDS.map(([id, name]) => (
        <Profiler key={id} id={id} onRender={() => countRender(id)}>
          <FavoriteButton productId={id} name={name} />
        </Profiler>
      ))}
    </div>
  );
}

async function setup(prepare?: (store: MockStore) => void) {
  const spy = createSpyClient();
  const view = await renderStore(<Cards />, { wrapClient: spy.wrap, prepareStore: prepare });
  // La sesión de demostración es un store de módulo: una prueba anterior pudo dejarla abierta al montar.
  spy.calls.length = 0;
  const signIn = (account = DEMO) => act(async () => view.api().session.signInCustomer(account));
  return { ...view, spy, signIn };
}

const heart = (name: string, pressed?: boolean) =>
  screen.getByRole('button', {
    name: new RegExp(`(Agregar|Quitar) ${name} (a|de) favoritos`),
    ...(pressed === undefined ? {} : { pressed }),
  });

beforeEach(() => {
  for (const key of Object.keys(renders)) delete renders[key];
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('estado remoto único de los corazones (D15)', () => {
  it('sin sesión no hay ninguna petición y el corazón abre el login sin crear nada', async () => {
    const user = userEvent.setup();
    const { spy, api } = await setup();
    expect(heart('Platanito Roll')).toHaveAttribute('aria-pressed', 'false');
    await user.click(heart('Platanito Roll'));
    expect(api().shell.authOpen).toBe(true);
    expect(spy.calls).toHaveLength(0);
  });

  it('con sesión, N tarjetas comparten UNA sola consulta de ids (pageSize=0), nunca una por tarjeta', async () => {
    const { spy, signIn } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Platanito Roll', true)).toBeInTheDocument());
    expect(heart('Calientito Roll', true)).toBeInTheDocument();
    expect(heart('Dumplings', false)).toBeInTheDocument();
    expect(spy.count('GET', LIST, '0')).toBe(1);
    expect(spy.count('GET', LIST)).toBe(1);
    expect(spy.count('GET', ITEM)).toBe(0);
  });

  it('claves aisladas por identidad: otra cuenta no ve ni reutiliza la caché de la anterior', async () => {
    const { signIn, queryClient, spy } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Platanito Roll', true)).toBeInTheDocument());
    const demoKey = queryKeys.customer.favorites.ids('demo:cliente@ejemplo.com');
    expect(queryClient.getQueryData(demoKey)).toBeDefined();

    await signIn(OTHER);
    await waitFor(() => expect(heart('Platanito Roll', false)).toBeInTheDocument());
    expect(heart('Calientito Roll', false)).toBeInTheDocument();
    // La caché de la cuenta anterior se descartó (no solo se ocultó) y la nueva se pidió al servidor.
    expect(queryClient.getQueryData(demoKey)).toBeUndefined();
    expect(spy.count('GET', LIST, '0')).toBe(2);
    expect(
      queryClient.getQueryData<CustomerFavorites>(
        queryKeys.customer.favorites.ids('demo:invitado.nuevo@ejemplo.com'),
      )?.total,
    ).toBe(0);
  });

  it('cerrar sesión descarta los datos del cliente y los corazones vuelven a vacío', async () => {
    const { signIn, queryClient, api } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Platanito Roll', true)).toBeInTheDocument());
    await act(async () => api().session.signOutCustomer());
    await waitFor(() => expect(heart('Platanito Roll', false)).toBeInTheDocument());
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === 'customer' && q.state.data !== undefined),
    ).toEqual([]);
  });
});

describe('mutación optimista (D16)', () => {
  it('marca al instante, cancela consultas en vuelo, avisa y refresca UNA vez', async () => {
    const user = userEvent.setup();
    const { spy, signIn, queryClient } = await setup();
    const cancel = vi.spyOn(queryClient, 'cancelQueries');
    await signIn();
    await waitFor(() => expect(heart('Dumplings', false)).toBeInTheDocument());
    const gate = spy.hold('PUT', ITEM);

    await user.click(heart('Dumplings'));
    // Optimista: marcado antes de que el servidor responda; ocupado y sin doble envío.
    await waitFor(() => expect(gate.held()).toBe(true));
    expect(heart('Dumplings', true)).toHaveAttribute('aria-busy', 'true');
    expect(cancel).toHaveBeenCalledWith({
      queryKey: queryKeys.customer.favorites.all('demo:cliente@ejemplo.com'),
    });
    await user.click(heart('Dumplings'));
    expect(spy.count('PUT', ITEM)).toBe(1);

    gate.release();
    expect(await screen.findByText('Dumplings está en tus favoritos')).toBeVisible();
    await waitFor(() => expect(heart('Dumplings')).not.toHaveAttribute('aria-busy'));
    // ids inicial + 1 refresco (no uno por mutación ni por tarjeta).
    expect(spy.count('GET', LIST, '0')).toBe(2);
  });

  it('error: rollback SOLO del producto afectado (otro cambio optimista en vuelo se conserva)', async () => {
    const user = userEvent.setup();
    const { spy, signIn } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Dumplings', false)).toBeInTheDocument());
    const failing = spy.hold('PUT', ITEM); // Dumplings (primera)
    const succeeding = spy.hold('PUT', ITEM); // Gaseosas (segunda)

    await user.click(heart('Dumplings'));
    await waitFor(() => expect(failing.held()).toBe(true));
    await user.click(heart('Gaseosas'));
    await waitFor(() => expect(succeeding.held()).toBe(true));
    expect(heart('Dumplings', true)).toBeInTheDocument();
    expect(heart('Gaseosas', true)).toBeInTheDocument();

    failing.fail(
      new ApiError(503, 'server_error', 'x', undefined, undefined, 'CATALOG_UNAVAILABLE'),
    );
    expect(await screen.findByText(/Favoritos no está disponible por ahora/)).toBeVisible();
    // Dumplings se deshace; Gaseosas (aún en vuelo) NO se pisa con un snapshot completo.
    await waitFor(() => expect(heart('Dumplings', false)).toBeInTheDocument());
    expect(heart('Gaseosas', true)).toBeInTheDocument();

    succeeding.release();
    await waitFor(() => expect(heart('Gaseosas')).not.toHaveAttribute('aria-busy'));
    expect(heart('Gaseosas', true)).toBeInTheDocument();
    expect(heart('Dumplings', false)).toBeInTheDocument();
  });

  it('respuestas fuera de orden: el refresco ocurre solo cuando termina la ÚLTIMA mutación', async () => {
    const user = userEvent.setup();
    const { spy, signIn } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Dumplings', false)).toBeInTheDocument());
    const first = spy.hold('PUT', ITEM);
    const second = spy.hold('PUT', ITEM);
    await user.click(heart('Dumplings'));
    await waitFor(() => expect(first.held()).toBe(true));
    await user.click(heart('Gaseosas'));
    await waitFor(() => expect(second.held()).toBe(true));

    second.release(); // responde primero la segunda
    await waitFor(() => expect(heart('Gaseosas')).not.toHaveAttribute('aria-busy'));
    expect(spy.count('GET', LIST, '0')).toBe(1); // sin refresco: aún hay una en vuelo
    first.release();
    await waitFor(() => expect(heart('Dumplings')).not.toHaveAttribute('aria-busy'));
    await waitFor(() => expect(spy.count('GET', LIST, '0')).toBe(2));
    expect(heart('Dumplings', true)).toBeInTheDocument();
    expect(heart('Gaseosas', true)).toBeInTheDocument();
  });

  it('quitar es optimista y un fallo lo devuelve a su posición', async () => {
    const user = userEvent.setup();
    const { spy, signIn, queryClient } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Platanito Roll', true)).toBeInTheDocument());
    const gate = spy.hold('DELETE', ITEM);
    await user.click(heart('Platanito Roll'));
    await waitFor(() => expect(gate.held()).toBe(true));
    expect(heart('Platanito Roll', false)).toBeInTheDocument();
    gate.fail(new ApiError(0, 'offline', 'sin conexión'));
    expect(await screen.findByText(/Sin conexión/)).toBeVisible();
    await waitFor(() => expect(heart('Platanito Roll', true)).toBeInTheDocument());
    expect(
      queryClient.getQueryData<CustomerFavorites>(
        queryKeys.customer.favorites.ids('demo:cliente@ejemplo.com'),
      )?.favoriteProductIds,
    ).toEqual(['platanito-roll', 'calientito-roll']);
  });

  it.each([
    [422, 'FAVORITES_LIMIT_REACHED', /máximo de 200 favoritos/],
    [404, 'PRODUCT_NOT_FOUND', /ya no está disponible para guardarlo/],
    [429, 'RATE_LIMITED', /Demasiados intentos/],
    [503, 'FAVORITES_BUSY', /procesando muchos cambios/],
  ])('error %s %s: aviso claro y rollback', async (status, code, message) => {
    const user = userEvent.setup();
    const { spy, signIn } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Dumplings', false)).toBeInTheDocument());
    const gate = spy.hold('PUT', ITEM);
    await user.click(heart('Dumplings'));
    await waitFor(() => expect(gate.held()).toBe(true));
    gate.fail(new ApiError(status, 'x', 'mensaje técnico', undefined, undefined, code));
    expect(await screen.findByText(message)).toBeVisible();
    await waitFor(() => expect(heart('Dumplings', false)).toBeInTheDocument());
  });

  it('401: descarta los datos del cliente y abre el inicio de sesión', async () => {
    const user = userEvent.setup();
    const { spy, signIn, api } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Dumplings', false)).toBeInTheDocument());
    const gate = spy.hold('PUT', ITEM);
    await user.click(heart('Dumplings'));
    await waitFor(() => expect(gate.held()).toBe(true));
    gate.fail(new ApiError(401, 'unauthorized', 'No autenticado'));
    expect(await screen.findByText(/Tu sesión terminó/)).toBeVisible();
    await waitFor(() => expect(api().shell.authOpen).toBe(true));
  });
});

describe('rendimiento y aislamiento (P1-D, seguridad)', () => {
  it('togglear A no re-renderiza a B ni a C (suscripción por producto)', async () => {
    const user = userEvent.setup();
    const { signIn } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Platanito Roll', true)).toBeInTheDocument());
    await waitFor(() => expect(heart('Dumplings')).not.toHaveAttribute('aria-busy'));
    const before = { ...renders };
    await user.click(heart('Dumplings'));
    expect(await screen.findByText('Dumplings está en tus favoritos')).toBeVisible();
    await waitFor(() => expect(heart('Dumplings')).not.toHaveAttribute('aria-busy'));
    expect(renders['dumplings']).toBeGreaterThan(before['dumplings'] ?? 0);
    for (const other of ['platanito-roll', 'calientito-roll', 'gaseosas']) {
      expect(renders[other], other).toBe(before[other]);
    }
  });

  it('una mutación en vuelo al cambiar de cuenta no escribe en la caché del scope nuevo ni recrea la anterior', async () => {
    const user = userEvent.setup();
    const { spy, signIn, queryClient } = await setup();
    await signIn();
    await waitFor(() => expect(heart('Dumplings', false)).toBeInTheDocument());
    const gate = spy.hold('PUT', ITEM);
    await user.click(heart('Dumplings'));
    await waitFor(() => expect(gate.held()).toBe(true));

    await signIn(OTHER);
    await waitFor(() => expect(heart('Platanito Roll', false)).toBeInTheDocument());
    const otherKey = queryKeys.customer.favorites.ids('demo:invitado.nuevo@ejemplo.com');
    await waitFor(() => expect(queryClient.getQueryData(otherKey)).toBeDefined());
    gate.fail(new ApiError(503, 'x', 'x', undefined, undefined, 'CATALOG_UNAVAILABLE'));
    expect(await screen.findByText(/Favoritos no está disponible por ahora/)).toBeVisible();
    await waitFor(() => expect(heart('Dumplings')).not.toHaveAttribute('aria-busy'));
    expect(queryClient.getQueryData<CustomerFavorites>(otherKey)?.favoriteProductIds).toEqual([]);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[1] === 'demo:cliente@ejemplo.com'),
    ).toEqual([]);
    expect(heart('Dumplings', false)).toBeInTheDocument();
  });
});
