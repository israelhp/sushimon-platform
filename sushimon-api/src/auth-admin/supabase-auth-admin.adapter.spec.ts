import { AuthAdminProviderError } from './auth-admin.port.js';
import { SupabaseAuthAdminAdapter, type FetchLike } from './supabase-auth-admin.adapter.js';
import { selectAuthAdminAdapter } from './auth-admin.module.js';
import { UnavailableAuthAdminAdapter } from './unavailable-auth-admin.adapter.js';

const USER = 'aaaaaaaa-1111-4111-8111-000000000001';
const F1 = 'f0000000-0000-4000-8000-000000000001';
const KEY = 'service-role-key-de-prueba-0123456789';

function adapter(fetchFn: FetchLike) {
  return new SupabaseAuthAdminAdapter({
    supabaseUrl: 'https://proyecto.supabase.co/',
    serviceRoleKey: KEY,
    timeoutMs: 1000,
    fetchFn,
  });
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('SupabaseAuthAdminAdapter (sin red: fetch simulado)', () => {
  it('lista con GET /auth/v1/admin/users/{id}/factors y las cabeceras de servicio', async () => {
    const fetchFn = vi.fn<FetchLike>(() => json([{ id: F1, factor_type: 'totp' }]));
    await expect(adapter(fetchFn).listMfaFactors(USER)).resolves.toEqual([{ id: F1 }]);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://proyecto.supabase.co/auth/v1/admin/users/${USER}/factors`);
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, apikey: KEY });
    expect(init.redirect).toBe('error');
  });

  it('elimina con DELETE /auth/v1/admin/users/{id}/factors/{factorId}; 404 cuenta como éxito', async () => {
    const fetchFn = vi.fn<FetchLike>(() => json({}, 200));
    await adapter(fetchFn).deleteMfaFactor(USER, F1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://proyecto.supabase.co/auth/v1/admin/users/${USER}/factors/${F1}`);
    expect(init.method).toBe('DELETE');
    await expect(
      adapter(() => json({ msg: 'gone' }, 404)).deleteMfaFactor(USER, F1),
    ).resolves.toBeUndefined();
  });

  it.each([401, 403, 500])(
    'status %i => AuthAdminProviderError sin cuerpo ni clave',
    async (status) => {
      const error = await adapter(() => json({ msg: `secreto ${KEY}` }, status))
        .listMfaFactors(USER)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthAdminProviderError);
      expect(error).toMatchObject({ kind: 'http_status', status });
      expect(String((error as Error).message)).not.toContain(KEY);
      expect(String((error as Error).message)).not.toContain('secreto');
    },
  );

  it('respuestas malformadas, red caída y timeout se clasifican', async () => {
    await expect(adapter(() => json({ factors: [] })).listMfaFactors(USER)).rejects.toMatchObject({
      kind: 'bad_response',
    });
    await expect(
      adapter(() => json([{ id: 'no-uuid' }])).listMfaFactors(USER),
    ).rejects.toMatchObject({
      kind: 'bad_response',
    });
    await expect(
      adapter(() => Promise.resolve(new Response('no json', { status: 200 }))).listMfaFactors(USER),
    ).rejects.toMatchObject({ kind: 'bad_response' });
    await expect(
      adapter(() => Promise.reject(new TypeError(`fetch failed ${KEY}`))).listMfaFactors(USER),
    ).rejects.toMatchObject({ kind: 'network' });
    const timeout = Object.assign(new Error('x'), { name: 'TimeoutError' });
    await expect(adapter(() => Promise.reject(timeout)).listMfaFactors(USER)).rejects.toMatchObject(
      {
        kind: 'timeout',
      },
    );
  });

  it('rechaza ids que no son UUID sin hacer la llamada (sin inyección en la ruta)', async () => {
    const fetchFn = vi.fn<FetchLike>(() => json([]));
    await expect(adapter(fetchFn).listMfaFactors('../admin/users')).rejects.toBeInstanceOf(
      AuthAdminProviderError,
    );
    await expect(adapter(fetchFn).deleteMfaFactor(USER, '1/../../x')).rejects.toBeInstanceOf(
      AuthAdminProviderError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('selectAuthAdminAdapter', () => {
  const config = (values: Record<string, unknown>) => ({ get: (k: string) => values[k] }) as never;

  it('sin clave de servicio o sin SUPABASE_URL => adaptador «no disponible»', async () => {
    expect(
      selectAuthAdminAdapter(config({ SUPABASE_URL: 'https://x.supabase.co' })),
    ).toBeInstanceOf(UnavailableAuthAdminAdapter);
    expect(selectAuthAdminAdapter(config({ SUPABASE_SERVICE_ROLE_KEY: KEY }))).toBeInstanceOf(
      UnavailableAuthAdminAdapter,
    );
    await expect(new UnavailableAuthAdminAdapter().listMfaFactors()).rejects.toMatchObject({
      name: 'AuthAdminUnavailableError',
    });
  });

  it('con clave y URL => adaptador real', () => {
    expect(
      selectAuthAdminAdapter(
        config({
          SUPABASE_URL: 'https://x.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: KEY,
          SUPABASE_ADMIN_TIMEOUT_MS: 8000,
        }),
      ),
    ).toBeInstanceOf(SupabaseAuthAdminAdapter);
  });
});
