import { describe, expect, it } from 'vitest';
import type { MockScenario } from '@/mocks/scenarios';
import { createHarness, type TestHarness } from '@/mocks/testing';
import * as account from '@/services/account';
import * as admin from '@/services/backoffice-admin';
import * as bo from '@/services/backoffice-orders';
import * as orders from '@/services/orders';
import * as staff from '@/services/staff';
import * as store from '@/services/store';
import { ApiError, codeForStatus } from './errors';
import { createHttpClient } from './http-client';
import type { DataClient } from './types';

/**
 * Paridad de adaptadores (SC-005): los MISMOS services contra
 *  (a) el adaptador mock y
 *  (b) el adaptador http con un `fetch` falso que responde como respondería la API
 *      (cuerpo JSON o `ErrorResponse`), respaldado por otro store sembrado igual.
 * Deben producir los mismos resultados y los mismos ApiError (status, code, message).
 */
function httpBackedBy(backend: TestHarness): DataClient {
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET') as 'GET';
    try {
      const data = await backend.client.request(decodeURI(url.pathname), {
        method,
        query: Object.fromEntries(url.searchParams),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return data === undefined ? new Response(null, { status: 204 }) : Response.json(data);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.status === 0) throw new TypeError('fetch failed');
      return Response.json(
        { statusCode: e.status, error: codeForStatus(e.status), message: e.message },
        { status: e.status },
      );
    }
  }) as typeof fetch;
  return createHttpClient('http://api.test', fakeFetch);
}

type Outcome = { ok: unknown } | { error: { status: number; code: string; message: string } };

async function run(steps: ((c: DataClient) => Promise<unknown>)[], client: DataClient) {
  const out: Outcome[] = [];
  for (const step of steps) {
    try {
      // JSON ida y vuelta: la API serializa (p. ej., omite propiedades undefined).
      out.push({ ok: JSON.parse(JSON.stringify((await step(client)) ?? null)) });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      out.push({ error: { status: e.status, code: e.code, message: e.message } });
    }
  }
  return out;
}

function pair(scenario: MockScenario = 'default') {
  const mock = createHarness(scenario);
  const backend = createHarness(scenario);
  const http = httpBackedBy(backend);
  return {
    mock,
    http,
    asStaff: (role: Parameters<TestHarness['asStaff']>[0]) => {
      mock.asStaff(role);
      backend.asStaff(role);
    },
    asCustomer: () => {
      mock.asCustomer();
      backend.asCustomer();
    },
  };
}

const newOrder = {
  fulfillment: 'delivery' as const,
  schedule: { kind: 'now' as const },
  customer: { name: 'Ana Prueba', phone: '5555-0000', email: 'ana@ejemplo.com' },
  address: {
    department: 'Guatemala',
    municipality: 'Guatemala',
    zone: '10',
    line: '6a avenida 10-50',
    references: '',
  },
  lines: [{ productId: 'platanito-roll', quantity: 2, note: 'Sin ajonjolí' }],
  paymentMethod: 'card' as const,
};

const storeSteps: ((c: DataClient) => Promise<unknown>)[] = [
  (c) => store.getStoreConfig(c),
  (c) => store.listBranches(c),
  (c) => store.listCategories(c),
  (c) => store.listProducts(c, { branchId: 'sucursal-3', categoryId: 'rolls' }),
  (c) => store.listPromotions(c),
  (c) => store.quoteDelivery(c, { department: 'Guatemala', municipality: 'Guatemala', zone: '7' }),
  (c) => store.quoteDelivery(c, { department: 'Guatemala', municipality: 'Guatemala' }),
  (c) => orders.createOrder(c, newOrder),
  (c) => orders.createOrder(c, { ...newOrder, lines: [] }),
  (c) =>
    orders.payWithCard(c, {
      orderId: 'MON-307059',
      cardNumber: '4000000000000002',
      holderName: 'CLIENTE DEMO',
      expiry: '12/28',
      cvv: '123',
    }),
  (c) =>
    orders.payWithCard(c, {
      orderId: 'MON-307059',
      cardNumber: '4242424242424242',
      holderName: 'CLIENTE DEMO',
      expiry: '12/28',
      cvv: '123',
    }),
  (c) => orders.getOrder(c, 'MON-307059'),
  (c) => orders.getOrder(c, 'MON-490217'),
  (c) => orders.lookupOrder(c, { orderNumber: '490217', phone: '55551234' }),
  (c) =>
    orders.createIncident(c, {
      orderId: 'MON-490217',
      type: 'late',
      items: [],
      description: 'Llegó tarde y frío.',
      resolution: 'inform',
    }),
  (c) => orders.advanceOrderDemo(c, 'MON-307059'),
];

