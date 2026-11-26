import { describe, expect, it, vi } from 'vitest';
import { createHttpClient } from '@/lib/data-access/http-client';
import type { DataClient } from '@/lib/data-access/types';
import { withShortcuts } from '@/lib/data-access/types';
import { quoteCheckout } from './checkout';

const body = {
  cart: { branchId: 'b', lines: [{ productId: 'p', quantity: 1, selections: [] }] },
  fulfillment: { type: 'DELIVERY' as const, municipalityId: 'm1', zone: null },
};

describe('services/checkout · quoteCheckout', () => {
  it('POST /v1/checkout/quote con el cuerpo tal cual, el signal y NUNCA `public`', async () => {
    const request = vi.fn().mockResolvedValue({});
    const client = withShortcuts('mock', request) as DataClient;
    const controller = new AbortController();
    await quoteCheckout(client, body, controller.signal);
    expect(request).toHaveBeenCalledWith('/v1/checkout/quote', {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty('public');
  });

  it('con sesión envía Authorization y sin sesión no; sin caché del navegador (privada)', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ canProceed: true }));
    const withToken = createHttpClient(
      'http://api.test',
      fetchImpl as unknown as typeof fetch,
      {
        getAccessToken: async () => 'tok',
      } as never,
    );
    await quoteCheckout(withToken, body);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/v1/checkout/quote');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer tok',
      'content-type': 'application/json',
    });
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body as string)).toEqual(body);

    const guest = createHttpClient(
      'http://api.test',
      fetchImpl as unknown as typeof fetch,
      {
        getAccessToken: async () => null,
      } as never,
    );
    await quoteCheckout(guest, body);
    const [, guestInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(guestInit.headers).not.toHaveProperty('authorization');
  });
});
