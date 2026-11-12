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
});
