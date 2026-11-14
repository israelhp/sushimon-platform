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
});
