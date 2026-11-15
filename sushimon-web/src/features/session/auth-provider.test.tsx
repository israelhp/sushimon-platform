import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenSource } from '@/lib/auth/token-source';
import { AuthProvider, useAuth } from './auth-provider';

type AuthListener = (event: string, session: { access_token: string } | null) => void;

const fake = vi.hoisted(() => {
  const state = {
    session: null as { access_token: string } | null,
    listener: null as null | ((event: string, session: { access_token: string } | null) => void),
    refreshResult: {
      data: { session: null as { access_token: string } | null },
      error: null as unknown,
    },
    signInWithOAuth: vi.fn(
      (args: unknown) => (void args, Promise.resolve({ error: null as unknown })),
    ),
    signOut: vi.fn((args?: unknown) => (void args, Promise.resolve({ error: null }))),
    unsubscribe: vi.fn(),
  };
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: state.session } }),
      onAuthStateChange: (cb: AuthListener) => {
        state.listener = cb;
        return { data: { subscription: { unsubscribe: state.unsubscribe } } };
      },
      refreshSession: () => Promise.resolve(state.refreshResult),
      signInWithOAuth: (args: unknown) => state.signInWithOAuth(args),
      signOut: (args?: unknown) => state.signOut(args),
    },
  };
  return { state, client };
});

vi.mock('@/lib/auth/supabase-browser', () => ({ getSupabaseBrowserClient: () => fake.client }));

const config = {
  kind: 'supabase',
  supabaseUrl: 'http://127.0.0.1:54341',
  publishableKey: 'pk',
} as const;

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="mode">{auth.mode}</span>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="expired">{String(auth.expired)}</span>
      <button onClick={() => void auth.signInWithGoogle('/cuenta')}>login</button>
      <button onClick={() => void auth.signOut()}>logout</button>
    </div>
  );
}

let currentQc = new QueryClient();

function wrap(children: ReactNode, cfg: Parameters<typeof AuthProvider>[0]['config']) {
  const qc = (currentQc = new QueryClient());
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider config={cfg}>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    fake.state.session = null;
    fake.state.refreshResult = { data: { session: null }, error: null };
    fake.state.signInWithOAuth.mockClear();
    fake.state.signOut.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('cerrar sesión limpia explícitamente la caché del cliente (`customer`), la de cuenta y la de auth', async () => {
    fake.state.session = { access_token: 'tok' };
    render(wrap(<Probe />, config));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    for (const key of [
      ['customer', 'uid-1', 'favorites', 'ids'],
      ['account', 'me'],
      ['auth', 'me'],
      ['store', 'config'],
    ]) {
      currentQc.setQueryData(key, { x: 1 });
    }
    await act(async () => screen.getByText('logout').click());
    expect(currentQc.getQueryData(['customer', 'uid-1', 'favorites', 'ids'])).toBeUndefined();
    expect(currentQc.getQueryData(['account', 'me'])).toBeUndefined();
    expect(currentQc.getQueryData(['auth', 'me'])).toBeUndefined();
    expect(currentQc.getQueryData(['store', 'config'])).toEqual({ x: 1 }); // lo público no se toca
  });

  it('auth mock: inerte, sin tocar Supabase', () => {
    render(wrap(<Probe />, { kind: 'mock' }));
    expect(screen.getByTestId('mode').textContent).toBe('mock');
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('sin sesión → anonymous; con sesión existente → authenticated', async () => {
    render(wrap(<Probe />, config));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'));
  });

  it('reconoce la sesión guardada al montar', async () => {
    fake.state.session = { access_token: 'tok' };
    render(wrap(<Probe />, config));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
  });

  it('expone el token vigente al cliente HTTP', async () => {
    fake.state.session = { access_token: 'tok-1' };
    render(wrap(<Probe />, config));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    await expect(tokenSource.getAccessToken()).resolves.toBe('tok-1');
  });

  it('inicia Google con PKCE hacia /auth/callback y un destino interno seguro', async () => {
    render(wrap(<Probe />, config));
    await act(async () => screen.getByText('login').click());
    expect(fake.state.signInWithOAuth).toHaveBeenCalledTimes(1);
    const args = fake.state.signInWithOAuth.mock.calls[0]?.[0] as unknown as {
      provider: string;
      options: { redirectTo: string };
    };
    expect(args.provider).toBe('google');
    expect(args.options.redirectTo).toBe(`${window.location.origin}/auth/callback?next=%2Fcuenta`);
  });

  it('expiración: si el token de refresco falla, cierra la sesión local y avisa', async () => {
    fake.state.session = { access_token: 'viejo' };
    fake.state.refreshResult = {
      data: { session: null },
      error: new Error('refresh_token_not_found'),
    };
    render(wrap(<Probe />, config));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    await act(async () => {
      await expect(tokenSource.onUnauthorized()).resolves.toBe(false);
      fake.state.listener?.('SIGNED_OUT', null);
    });
    expect(fake.state.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
    expect(screen.getByTestId('expired').textContent).toBe('true');
  });

  it('renovación correcta: devuelve true para reintentar y mantiene la sesión', async () => {
    fake.state.session = { access_token: 'viejo' };
    fake.state.refreshResult = { data: { session: { access_token: 'nuevo' } }, error: null };
    render(wrap(<Probe />, config));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    await expect(tokenSource.onUnauthorized()).resolves.toBe(true);
    expect(screen.getByTestId('expired').textContent).toBe('false');
  });

  it('cerrar sesión por voluntad propia NO se marca como expirada', async () => {
    fake.state.session = { access_token: 'tok' };
    render(wrap(<Probe />, config));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    await act(async () => {
      screen.getByText('logout').click();
      fake.state.listener?.('SIGNED_OUT', null);
    });
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
    expect(screen.getByTestId('expired').textContent).toBe('false');
  });

  it('al desmontar se desinstala el origen de tokens', async () => {
    fake.state.session = { access_token: 'tok' };
    const { unmount } = render(wrap(<Probe />, config));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    unmount();
    await expect(tokenSource.getAccessToken()).resolves.toBeNull();
    expect(fake.state.unsubscribe).toHaveBeenCalled();
  });
});
