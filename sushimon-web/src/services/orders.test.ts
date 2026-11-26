import { describe, expect, it, vi } from 'vitest';
import { withShortcuts, type RequestOptions } from '@/lib/data-access/types';
import {
  createOrder,
  getOrder,
  getOrderReceipt,
  getOrderTracking,
  listMyOrders,
  previewOrderReorder,
} from './orders';

/** F20: los services solo componen la solicitud (ruta, método, cuerpo y cabeceras); no calculan nada. */
function spy() {
  const request = vi.fn(async (_path: string, _o?: RequestOptions) => ({}) as never);
  return { request, client: withShortcuts('http', request) };
}
const body = {
  cart: { branchId: 'b', lines: [] },
  fulfillment: { type: 'DELIVERY' as const, municipalityId: 'm1', zone: null },
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

describe('services/orders (F23)', () => {
  const ID = '0b0f6c9e-1111-4222-8333-444455556666';

  it('listMyOrders: GET /v1/me/orders con status en csv, fechas con zona, cursor y límite; nunca /v1/demo ni customerId', async () => {
    const { client, request } = spy();
    await listMyOrders(
      client,
      {
        status: ['pending', 'accepted'],
        branchId: 'b1',
        from: '2026-11-01T00:00:00-06:00',
        to: '2026-12-01T00:00:00-06:00',
        limit: 20,
      },
      'cursor-1',
    );
    await listMyOrders(client);
    const [first, second] = request.mock.calls;
    expect(first?.[0]).toBe('/v1/me/orders');
    expect(first?.[1]).toMatchObject({
      method: 'GET',
      query: {
        status: 'pending,accepted',
        branchId: 'b1',
        from: '2026-11-01T00:00:00-06:00',
        to: '2026-12-01T00:00:00-06:00',
        limit: 20,
        cursor: 'cursor-1',
      },
    });
    expect(Object.keys(first?.[1]?.query ?? {})).not.toContain('customerId');
    expect(second?.[1]?.query).toMatchObject({ status: undefined, cursor: undefined });
  });

  it('getOrderReceipt: GET con la credencial SOLO en X-Order-Token (nunca en la URL) y solo si existe', async () => {
    const { client, request } = spy();
    await getOrderReceipt(client, ID, { guestToken: 'smo_abc' });
    await getOrderReceipt(client, ID);
    const [first, second] = request.mock.calls;
    expect(first?.[0]).toBe(`/v1/orders/${ID}/receipt`);
    expect(first?.[0]).not.toContain('smo_');
    expect(first?.[1]).toMatchObject({ method: 'GET', headers: { 'X-Order-Token': 'smo_abc' } });
    expect(second?.[1]).not.toHaveProperty('headers');
  });

  it('previewOrderReorder: POST sin Idempotency-Key; cuerpo {} o solo { branchId }; sin precios, líneas ni cantidades', async () => {
    const { client, request } = spy();
    await previewOrderReorder(client, ID);
    await previewOrderReorder(client, ID, { branchId: 'b2', guestToken: 'smo_abc' });
    const [first, second] = request.mock.calls;
    expect(first?.[0]).toBe(`/v1/orders/${ID}/reorder-preview`);
    expect(first?.[1]).toMatchObject({ method: 'POST', body: {} });
    expect(first?.[1]).not.toHaveProperty('headers');
    expect(second?.[1]).toMatchObject({
      method: 'POST',
      body: { branchId: 'b2' },
      headers: { 'X-Order-Token': 'smo_abc' },
    });
    expect(JSON.stringify(second?.[1]?.headers)).not.toContain('Idempotency');
  });

  it('F23 no añade PDF ni descargas: ninguna ruta /pdf ni dependencia de PDF', async () => {
    const { paths } = await import('@/lib/data-access/paths');
    for (const build of Object.values(paths)) {
      expect((build as (id: string) => string)('X').toLowerCase()).not.toContain('pdf');
    }
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => /pdf|jspdf|html2canvas|puppeteer/i.test(n))).toEqual([]);
  });
});