describe('paridad mock ↔ http', () => {
  it('tienda: catálogo, cotización, pedido, pago, consulta e incidencia', async () => {
    const p = pair();
    const a = await run(storeSteps, p.mock.client);
    const b = await run(storeSteps, p.http);
    expect(b).toEqual(a);
    // Sanidad: hubo éxitos y errores de verdad.
    expect(a.filter((x) => 'error' in x).length).toBeGreaterThanOrEqual(3);
    expect(a.filter((x) => 'ok' in x).length).toBeGreaterThanOrEqual(10);
  });

  it('cuenta del cliente: sin sesión (401) y con sesión, incluido DELETE 204', async () => {
    const p = pair();
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => account.getMe(c),
      async (c) => {
        p.asCustomer();
        return account.getMe(c);
      },
      (c) => account.listAddresses(c),
      (c) =>
        account.createAddress(c, {
          label: 'work',
          department: 'Guatemala',
          municipality: 'Mixco',
          zone: '',
          line: 'Calzada San Juan 1-1',
        }),
      (c) => account.deleteAddress(c, 'addr-1'),
      (c) => account.deleteAddress(c, 'addr-1'),
      (c) => account.addFavorite(c, 'dumplings'),
      (c) => account.removeFavorite(c, 'dumplings'),
      (c) => account.listMyOrders(c),
    ];
    // Se ejecuta de forma intercalada para que ambas sesiones cambien a la vez.
    const a: Outcome[] = [];
    const b: Outcome[] = [];
    for (const step of steps) {
      a.push(...(await run([step], p.mock.client)));
      b.push(...(await run([step], p.http)));
    }
    expect(b).toEqual(a);
    expect(a[0]).toEqual({
      error: { status: 401, code: 'unauthorized', message: 'Inicia sesión para continuar' },
    });
    expect(a[4]).toEqual({ ok: null });
  });

  it('backoffice: panel, transición, despacho, logística, catálogo y reportes', async () => {
    const p = pair();
    p.asStaff('admin');
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => bo.getStaffMe(c),
      (c) => bo.getDashboard(c),
      (c) => bo.listBackofficeOrders(c, { status: ['received', 'ready'] }),
      (c) => bo.changeOrderStatus(c, { id: 'MON-307057', status: 'ready' }),
      (c) => bo.changeOrderStatus(c, { id: 'MON-307057', status: 'accepted' }),
      (c) => bo.quoteCourier(c, 'MON-307051'),
      (c) => bo.dispatchOrder(c, { id: 'MON-307051', provider: 'pedidosya' }),
      (c) => bo.advanceDelivery(c, 'MON-307051'),
      (c) => bo.listRiders(c),
      (c) => bo.listDeliveries(c, { from: '2026-11-10', to: '2026-11-11', provider: 'own' }),
      (c) =>
        admin.setProductAvailability(c, 'gaseosas', [{ branchId: 'sucursal-1', available: false }]),
      (c) => admin.updateProduct(c, 'gaseosas', { price: -1 }),
      (c) => admin.getReportSummary(c, { from: '2026-11-01', to: '2026-11-11' }),
      (c) => admin.getReportHistory(c, { from: '2026-11-10' }),
    ];
    expect(await run(steps, p.http)).toEqual(await run(steps, p.mock.client));
  });

  it('F03: empleados, roles y permisos producen los mismos resultados y errores', async () => {
    const p = pair();
    p.asStaff('manager');
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => staff.getAdminContext(c),
      (c) => staff.listAdminStaff(c, { pageSize: 3, sort: 'email' }),
      (c) => staff.getAdminStaff(c, 'u5'),
      (c) => staff.getAdminStaff(c, 'u3'), // 404: fuera de alcance
      (c) =>
        staff.createAdminStaff(c, {
          fullName: 'Nuevo Empleado',
          email: 'Nuevo@Sushimon.gt',
          assignments: [{ roleId: 'role-kitchen', branchId: 'sucursal-1' }],
        }),
      (c) =>
        staff.createAdminStaff(c, {
          fullName: 'Duplicado',
          email: 'nuevo@sushimon.gt',
          assignments: [{ roleId: 'role-kitchen', branchId: 'sucursal-1' }],
        }), // 409
      (c) =>
        staff.createAdminStaff(c, {
          fullName: 'Escalada',
          email: 'esc@sushimon.gt',
          assignments: [{ roleId: 'role-admin', branchId: null }],
        }), // 403
      (c) => staff.updateAdminStaff(c, 'u5', { fullName: 'Cocina Z4' }),
      (c) => staff.updateAdminStaff(c, 'u2', { email: 'x@sushimon.gt' }), // 403: cuenta propia
      (c) => staff.setAdminStaffStatus(c, 'u5', { active: false }), // 400
      (c) => staff.setAdminStaffStatus(c, 'u5', { active: false, reason: 'Baja' }),
      (c) => staff.setAdminStaffStatus(c, 'u2', { active: false, reason: 'x' }), // 403
      (c) =>
        staff.replaceAdminStaffAssignments(c, 'u9', {
          assignments: [{ roleId: 'role-staff', branchId: 'sucursal-1' }],
        }),
      (c) => staff.listAdminRoles(c),
      (c) => staff.listAdminPermissions(c),
      (c) => staff.replaceAdminRolePermissions(c, 'role-kitchen', { permissions: ['orders.read'] }), // 403
    ];
    const a = await run(steps, p.mock.client);
    expect(await run(steps, p.http)).toEqual(a);
    expect(a.filter((x) => 'error' in x).map((x) => ('error' in x ? x.error.status : 0))).toEqual([
      404, 409, 403, 403, 400, 403, 403,
    ]);
  });

  it.each(['offline', 'error', 'forbidden', 'request-rejected', 'rider-unavailable'] as const)(
    'escenario %s produce los mismos errores',
    async (scenario) => {
      const p = pair(scenario);
      p.asStaff('manager');
      const steps: ((c: DataClient) => Promise<unknown>)[] = [
        (c) => store.listProducts(c),
        (c) => orders.createOrder(c, { ...newOrder, paymentMethod: 'cash' }),
        (c) => bo.getDashboard(c),
        (c) => bo.dispatchOrder(c, { id: 'MON-307051', provider: 'pedidosya' }),
        (c) => bo.advanceDelivery(c, 'MON-307051'),
      ];
      const a = await run(steps, p.mock.client);
      expect(await run(steps, p.http)).toEqual(a);
      if (scenario === 'offline') {
        expect(a.every((x) => 'error' in x && x.error.status === 0)).toBe(true);
      }
    },
  );
});
