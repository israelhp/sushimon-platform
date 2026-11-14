import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchange = vi.hoisted(() => vi.fn());
const clientRef = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/lib/auth/supabase-server', () => ({
  createSupabaseServerClient: () => Promise.resolve(clientRef.value),
}));

import { GET } from './route';

const call = (qs: string) => GET(new NextRequest(`http://localhost:3000/auth/callback${qs}`));

describe('GET /auth/callback', () => {
  beforeEach(() => {
    exchange.mockReset().mockResolvedValue({ error: null });
    clientRef.value = { auth: { exchangeCodeForSession: exchange } };
  });

  it('canjea el código (PKCE) y vuelve al destino interno', async () => {
    const res = await call('?code=abc123&next=%2Fcuenta');
    expect(exchange).toHaveBeenCalledWith('abc123');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/cuenta');
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    'ignora un destino externo (%s) y vuelve al inicio',
    async (next) => {
      const res = await call(`?code=abc&next=${encodeURIComponent(next)}`);
      expect(res.headers.get('location')).toBe('http://localhost:3000/');
    },
  );

  it('sin código → error genérico, sin llamar a Supabase', async () => {
    const res = await call('?next=%2Fcuenta');
    expect(exchange).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('http://localhost:3000/?auth_error=missing_code');
  });

  it('error del proveedor → no expone su texto', async () => {
    const res = await call('?error=access_denied&error_description=secreto');
    expect(res.headers.get('location')).toBe('http://localhost:3000/?auth_error=provider');
    expect(res.headers.get('location')).not.toContain('secreto');
  });

  it('canje fallido → error genérico; en el backoffice vuelve al login', async () => {
    exchange.mockResolvedValue({ error: new Error('invalid grant') });
    const res = await call('?code=bad&next=%2Fbackoffice%2Fpedidos');
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/backoffice/login?auth_error=exchange_failed',
    );
  });

  it('auth no configurada → not_configured', async () => {
    clientRef.value = null;
    const res = await call('?code=abc');
    expect(res.headers.get('location')).toBe('http://localhost:3000/?auth_error=not_configured');
  });
});
