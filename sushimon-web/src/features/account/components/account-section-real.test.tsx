import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthApi } from '@/features/session/auth-provider';
import { withShortcuts, type DataClient } from '@/lib/data-access/types';
import { renderStore } from '@/test/store-providers';
import { AddressesPage } from './AddressesPage';
import { AccountHub } from './AccountHub';

// Supabase Auth SIMULADO (sin red): `AUTH_SOURCE=supabase` + `DATA_SOURCE=http`, sin sesión de demostración.
const auth = vi.hoisted(() => ({
  api: {
    mode: 'supabase',
    status: 'anonymous',
    expired: false,
    acknowledgeExpired: () => undefined,
    signInWithGoogle: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  } as AuthApi,
  identity: {
    data: undefined as { authUserId: string; customer: unknown; email: string } | undefined,
    isError: false,
    isPending: false,
  },
}));
vi.mock('@/features/session/auth-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/session/auth-provider')>()),
  useAuth: () => auth.api,
}));
vi.mock('@/features/session/auth-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/session/auth-queries')>()),
  useIdentity: () => auth.identity,
}));

const IDENTITY = {
  authUserId: 'uuid-real-1',
  customer: { id: 'c1', fullName: 'Real Cliente', phone: null, email: 'real@ejemplo.com' },
  email: 'real@ejemplo.com',
};

/** La API real: perfil y direcciones (vacías). Cualquier otra ruta falla como en `http` sin módulo. */
const realApi = (calls: string[]) => (): DataClient =>
  withShortcuts('http', async (path) => {
    calls.push(path);
    if (path === '/v1/me') return { customer: IDENTITY.customer, email: IDENTITY.email } as never;
    if (path === '/v1/me/addresses') return { items: [] } as never;
    if (path === '/v1/me/favorites') {
      return {
        favoriteProductIds: [],
        total: 0,
        limit: 200,
        items: [],
        page: 1,
        pageSize: 0,
        catalogStatus: 'AVAILABLE',
      } as never;
    }
    throw new Error(`sin módulo en la API: ${path}`);
  });

beforeEach(() => {
  window.localStorage.clear();
  auth.api = { ...auth.api, mode: 'supabase', status: 'anonymous' };
  auth.identity = { data: undefined, isError: false, isPending: false };
});

describe('Mi cuenta con Supabase Auth real (identidad real, sin sesión demo)', () => {
  it('invitado: Mis direcciones pide iniciar sesión y no consulta la API', async () => {
    const calls: string[] = [];
    await renderStore(<AddressesPage />, { wrapClient: realApi(calls) });
    expect(
      screen.getByRole('heading', { name: 'Iniciá sesión para usar esta sección' }),
    ).toBeVisible();
    expect(calls.filter((p) => p.startsWith('/v1/me'))).toEqual([]);
  });

  it('identidad resolviéndose: muestra carga (no la invitación a entrar)', async () => {
    auth.api = { ...auth.api, status: 'authenticated' };
    auth.identity = { data: undefined, isError: false, isPending: true };
    await renderStore(<AddressesPage />, { wrapClient: realApi([]) });
    expect(screen.queryByRole('heading', { name: /Iniciá sesión/ })).not.toBeInTheDocument();
    expect(screen.getByText('Cargando tu cuenta…')).toBeVisible();
  });

  it('sesión real: Mis direcciones se habilita y consulta perfil y direcciones (estado vacío, no bloqueado)', async () => {
    auth.api = { ...auth.api, status: 'authenticated' };
    auth.identity = { data: IDENTITY, isError: false, isPending: false };
    const calls: string[] = [];
    await renderStore(<AddressesPage />, { wrapClient: realApi(calls) });
    await waitFor(() => expect(calls).toContain('/v1/me/addresses'));
    expect(calls).toContain('/v1/me');
    expect(
      screen.queryByRole('heading', { name: 'Iniciá sesión para usar esta sección' }),
    ).not.toBeInTheDocument();
    // Sin pedidos del cliente (F20 sin API): el hub real no los consulta.
    expect(calls).not.toContain('/v1/me/orders');
  });

  it('hub real: perfil con secciones de datos, direcciones y favoritos; sin pedidos simulados ni insignia', async () => {
    auth.api = { ...auth.api, status: 'authenticated' };
    auth.identity = { data: IDENTITY, isError: false, isPending: false };
    const calls: string[] = [];
    await renderStore(<AccountHub />, { wrapClient: realApi(calls) });
    expect(await screen.findByText('Real Cliente')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mis direcciones/ })).toHaveAttribute(
      'href',
      '/cuenta/direcciones',
    );
    expect(screen.queryByRole('link', { name: /Mis pedidos/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Simulación')).not.toBeInTheDocument();
    expect(calls).not.toContain('/v1/me/orders');
  });
});
