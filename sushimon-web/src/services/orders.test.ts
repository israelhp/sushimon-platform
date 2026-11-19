import { describe, expect, it, vi } from 'vitest';
import { withShortcuts, type RequestOptions } from '@/lib/data-access/types';
import { createOrder, getOrder, getOrderTracking } from './orders';

/** F20: los services solo componen la solicitud (ruta, método, cuerpo y cabeceras); no calculan nada. */
function spy() {
  const request = vi.fn(async (_path: string, _o?: RequestOptions) => ({}) as never);
  return { request, client: withShortcuts('http', request) };
}
const body = {
  cart: { branchId: 'b', lines: [] },
  fulfillment: { type: 'PICKUP' as const },
  quoteToken: 't',
};

describe('services/orders (F20)', () => {
  it('createOrder: POST /v1/orders con Idempotency-Key como cabecera, el cuerpo tal cual y el signal', async () => {
    const { client, request } = spy();
    const ctl = new AbortController();
    await createOrder(client, body, 'k'.repeat(22), ctl.signal);
    expect(request).toHaveBeenCalledWith('/v1/orders', {
      method: 'POST',
      body,
      signal: ctl.signal,
      headers: { 'Idempotency-Key': 'k'.repeat(22) },
    });
  });

  it('getOrder: GET por UUID; la credencial de invitado va en X-Order-Token (nunca en la URL) y solo si existe', async () => {
    const { client, request } = spy();
    await getOrder(client, '0b0f6c9e-1111-4222-8333-444455556666', { guestToken: 'smo_abc' });
    await getOrder(client, 'a b/c');
    const [first, second] = request.mock.calls;
    expect(first?.[0]).toBe('/v1/orders/0b0f6c9e-1111-4222-8333-444455556666');
    expect(first?.[1]).toMatchObject({ method: 'GET', headers: { 'X-Order-Token': 'smo_abc' } });
    expect(first?.[0]).not.toContain('smo_');
    expect(second?.[0]).toBe('/v1/orders/a%20b%2Fc');
    expect(second?.[1]).not.toHaveProperty('headers');
  });
});

describe('services/orders (F21)', () => {
  it('getOrderTracking: GET /v1/orders/{id}/tracking; la credencial va en X-Order-Token, nunca en la URL, y la lectura NUNCA es pública', async () => {
    const { client, request } = spy();
    const ctl = new AbortController();
    await getOrderTracking(client, '0b0f6c9e-1111-4222-8333-444455556666', {
      guestToken: 'smo_abc',
      signal: ctl.signal,
    });
    await getOrderTracking(client, 'a b/c', { guestToken: null });
    const [first, second] = request.mock.calls;
    expect(first?.[0]).toBe('/v1/orders/0b0f6c9e-1111-4222-8333-444455556666/tracking');
    expect(first?.[0]).not.toContain('smo_');
    expect(first?.[1]).toEqual({
      method: 'GET',
      signal: ctl.signal,
      headers: { 'X-Order-Token': 'smo_abc' },
    });
    expect(first?.[1]).not.toHaveProperty('public');
    expect(second?.[0]).toBe('/v1/orders/a%20b%2Fc/tracking');
    expect(second?.[1]).not.toHaveProperty('headers');
    expect(second?.[1]).not.toHaveProperty('public');
  });
});
