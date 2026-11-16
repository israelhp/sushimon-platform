import { municipalityByName } from '@/mocks/fixtures/geography';
import { describe, expect, it } from 'vitest';
import type { MockScenario } from '@/mocks/scenarios';
import { createHarness, type TestHarness } from '@/mocks/testing';
import * as account from '@/services/account';
import * as admin from '@/services/backoffice-admin';
import * as bo from '@/services/backoffice-orders';
import * as coverage from '@/services/delivery-coverage';
import * as categories from '@/services/categories';
import * as favorites from '@/services/favorites';
import * as zones from '@/services/delivery-zones';
import * as locations from '@/services/locations';
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
        {
          statusCode: e.status,
          error: codeForStatus(e.status),
          message: e.message,
          details: e.details,
          code: e.businessCode,
          violations: e.violations,
        },
        { status: e.status },
      );
    }
  }) as typeof fetch;
  return createHttpClient('http://api.test', fakeFetch);
}

type Outcome =
  | { ok: unknown }
  | {
      error: {
        status: number;
        code: string;
        message: string;
        businessCode?: string;
        violations?: unknown;
      };
    };

async function run(steps: ((c: DataClient) => Promise<unknown>)[], client: DataClient) {
  const out: Outcome[] = [];
  for (const step of steps) {
    try {
      // JSON ida y vuelta: la API serializa (p. ej., omite propiedades undefined).
      out.push({ ok: JSON.parse(JSON.stringify((await step(client)) ?? null)) });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      out.push({
        error: {
          status: e.status,
          code: e.code,
          message: e.message,
          businessCode: e.businessCode,
          violations: e.violations,
        },
      });
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
    backend,
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
  (c) =>
    coverage.checkDeliveryCoverage(c, {
      branchId: 'sucursal-3',
      municipalityId: 'mun-guatemala-guatemala',
      zone: 'Zona 7',
    }),
  (c) =>
    coverage.checkDeliveryCoverage(c, {
      branchId: 'sucursal-3',
      municipalityId: 'mun-guatemala-guatemala',
    }),
  // sucursal inactiva => 422 BRANCH_NOT_AVAILABLE
  (c) =>
    coverage.checkDeliveryCoverage(c, {
      branchId: 'sucursal-4',
      municipalityId: 'mun-guatemala-guatemala',
    }),
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

  it('F09: catálogos, zonas, configuración y cobertura producen los mismos resultados y errores', async () => {
    const p = pair();
    p.asStaff('admin');
    const mixco = 'mun-guatemala-mixco';
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => locations.listDepartments(c),
      (c) => locations.listMunicipalities(c, 'dep-guatemala'),
      (c) => locations.listMunicipalities(c, 'dep-escuintla'), // []
      (c) => locations.listMunicipalities(c, 'dep-inexistente'), // 404 DEPARTMENT_NOT_FOUND
      (c) => zones.listAdminDeliveryZones(c, { branchId: 'sucursal-1', pageSize: 5, q: 'zona 1' }),
      (c) =>
        zones.createAdminDeliveryZone(c, {
          branchId: 'sucursal-2',
          municipalityId: mixco,
          zoneLabel: '  Colonia   El Álamo ',
          baseFee: '12.5',
          active: true,
        }),
      (c) =>
        zones.createAdminDeliveryZone(c, {
          branchId: 'sucursal-2',
          municipalityId: mixco,
          zoneLabel: 'colonia el alamo',
          baseFee: '10',
          active: true,
        }), // 409 duplicado
      (c) =>
        zones.createAdminDeliveryZone(c, {
          branchId: 'sucursal-2',
          municipalityId: 'mun-inexistente',
          baseFee: '10',
          active: true,
        }), // 422
      (c) => zones.updateAdminDeliveryZone(c, 'zona-0066', { expectedVersion: 1, baseFee: '13' }),
      (c) => zones.updateAdminDeliveryZone(c, 'zona-0066', { expectedVersion: 1, baseFee: '14' }), // 409 versión
      (c) => zones.updateAdminDeliveryZoneStatus(c, 'zona-0066', { active: false }),
      (c) => zones.getAdminBranchDeliverySettings(c, 'sucursal-4'),
      (c) =>
        zones.updateAdminBranchDeliverySettings(c, 'sucursal-4', { ownDeliveryZonesEnabled: true }),
      (c) => coverage.checkDeliveryCoverage(c, { branchId: 'sucursal-4', municipalityId: mixco }), // 422 inactiva
      (c) => coverage.checkDeliveryCoverage(c, { branchId: 'sucursal-1', municipalityId: mixco }),
    ];
    const a = await run(steps, p.mock.client);
    expect(await run(steps, p.http)).toEqual(a);
    expect(
      a.filter((x) => 'error' in x).map((x) => ('error' in x ? x.error.businessCode : '')),
    ).toEqual([
      'DEPARTMENT_NOT_FOUND',
      'DELIVERY_ZONE_DUPLICATE',
      'MUNICIPALITY_NOT_FOUND',
      'DELIVERY_ZONE_VERSION_CONFLICT',
      'BRANCH_NOT_AVAILABLE',
    ]);
  });

  it('F10: categorías (árbol público, lista admin, alta, mover, ciclo y reorder) producen los mismos resultados y errores', async () => {
    const p = pair();
    p.asStaff('admin');
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => categories.listStoreCategories(c),
      (c) => categories.listAdminCategories(c),
      (c) => categories.listAdminCategories(c, { active: false, q: 'tempor' }),
      (c) => categories.createAdminCategory(c, { name: 'Bowls Poke' }),
      (c) => categories.createAdminCategory(c, { name: 'Otra', slug: 'rolls' }), // 409 CATEGORY_SLUG_TAKEN
      (c) => categories.createAdminCategory(c, { name: 'Hija', parentId: 'cat-temporada' }), // 422 PARENT_INVALID
      (c) => categories.updateAdminCategory(c, 'cat-rolls', { parentId: 'cat-rolls-frios' }), // 422 CYCLE
      (c) => categories.updateAdminCategory(c, 'cat-relax', { parentId: 'cat-rolls-tempura' }),
      (c) => categories.updateAdminCategory(c, 'cat-rolls', { parentId: 'cat-postres' }), // 422 DEPTH_EXCEEDED
      (c) => categories.updateAdminCategory(c, 'cat-postres', { active: false }),
      (c) => categories.updateAdminCategory(c, 'cat-postres', {}), // 400
      (c) => categories.updateAdminCategory(c, 'cat-no-existe', { name: 'X' }), // 404
      (c) =>
        categories.reorderAdminCategories(c, {
          parentId: 'cat-rolls',
          orderedIds: ['cat-rolls-tempura', 'cat-rolls-frios'],
        }),
      (c) =>
        categories.reorderAdminCategories(c, {
          parentId: 'cat-rolls',
          orderedIds: ['cat-rolls-frios'],
        }), // 422
      (c) => categories.listStoreCategories(c),
    ];
    const a = await run(steps, p.mock.client);
    const b = await run(steps, p.http);
    expect(b).toEqual(a);
    expect(a.filter((x) => 'error' in x).length).toBeGreaterThanOrEqual(6);
    expect(
      a
        .flatMap((x) => ('error' in x ? [x.error.businessCode] : []))
        .filter(Boolean)
        .sort(),
    ).toEqual(
      [
        'CATEGORY_CYCLE',
        'CATEGORY_DEPTH_EXCEEDED',
        'CATEGORY_PARENT_INVALID',
        'CATEGORY_REORDER_MISMATCH',
        'CATEGORY_SLUG_TAKEN',
      ].sort(),
    );
    // Sin sesión: la lista admin es 401 en ambos adaptadores.
    const anon = pair();
    const x = await run([(c) => categories.listAdminCategories(c)], anon.mock.client);
    const y = await run([(c) => categories.listAdminCategories(c)], anon.http);
    expect(y).toEqual(x);
    expect(x[0]).toMatchObject({ error: { status: 401 } });
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
          municipalityId: municipalityByName('Guatemala', 'Mixco')!.id,
          department: 'Guatemala',
          municipality: 'Mixco',
          zone: '',
          line: 'Calzada San Juan 1-1',
        }),
      (c) => account.deleteAddress(c, 'addr-1'),
      (c) => account.deleteAddress(c, 'addr-1'),
      (c) => favorites.addMyFavorite(c, 'dumplings'),
      (c) => favorites.removeMyFavorite(c, 'dumplings'),
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

  it('direcciones (F05): zona obligatoria en la ciudad y libre en otros municipios, mismos 400 con `code`', async () => {
    const p = pair();
    p.asCustomer();
    const city = municipalityByName('Guatemala', 'Guatemala')!.id;
    const input = (zone: string, line: string) => ({
      label: 'home' as const,
      municipalityId: city,
      department: 'Guatemala',
      municipality: 'Guatemala',
      zone,
      line,
    });
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => account.createAddress(c, input('', 'Calle sin zona 1-23')), // 400 ZONE_REQUIRED
      (c) => account.createAddress(c, input('abc', 'Calle zona rara 1-23')), // 400 ZONE_INVALID
      (c) => account.createAddress(c, input('26', 'Calle zona 26 1-23')), // 400 ZONE_INVALID
      (c) => account.createAddress(c, input('05', 'Calle cinco 5-55')), // «zona 05» → 5
      (c) => account.createAddress(c, input('20', 'Calle veinte 20-20')), // la API no excluye la 20
      (c) =>
        account.createAddress(c, {
          ...input('  Colonia   Lomas ', 'Calle Mixco 1-1'),
          municipalityId: municipalityByName('Guatemala', 'Mixco')!.id,
          municipality: 'Mixco',
        }),
      (c) =>
        account.createAddress(c, {
          ...input('x'.repeat(61), 'Calle Mixco 2-2'),
          municipalityId: municipalityByName('Guatemala', 'Mixco')!.id,
          municipality: 'Mixco',
        }), // 400 ADDRESS_INVALID
      (c) => account.updateAddress(c, 'demo-trabajo', { zone: '' }), // 400 ZONE_REQUIRED
      (c) => account.listAddresses(c),
    ];
    const a: Outcome[] = [];
    const b: Outcome[] = [];
    for (const step of steps) {
      a.push(...(await run([step], p.mock.client)));
      b.push(...(await run([step], p.http)));
    }
    expect(b).toEqual(a);
    expect(a.map((o) => ('error' in o ? [o.error.status, o.error.businessCode] : 'ok'))).toEqual([
      [400, 'ZONE_REQUIRED'],
      [400, 'ZONE_INVALID'],
      [400, 'ZONE_INVALID'],
      'ok',
      'ok',
      'ok',
      [400, 'ADDRESS_INVALID'],
      [400, 'ZONE_REQUIRED'],
      'ok',
    ]);
    const saved = (a[3] as { ok: { zone: string } }).ok;
    expect(saved.zone).toBe('5');
    expect((a[5] as { ok: { zone: string } }).ok.zone).toBe('Colonia Lomas');
  });

  it('favoritos (F06): idempotencia 204, 404/422/503 con `code`, aislamiento y degradación del catálogo', async () => {
    const p = pair();
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => favorites.listMyFavoriteIds(c), // 401 sin sesión
      (c) => favorites.addMyFavorite(c, 'dumplings'),
      async (c) => {
        p.asCustomer();
        return favorites.listMyFavorites(c, { page: 1, pageSize: 20 });
      },
      (c) => favorites.listMyFavoriteIds(c),
      (c) => favorites.addMyFavorite(c, 'dumplings'),
      (c) => favorites.addMyFavorite(c, 'dumplings'), // idempotente
      (c) => favorites.addMyFavorite(c, 'no-existe'), // 404 PRODUCT_NOT_FOUND
      (c) => favorites.listMyFavorites(c, { page: 2, pageSize: 1 }),
      (c) => favorites.listMyFavorites(c, { page: 1, pageSize: 51 }), // 400
      (c) => favorites.removeMyFavorite(c, 'dumplings'),
      (c) => favorites.removeMyFavorite(c, 'dumplings'), // idempotente
      async (c) => {
        // Tope: 200 favoritos => un producto nuevo recibe 422 FAVORITES_LIMIT_REACHED.
        for (const side of [p.mock, p.backend]) {
          side.store.accounts['cliente@ejemplo.com']!.favorites = Array.from(
            { length: 200 },
            (_, i) => ({
              productId: `retirado-${i}`,
              addedAt: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
            }),
          );
        }
        return favorites.addMyFavorite(c, 'dumplings');
      },
      async (c) => {
        // Candado agotado: 503 FAVORITES_BUSY (reintentable) y el siguiente intento funciona.
        const side = c === p.http ? p.backend : p.mock;
        side.store.accounts['cliente@ejemplo.com']!.favorites = [];
        side.store.favoritesBusy = 1;
        return favorites.addMyFavorite(c, 'dumplings');
      },
      (c) => favorites.addMyFavorite(c, 'dumplings'),
      async (c) => {
        // Catálogo no disponible: 503 CATALOG_UNAVAILABLE y GET degradado a UNKNOWN.
        p.mock.store.favoritesCatalog = 'unavailable';
        p.backend.store.favoritesCatalog = 'unavailable';
        return favorites.addMyFavorite(c, 'dumplings');
      },
      (c) => favorites.listMyFavorites(c, { page: 1, pageSize: 3 }),
    ];
    const a: Outcome[] = [];
    const b: Outcome[] = [];
    for (const step of steps) {
      a.push(...(await run([step], p.mock.client)));
      b.push(...(await run([step], p.http)));
    }
    expect(b).toEqual(a);
    const codes = a.map((o) => ('error' in o ? [o.error.status, o.error.businessCode] : 'ok'));
    expect(codes[0]).toEqual([401, undefined]);
    expect(codes[1]).toEqual([401, undefined]);
    expect(codes.slice(2, 6)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(codes[6]).toEqual([404, 'PRODUCT_NOT_FOUND']);
    expect(codes[8]).toEqual([400, undefined]);
    expect(codes.slice(9, 11)).toEqual(['ok', 'ok']);
    expect(codes[11]).toEqual([422, 'FAVORITES_LIMIT_REACHED']);
    expect(codes[12]).toEqual([503, 'FAVORITES_BUSY']);
    expect(codes[13]).toEqual('ok');
    expect(codes[14]).toEqual([503, 'CATALOG_UNAVAILABLE']);
    expect(a[15]).toMatchObject({ ok: { catalogStatus: 'UNAVAILABLE', limit: 200 } });
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

  it('F02: restablecer MFA produce los mismos resultados y errores (204, 403, 404, 409, 503)', async () => {
    const p = pair();
    p.asStaff('admin');
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => staff.resetAdminStaffMfa(c, 'u5'), // 204
      (c) => staff.resetAdminStaffMfa(c, 'u5'), // idempotente
      (c) => staff.resetAdminStaffMfa(c, 'u1'), // 403: uno mismo
      (c) => staff.resetAdminStaffMfa(c, 'nada'), // 404 STAFF_NOT_FOUND
      (c) => staff.resetAdminStaffMfa(c, 'u10'), // 409 STAFF_NOT_LINKED
      async (c) => {
        p.mock.store.mfaResetUnavailable = true;
        p.backend.store.mfaResetUnavailable = true;
        return staff.resetAdminStaffMfa(c, 'u5'); // 503 MFA_RESET_UNAVAILABLE
      },
      async (c) => {
        p.asStaff('manager');
        return staff.resetAdminStaffMfa(c, 'u5'); // 403: sin alcance global
      },
    ];
    const a: Outcome[] = [];
    const b: Outcome[] = [];
    for (const step of steps) {
      a.push(...(await run([step], p.mock.client)));
      b.push(...(await run([step], p.http)));
    }
    expect(b).toEqual(a);
    expect(a.map((o) => ('error' in o ? [o.error.status, o.error.businessCode] : 'ok'))).toEqual([
      'ok',
      'ok',
      [403, undefined],
      [404, 'STAFF_NOT_FOUND'],
      [409, 'STAFF_NOT_LINKED'],
      [503, 'MFA_RESET_UNAVAILABLE'],
      [403, undefined],
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
