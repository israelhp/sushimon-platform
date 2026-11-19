import { describe, expect, it } from 'vitest';
import { createHttpClient } from '@/lib/data-access/http-client';
import {
  getAdminOrder,
  getAdminOrderBoard,
  listAdminOrders,
  runAdminOrderCommand,
  type AdminOrderCommand,
} from './admin-orders';

/** Cliente http con un `fetch` falso que anota cada solicitud (método, ruta, query y cuerpo). */
function recorder() {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Response.json({});
  }) as typeof fetch;
  return { calls, client: createHttpClient('http://api.test', fakeFetch) };
}

describe('services/admin-orders sobre http', () => {
  it('lecturas: rutas y filtros del contrato (status en csv, cursor, fechas con zona)', async () => {
    const { calls, client } = recorder();
    await getAdminOrderBoard(client, 'b1');
    await getAdminOrderBoard(client);
    await listAdminOrders(
      client,
      {
        branchId: 'b1',
        status: ['pending', 'accepted'],
        fulfillmentType: 'PICKUP',
        q: 'MON-001042',
        from: '2026-11-11T00:00:00-06:00',
        to: '2026-11-11T23:59:59.999-06:00',
        limit: 25,
      },
      'cur',
    );
    await getAdminOrder(client, 'a b');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/admin/orders/board',
      'GET /v1/admin/orders/board',
      'GET /v1/admin/orders',
      'GET /v1/admin/orders/a%20b',
    ]);
    expect(calls[0]!.search).toBe('?branchId=b1');
    expect(calls[1]!.search).toBe('');
    const q = new URLSearchParams(calls[2]!.search);
    expect(q.get('status')).toBe('pending,accepted');
    expect(q.get('cursor')).toBe('cur');
    expect(q.get('q')).toBe('MON-001042');
    expect(q.get('from')).toBe('2026-11-11T00:00:00-06:00');
  });

  it('los seis comandos: ruta POST propia y cuerpo estricto (reason solo en reject/cancel, recortado)', async () => {
    const { calls, client } = recorder();
    const commands: AdminOrderCommand[] = [
      'accept',
      'reject',
      'start-preparing',
      'mark-ready',
      'complete',
      'cancel',
    ];
    for (const command of commands) {
      await runAdminOrderCommand(client, {
        id: 'o1',
        command,
        expectedStatus: 'pending',
        reason: '  motivo  ',
      });
    }
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(
      commands.map((c) => `POST /v1/admin/orders/o1/${c}`),
    );
    expect(calls.map((c) => c.body)).toEqual([
      { expectedStatus: 'pending' },
      { expectedStatus: 'pending', reason: 'motivo' },
      { expectedStatus: 'pending' },
      { expectedStatus: 'pending' },
      { expectedStatus: 'pending' },
      { expectedStatus: 'pending', reason: 'motivo' },
    ]);
  });

  it('nunca toca las rutas legadas (/v1/backoffice/orders*, /v1/demo/*, despacho)', async () => {
    const { calls, client } = recorder();
    await getAdminOrderBoard(client);
    await listAdminOrders(client);
    await getAdminOrder(client, 'o1');
    await runAdminOrderCommand(client, { id: 'o1', command: 'accept', expectedStatus: 'pending' });
    for (const c of calls) expect(c.path).toMatch(/^\/v1\/admin\/orders/);
  });
});
