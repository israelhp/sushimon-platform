import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claims = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getClaims: () => Promise.resolve({ data: claims.value ? { claims: claims.value } : null }),
    },
  }),
}));

import { proxy } from './proxy';

const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe('proxy (sesión Supabase)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_SOURCE', 'supabase');
    vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'http');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54341');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pk');
    claims.value = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sin sesión, el backoffice redirige al login conservando el destino', async () => {
    const res = await proxy(req('/backoffice/pedidos?x=1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/backoffice/login?next=%2Fbackoffice%2Fpedidos%3Fx%3D1',
    );
  });

  it('el login del backoffice y la tienda pública no se redirigen', async () => {
    expect((await proxy(req('/backoffice/login'))).headers.get('location')).toBeNull();
    expect((await proxy(req('/menu'))).headers.get('location')).toBeNull();
  });

  it('con sesión válida deja pasar el backoffice (la API autoriza)', async () => {
    claims.value = { sub: 'u1', aal: 'aal2' };
    expect((await proxy(req('/backoffice/pedidos'))).headers.get('location')).toBeNull();
  });

  describe('MFA (claim aal)', () => {
    it('sesión aal1 en una ruta del backoffice → verificación MFA conservando el destino', async () => {
      claims.value = { sub: 'u1', aal: 'aal1' };
      const res = await proxy(req('/backoffice/pedidos'));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe(
        'http://localhost:3000/backoffice/mfa/verify?next=%2Fbackoffice%2Fpedidos',
      );
    });

    it('sin claim aal también cuenta como aal1', async () => {
      claims.value = { sub: 'u1' };
      expect((await proxy(req('/backoffice'))).headers.get('location')).toContain(
        '/backoffice/mfa/verify',
      );
    });

    it.each([
      '/backoffice/login',
      '/backoffice/mfa/setup',
      '/backoffice/mfa/verify',
      '/backoffice/access-denied',
    ])('las pantallas previas (%s) son accesibles en aal1 sin bucle', async (path) => {
      claims.value = { sub: 'u1', aal: 'aal1' };
      expect((await proxy(req(path))).headers.get('location')).toBeNull();
    });

    it('sin sesión, las pantallas MFA y de acceso denegado van al login', async () => {
      const res = await proxy(req('/backoffice/mfa/setup'));
      expect(res.headers.get('location')).toContain('/backoffice/login');
    });

    it('aal2 pasa; la API sigue decidiendo', async () => {
      claims.value = { sub: 'u1', aal: 'aal2' };
      expect((await proxy(req('/backoffice/pedidos'))).headers.get('location')).toBeNull();
    });

    it('el backoffice no se cachea; la tienda pública no se toca', async () => {
      claims.value = { sub: 'u1', aal: 'aal2' };
      expect((await proxy(req('/backoffice/pedidos'))).headers.get('cache-control')).toBe(
        'private, no-store',
      );
      expect((await proxy(req('/backoffice/pedidos?x'))).status).toBe(200);
      expect((await proxy(req('/menu'))).headers.get('cache-control')).toBeNull();
    });
  });

  it('con auth mock no hace nada', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_SOURCE', 'mock');
    vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'mock');
    expect((await proxy(req('/backoffice/pedidos'))).headers.get('location')).toBeNull();
  });
});
