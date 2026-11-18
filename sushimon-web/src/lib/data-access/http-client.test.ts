import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { getHealth } from './health';
import { createHttpClient } from './http-client';

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('createHttpClient (contrato F00)', () => {
  it('lee /v1/health con el tipo generado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ status: 'ok' }, 200));
    const client = createHttpClient('http://api.test', fetchMock);
    await expect(getHealth(client)).resolves.toEqual({ status: 'ok' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/v1/health');
  });

  it('normaliza ErrorResponse a ApiError con requestId y details', async () => {
    const body = {
      statusCode: 400,
      error: 'BAD_REQUEST',
      message: 'Solicitud inválida',
      requestId: 'req-12345678',
      details: ['name must be a string'],
    };
    const client = createHttpClient('http://api.test', vi.fn().mockResolvedValue(json(body, 400)));
    const error = await getHealth(client).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'bad_request',
      requestId: 'req-12345678',
      details: ['name must be a string'],
    });
  });

  it('usa X-Request-Id de la respuesta si el cuerpo no lo trae', async () => {
    const res = json({ message: 'x' }, 503, { 'x-request-id': 'hdr-12345678' });
    const client = createHttpClient('http://api.test', vi.fn().mockResolvedValue(res));
    await expect(getHealth(client)).rejects.toMatchObject({ requestId: 'hdr-12345678' });
  });

  it('sin conexión → ApiError offline (sin fallback a mock)', async () => {
    const client = createHttpClient(
      'http://api.test',
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );
    await expect(getHealth(client)).rejects.toMatchObject({ status: 0, code: 'offline' });
  });

  describe('autenticación', () => {
    const ok = () => json({ status: 'ok' }, 200);
    const unauthorized = () =>
      json({ statusCode: 401, error: 'UNAUTHORIZED', message: 'No autenticado' }, 401);
    const headersOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
      (fetchMock.mock.calls[call]?.[1] as RequestInit).headers as
        Record<string, string> | undefined;

    it('envía Bearer solo cuando hay sesión y nunca cookies', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok()));
      const withSession = createHttpClient('http://api.test', fetchMock, {
        getAccessToken: () => Promise.resolve('tok-1'),
        onUnauthorized: () => Promise.resolve(false),
      });
      await getHealth(withSession);
      expect(headersOf(fetchMock, 0)?.authorization).toBe('Bearer tok-1');
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe('omit');

      const anonymous = createHttpClient('http://api.test', fetchMock, {
        getAccessToken: () => Promise.resolve(null),
        onUnauthorized: () => Promise.resolve(false),
      });
      await getHealth(anonymous);
      expect(headersOf(fetchMock, 1)).toBeUndefined();
    });

    it('ante 401 renueva la sesión y reintenta UNA vez con el token nuevo', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());
      let token = 'viejo';
      const client = createHttpClient('http://api.test', fetchMock, {
        getAccessToken: () => Promise.resolve(token),
        onUnauthorized: () => {
          token = 'nuevo';
          return Promise.resolve(true);
        },
      });
      await expect(getHealth(client)).resolves.toEqual({ status: 'ok' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(headersOf(fetchMock, 1)?.authorization).toBe('Bearer nuevo');
    });

    it('si la renovación falla (sesión expirada) lanza 401 sin reintentar', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(unauthorized()));
      const onUnauthorized = vi.fn().mockResolvedValue(false);
      const client = createHttpClient('http://api.test', fetchMock, {
        getAccessToken: () => Promise.resolve('tok'),
        onUnauthorized,
      });
      await expect(getHealth(client)).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('un 401 sin token no intenta renovar', async () => {
      const onUnauthorized = vi.fn();
      const client = createHttpClient(
        'http://api.test',
        vi.fn().mockImplementation(() => Promise.resolve(unauthorized())),
        { getAccessToken: () => Promise.resolve(null), onUnauthorized },
      );
      await expect(getHealth(client)).rejects.toMatchObject({ status: 401 });
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it('si el reintento también da 401, no entra en bucle', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(unauthorized()));
      const client = createHttpClient('http://api.test', fetchMock, {
        getAccessToken: () => Promise.resolve('tok'),
        onUnauthorized: () => Promise.resolve(true),
      });
      await expect(getHealth(client)).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('lecturas públicas (F17)', () => {
    const ok = () => Promise.resolve(Response.json({ status: 'ok' }));
    const session = {
      getAccessToken: () => Promise.resolve('tok-secreto'),
      onUnauthorized: () => Promise.resolve(false),
    };
    const initOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
      fetchMock.mock.calls[call]?.[1] as RequestInit;

    it('con `public: true` no adjunta Authorization ni fuerza cache no-store (respeta el Cache-Control del servidor)', async () => {
      const fetchMock = vi.fn().mockImplementation(ok);
      const client = createHttpClient('http://api.test', fetchMock, session);
      await client.get('/v1/store/bootstrap', { public: true });
      const init = initOf(fetchMock, 0);
      expect(init.headers).toBeUndefined();
      expect(init).not.toHaveProperty('cache');
      expect(init.credentials).toBe('omit');
    });

    it('las lecturas privadas siguen con Authorization y sin caché del navegador', async () => {
      const fetchMock = vi.fn().mockImplementation(ok);
      const client = createHttpClient('http://api.test', fetchMock, session);
      await client.get('/v1/me/favorites');
      const init = initOf(fetchMock, 0);
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-secreto');
      expect(init.cache).toBe('no-store');
    });

    it('una lectura pública no consulta la sesión (la respuesta no puede depender de ella)', async () => {
      const getAccessToken = vi.fn().mockResolvedValue('tok');
      const client = createHttpClient('http://api.test', vi.fn().mockImplementation(ok), {
        getAccessToken,
        onUnauthorized: () => Promise.resolve(false),
      });
      await client.get('/v1/store/menu', { public: true });
      expect(getAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('F20: cabeceras del llamador (Idempotency-Key, X-Order-Token)', () => {
    const none = {
      getAccessToken: () => Promise.resolve(null),
      onUnauthorized: () => Promise.resolve(false),
    };

    it('las envía tal cual (en minúsculas) junto al cuerpo JSON y sin tocar la sesión del cliente', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }, 201));
      const client = createHttpClient('http://api.test', fetchMock, {
        getAccessToken: () => Promise.resolve('tok-sesion'),
        onUnauthorized: () => Promise.resolve(false),
      });
      await client.request('/v1/orders', {
        method: 'POST',
        body: { a: 1 },
        headers: { 'Idempotency-Key': 'k'.repeat(22), 'X-Order-Token': 'smo_x' },
      });
      const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<
        string,
        string
      >;
      expect(headers['idempotency-key']).toBe('k'.repeat(22));
      expect(headers['x-order-token']).toBe('smo_x');
      expect(headers['content-type']).toBe('application/json');
      expect(headers['authorization']).toBe('Bearer tok-sesion');
    });

    it('no puede reemplazar Authorization ni Content-Type', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json({}, 200));
      const client = createHttpClient('http://api.test', fetchMock, {
        getAccessToken: () => Promise.resolve('tok-real'),
        onUnauthorized: () => Promise.resolve(false),
      });
      await client.request('/v1/orders', {
        method: 'POST',
        body: {},
        headers: { Authorization: 'Bearer falso', 'Content-Type': 'text/plain' },
      });
      const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<
        string,
        string
      >;
      expect(headers['authorization']).toBe('Bearer tok-real');
      expect(headers['content-type']).toBe('application/json');
    });

    it('nunca registra las cabeceras (ni en consola ni en el mensaje del error)', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => undefined),
      );
      const fetchMock = vi.fn().mockResolvedValue(json({ message: 'no' }, 409));
      const client = createHttpClient('http://api.test', fetchMock, none);
      const error = await client
        .request('/v1/orders', {
          method: 'POST',
          body: {},
          headers: { 'Idempotency-Key': 'SECRETA-'.repeat(4), 'X-Order-Token': 'smo_SECRETO' },
        })
        .catch((e: unknown) => e as ApiError);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(JSON.stringify({ m: (error as ApiError).message })).not.toMatch(/SECRET/);
      spies.forEach((s) => s.mockRestore());
    });

    it('expone el cuerpo del error (OrderQuoteConflict) y Retry-After', async () => {
      const conflict = {
        statusCode: 409,
        message: 'x',
        code: 'QUOTE_CHANGED',
        changes: [],
        quote: { total: '90.00' },
      };
      const fetchMock = vi.fn().mockResolvedValue(json(conflict, 409, { 'retry-after': '3' }));
      const client = createHttpClient('http://api.test', fetchMock, none);
      const error = (await client
        .request('/v1/orders', { method: 'POST', body: {} })
        .catch((e: unknown) => e)) as ApiError;
      expect(error).toMatchObject({
        status: 409,
        businessCode: 'QUOTE_CHANGED',
        retryAfterSec: 3,
        body: conflict,
      });
    });
  });
});
