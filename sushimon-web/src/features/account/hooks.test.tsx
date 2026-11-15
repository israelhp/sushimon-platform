import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/features/query-keys';
import type { AuthApi } from '@/features/session/auth-provider';
import { withShortcuts } from '@/lib/data-access/types';
import { createSpyClient } from '@/test/spy-client';
import { renderStore } from '@/test/store-providers';
import { useAddresses, useMe, useMyOrders } from './hooks';

// Auth simulada: `useAuth` y `useIdentity` se controlan por prueba (sin Supabase real).
const auth = vi.hoisted(() => ({
  api: {
    mode: 'mock',
    status: 'anonymous',
    expired: false,
    acknowledgeExpired: () => undefined,
    signInWithGoogle: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  } as AuthApi,
  identity: { data: undefined as { authUserId: string } | undefined, isError: false },
}));
vi.mock('@/features/session/auth-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/session/auth-provider')>()),
  useAuth: () => auth.api,
}));
vi.mock('@/features/session/auth-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/session/auth-queries')>()),
  useIdentity: () => auth.identity,
}));

const A = { email: 'cliente@ejemplo.com', name: 'Cliente Demo' };
const B = { email: 'invitado.nuevo@ejemplo.com', name: 'Invitado Nuevo' };

function Probe() {
  const me = useMe();
  const addresses = useAddresses();
  const orders = useMyOrders();
  return (
    <p data-testid="probe">
      {[me.status, addresses.status, orders.status].join('|')}
      {me.data ? `|${me.data.email}` : ''}
    </p>
  );
}

beforeEach(() => {
  auth.api = { ...auth.api, mode: 'mock', status: 'anonymous' };
  auth.identity = { data: undefined, isError: false };
  window.localStorage.clear();
});

describe('cuenta del cliente con auth mock (comportamiento demo intacto)', () => {
  it('sin sesión no consulta nada; con sesión demo consulta con la identidad en la clave', async () => {
    const spy = createSpyClient();
    const view = await renderStore(<Probe />, { wrapClient: spy.wrap });
    spy.calls.length = 0;
    expect(screen.getByTestId('probe')).toHaveTextContent('pending|pending|pending');
    expect(spy.calls).toHaveLength(0);

    await act(async () => view.api().session.signInCustomer(A));
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent(/success\|success\|success\|/),
    );
    const scope = `demo:${A.email}`;
    expect(view.queryClient.getQueryData(queryKeys.customer.account.me(scope))).toBeDefined();
    expect(
      view.queryClient.getQueryData(queryKeys.customer.account.addresses(scope)),
    ).toBeDefined();
    expect(view.queryClient.getQueryData(queryKeys.customer.orders.mine(scope))).toBeDefined();
    expect(spy.count('GET', /^\/v1\/me$/)).toBe(1);
  });

  it('cambiar de cuenta o cerrar sesión descarta la caché de la anterior (F04: no mezcla cuentas)', async () => {
    const view = await renderStore(<Probe />);
    await act(async () => view.api().session.signInCustomer(A));
    await waitFor(() =>
      expect(
        view.queryClient.getQueryData(queryKeys.customer.account.me(`demo:${A.email}`)),
      ).toBeDefined(),
    );

    await act(async () => view.api().session.signInCustomer(B));
    await waitFor(() =>
      expect(
        view.queryClient.getQueryData(queryKeys.customer.account.me(`demo:${B.email}`)),
      ).toBeDefined(),
    );
    expect(
      view.queryClient.getQueryData(queryKeys.customer.account.me(`demo:${A.email}`)),
    ).toBeUndefined();
    expect(
      view.queryClient.getQueryData(queryKeys.customer.account.addresses(`demo:${A.email}`)),
    ).toBeUndefined();

    await act(async () => view.api().session.signOutCustomer());
    await waitFor(() =>
      expect(
        view.queryClient.getQueryData(queryKeys.customer.account.me(`demo:${B.email}`)),
      ).toBeUndefined(),
    );
    // Solo quedan las consultas deshabilitadas del scope vacío (`none`): ninguna con datos de una cuenta.
    const leftovers = view.queryClient
      .getQueryCache()
      .findAll({ queryKey: queryKeys.customer.all })
      .filter((q) => q.queryKey[1] !== 'none');
    expect(leftovers).toEqual([]);
  });
});

describe('cuenta del cliente con Supabase Auth simulado (AUTH_SOURCE=supabase)', () => {
  /** Sirve `/v1/me` y `/v1/me/addresses` como la API real, sin sesión demo. */
  function realApi() {
    const spy = createSpyClient();
    const wrap: typeof spy.wrap = (base) =>
      withShortcuts('http', async (path, options) => {
        if (path === '/v1/me' && (options?.method ?? 'GET') === 'GET') {
          spy.calls.push({ method: 'GET', path, query: options?.query });
          return {
            customer: { id: 'c1', fullName: 'Real Cliente', phone: '5555-0000', email: null },
            email: 'real@ejemplo.com',
          } as never;
        }
        if (path === '/v1/me/addresses') {
          spy.calls.push({ method: 'GET', path, query: options?.query });
          return { items: [] } as never;
        }
        return spy.wrap(base).request(path, options);
      });
    return { spy, wrap };
  }

  it('invitado de Supabase: nada se consulta (la API respondería 401)', async () => {
    auth.api = { ...auth.api, mode: 'supabase', status: 'anonymous' };
    const { spy, wrap } = realApi();
    await renderStore(<Probe />, { wrapClient: wrap });
    spy.calls.length = 0;
    expect(screen.getByTestId('probe')).toHaveTextContent('pending|pending|pending');
    expect(spy.calls).toHaveLength(0);
  });

  it('sesión real con identidad conocida habilita perfil y direcciones SIN sesión demo', async () => {
    auth.api = { ...auth.api, mode: 'supabase', status: 'authenticated' };
    auth.identity = { data: { authUserId: 'uuid-real-1' }, isError: false };
    const { spy, wrap } = realApi();
    const view = await renderStore(<Probe />, { wrapClient: wrap });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/real@ejemplo.com/));
    expect(view.queryClient.getQueryData(queryKeys.customer.account.me('uuid-real-1'))).toEqual(
      expect.objectContaining({ email: 'real@ejemplo.com', fullName: 'Real Cliente' }),
    );
    expect(
      view.queryClient.getQueryData(queryKeys.customer.account.addresses('uuid-real-1')),
    ).toEqual([]);
    expect(spy.calls.some((c) => c.path === '/v1/me/addresses')).toBe(true);
  });

  it('identidad aún resolviéndose (pending): no se consulta; al resolverse otra cuenta no lee la caché ajena', async () => {
    auth.api = { ...auth.api, mode: 'supabase', status: 'authenticated' };
    auth.identity = { data: undefined, isError: false };
    const { spy, wrap } = realApi();
    const view = await renderStore(<Probe />, { wrapClient: wrap });
    expect(spy.calls.filter((c) => c.path.startsWith('/v1/me'))).toHaveLength(0);

    // Caché de otra cuenta: el guard la descarta y la clave propia nunca coincide con la ajena.
    view.queryClient.setQueryData(queryKeys.customer.account.me('uuid-otra'), {
      email: 'otra@x.com',
    });
    auth.identity = { data: { authUserId: 'uuid-real-2' }, isError: false };
    view.rerender(<Probe />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/real@ejemplo.com/));
    expect(
      view.queryClient.getQueryData(queryKeys.customer.account.me('uuid-otra')),
    ).toBeUndefined();
  });
});
