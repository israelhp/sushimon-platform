import { municipalityByName } from '@/mocks/fixtures/geography';
import { describe, expect, it } from 'vitest';
import type { MockScenario } from '@/mocks/scenarios';
import { createHarness, type TestHarness } from '@/mocks/testing';
import * as account from '@/services/account';
import * as admin from '@/services/backoffice-admin';
import * as banners from '@/services/banners';
import * as bo from '@/services/backoffice-orders';
import * as branchProducts from '@/services/branch-products';
import * as coverage from '@/services/delivery-coverage';
import * as categories from '@/services/categories';
import * as favorites from '@/services/favorites';
import * as media from '@/services/media';
import * as modifiers from '@/services/modifiers';
import * as products from '@/services/products';
import * as promotions from '@/services/promotions';
import * as zones from '@/services/delivery-zones';
import * as locations from '@/services/locations';
import * as orders from '@/services/orders';
import * as staff from '@/services/staff';
import * as store from '@/services/store';
import { ApiError, codeForStatus } from './errors';
import { createHttpClient } from './http-client';
import { withShortcuts, type DataClient } from './types';

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
  // `store.getStoreConfig` ya no se compara: con http NO emite solicitud (ver el caso «F17: config» más abajo).
  (c) => store.listBranches(c),
  (c) => store.listCategories(c),
  (c) => products.listStoreProducts(c, { categorySlug: 'rolls', pageSize: 5 }),
  (c) => products.listSimulatedProductExtras(c),
  (c) => promotions.listStorePromotions(c, 'sucursal-1', 'live'),
  (c) => promotions.listStorePromotions(c, 'sucursal-1', 'upcoming'),
  (c) => promotions.listStorePromotions(c, 'sucursal-4', 'live'), // 404 BRANCH_NOT_FOUND (inactiva)
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

  it('F11: productos (lista/ficha públicas, admin, alta, edición, 404/409/422/400/503) producen los mismos resultados y errores', async () => {
    const p = pair();
    p.asStaff('admin');
    for (const h of [p.mock, p.backend]) h.store.productsBusy = 1;
    const ok = { name: 'Roll Nuevo', basePrice: '75.00', categoryId: 'cat-rolls' };
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => products.listStoreProducts(c),
      (c) => products.listStoreProducts(c, { categorySlug: 'rolls', q: 'salmon', pageSize: 3 }),
      (c) => products.listStoreProducts(c, { categorySlug: 'temporada' }),
      (c) => products.listStoreProducts(c, { pageSize: 101 }), // 400
      (c) => products.getStoreProduct(c, 'alaska-roll'),
      (c) => products.getStoreProduct(c, 'roll-edicion-limitada'), // 404 PRODUCT_NOT_FOUND
      (c) => products.getStoreProduct(c, 'gyoza-vegetal'), // 404
      (c) => products.listAdminProducts(c, { active: false }),
      (c) => products.listAdminProducts(c, { sort: 'basePrice', order: 'desc', pageSize: 5 }),
      (c) => products.getAdminProduct(c, 'dumplings'),
      (c) => products.getAdminProduct(c, 'no-existe'), // 404
      (c) => products.createAdminProduct(c, ok), // 503 PRODUCTS_BUSY (primera escritura)
      (c) =>
        products.createAdminProduct(c, {
          ...ok,
          sku: 'rn-1',
          media: [{ url: 'https://cdn.ejemplo.com/a.jpg', altText: 'Roll' }],
        }),
      (c) => products.createAdminProduct(c, { ...ok, name: 'Otro', slug: 'roll-nuevo' }), // 409 slug
      (c) => products.createAdminProduct(c, { ...ok, name: 'Otro', sku: 'RN-1' }), // 409 sku
      (c) => products.createAdminProduct(c, { ...ok, categoryId: 'cat-temporada' }), // 422 categoría inactiva
      (c) => products.createAdminProduct(c, { ...ok, media: [{ url: 'http://x.com/a.jpg' }] }), // 422 media
      (c) => products.createAdminProduct(c, { ...ok, basePrice: '0.00' }), // 400
      (c) => products.updateAdminProduct(c, 'dumplings', { active: false }),
      (c) => products.updateAdminProduct(c, 'dumplings', { media: [] }),
      (c) => products.updateAdminProduct(c, 'dumplings', {}), // 400
      (c) => products.updateAdminProduct(c, 'no-existe', { name: 'X' }), // 404
      (c) => products.listStoreProducts(c, { q: 'dumpl' }),
    ];
    const a = await run(steps, p.mock.client);
    const b = await run(steps, p.http);
    expect(b).toEqual(a);
    expect(
      a
        .flatMap((x) => ('error' in x ? [x.error.businessCode] : []))
        .filter(Boolean)
        .sort(),
    ).toEqual(
      [
        'PRODUCT_CATEGORY_INVALID',
        'PRODUCT_MEDIA_INVALID',
        'PRODUCT_NOT_FOUND',
        'PRODUCT_NOT_FOUND',
        'PRODUCT_NOT_FOUND',
        'PRODUCT_NOT_FOUND',
        'PRODUCT_SKU_TAKEN',
        'PRODUCT_SLUG_TAKEN',
        'PRODUCTS_BUSY',
      ].sort(),
    );
    // Sin sesión: la lista admin es 401 y la pública funciona, igual en ambos adaptadores.
    const anon = pair();
    const x = await run(
      [(c) => products.listAdminProducts(c), (c) => products.listStoreProducts(c)],
      anon.mock.client,
    );
    const y = await run(
      [(c) => products.listAdminProducts(c), (c) => products.listStoreProducts(c)],
      anon.http,
    );
    expect(y).toEqual(x);
    expect(x[0]).toMatchObject({ error: { status: 401 } });
    expect(x[1]).toHaveProperty('ok');
  });

  it('F14: medios (intent, dedup, complete, biblioteca, vínculo, orden, borrado; 400/401/403/404/409/410/422/503) producen los mismos resultados y errores', async () => {
    const p = pair();
    const hex = (n: number) => n.toString(16).padStart(64, '0');
    const intent = (n: number, extra: Record<string, unknown> = {}) =>
      ({
        kind: 'PRODUCT_IMAGE',
        mimeType: 'image/webp',
        sizeBytes: 1000 + n,
        checksumSha256: hex(n),
        ...extra,
      }) as never;
    const object = (n: number) => ({
      sizeBytes: 1000 + n,
      contentType: 'image/webp',
      checksumSha256: hex(n),
    });
    for (const h of [p.mock, p.backend]) h.store.mediaBusy = 1;
    const anon: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => media.listMedia(c), // 401
      (c) => media.createMediaUploadIntent(c, intent(1)), // 401
    ];
    expect(await run(anon, p.http)).toEqual(await run(anon, p.mock.client));

    p.asStaff('manager');
    const manager: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => media.listMedia(c, { pageSize: 2 }),
      (c) => media.getMedia(c, 'media-seed-1'),
      (c) => media.createMediaUploadIntent(c, intent(1)), // 403
      (c) => media.deleteMedia(c, 'media-seed-2'), // 403
    ];
    expect(await run(manager, p.http)).toEqual(await run(manager, p.mock.client));

    p.asStaff('admin');
    let created = '';
    const admin: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => media.createMediaUploadIntent(c, intent(1, { sizeBytes: 0 })), // 400
      (c) => media.createMediaUploadIntent(c, intent(1, { mimeType: 'image/gif' })), // 422
      (c) => media.createMediaUploadIntent(c, intent(1, { sizeBytes: 6_000_000 })), // 422
      (c) => media.createMediaUploadIntent(c, intent(1)), // 503 MEDIA_BUSY
      (c) =>
        media.createMediaUploadIntent(c, intent(1)).then((i) => {
          created = i.assetId;
          return i;
        }), // 201
      (c) => media.completeMediaUpload(c, created), // 422 MEDIA_OBJECT_MISSING
      (c) => media.putSimulatedMediaObject(c, created, object(1)),
      (c) => media.completeMediaUpload(c, created), // 200
      (c) => media.completeMediaUpload(c, created), // 200 idempotente
      (c) => media.completeMediaUpload(c, 'nada'), // 404
      (c) => media.createMediaUploadIntent(c, intent(1)), // 200 deduplicado
      (c) => media.listMedia(c, { unreferenced: true }),
      (c) => media.listMedia(c, { pageSize: 101 }), // 400
      (c) => media.getMedia(c, created),
      (c) => media.attachProductMedia(c, 'gaseosas', { assetId: created, altText: 'Gaseosa' }),
      (c) => media.attachProductMedia(c, 'gaseosas', { assetId: created }), // 409
      (c) => media.attachProductMedia(c, 'gaseosas', { assetId: 'media-seed-2' }),
      (c) => media.attachProductMedia(c, 'zzz', { assetId: created }), // 404 producto
      (c) => media.updateProductMedia(c, 'gaseosas', 'media-seed-pm-9', 'x'), // 404
      (c) => media.reorderProductMedia(c, 'gaseosas', ['x']), // 422
      (c) => products.getAdminProduct(c, 'gaseosas'),
      (c) => products.getStoreProduct(c, 'gaseosas'),
      (c) => media.deleteMedia(c, created), // 409 en uso
      (c) => media.deleteMedia(c, 'media-seed-3'), // 204
      (c) => media.deleteMedia(c, 'media-seed-3'), // 404
    ];
    expect(await run(admin, p.http)).toEqual(await run(admin, p.mock.client));
    // Orden y desvinculación con los ids reales (los dos stores generan los mismos).
    const gaseosas = await products.getAdminProduct(p.mock.client, 'gaseosas');
    const ids = gaseosas.media.map((m) => m.id).reverse();
    const tail: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => media.reorderProductMedia(c, 'gaseosas', ids),
      (c) => media.updateProductMedia(c, 'gaseosas', ids[0] as string, 'nuevo'),
      (c) => media.detachProductMedia(c, 'gaseosas', ids[0] as string), // 204
      (c) => media.detachProductMedia(c, 'gaseosas', ids[0] as string), // 404
      (c) => products.getAdminProduct(c, 'gaseosas'),
    ];
    expect(await run(tail, p.http)).toEqual(await run(tail, p.mock.client));
    // Sin almacenamiento: 503 en intent/complete/borrado.
    for (const h of [p.mock, p.backend]) h.store.mediaStorageUnavailable = true;
    const down: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => media.createMediaUploadIntent(c, intent(77)),
      (c) => media.deleteMedia(c, 'media-seed-1'),
      (c) => media.listMedia(c),
    ];
    expect(await run(down, p.http)).toEqual(await run(down, p.mock.client));
    // Caducidad: 410.
    for (const h of [p.mock, p.backend]) h.store.mediaStorageUnavailable = false;
    let pending = '';
    const expiry: ((c: DataClient) => Promise<unknown>)[] = [
      (c) =>
        media.createMediaUploadIntent(c, intent(88)).then((i) => {
          pending = i.assetId;
          return i;
        }),
    ];
    expect(await run(expiry, p.http)).toEqual(await run(expiry, p.mock.client));
    p.mock.clock.advance(301_000);
    p.backend.clock.advance(301_000);
    const expired: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => media.completeMediaUpload(c, pending),
    ];
    expect(await run(expired, p.http)).toEqual(await run(expired, p.mock.client));
  });

  it('F13: precio y disponibilidad por sucursal (overlay, matrices, escrituras, 400/401/403/404/422/503) producen los mismos resultados y errores', async () => {
    const p = pair();
    for (const h of [p.mock, p.backend]) h.store.branchProductsBusy = 1;
    const anon: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => branchProducts.getStoreBranchMenu(c, { branchId: 'sucursal-2' }),
      (c) => branchProducts.getStoreBranchMenu(c, { branchId: 'sucursal-4' }), // 404 BRANCH_NOT_FOUND (inactiva)
      (c) => branchProducts.listAdminBranchProducts(c, 'sucursal-1'), // 401
    ];
    expect(await run(anon, p.http)).toEqual(await run(anon, p.mock.client));

    p.asStaff('manager');
    const manager: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => branchProducts.listAdminBranchProducts(c, 'sucursal-1', { pageSize: 5 }),
      (c) => branchProducts.listAdminBranchProducts(c, 'sucursal-2'), // 404 fuera de alcance
      (c) => branchProducts.listAdminProductBranches(c, 'gaseosas'),
      (c) => branchProducts.setAdminBranchProductPricing(c, 'sucursal-1', 'dumplings', '60.00'), // 403
      (c) =>
        branchProducts.setAdminProductAvailability(c, 'dumplings', {
          branchId: 'sucursal-2',
          available: false,
        }), // 404
    ];
    expect(await run(manager, p.http)).toEqual(await run(manager, p.mock.client));

    p.asStaff('admin');
    const admin: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => branchProducts.listAdminProductBranches(c, 'dynamita-roll'),
      (c) => branchProducts.listAdminBranchProducts(c, 'sucursal-2', { hasOverride: true }),
      (c) => branchProducts.listAdminBranchProducts(c, 'sucursal-1', { pageSize: 101 }), // 400
      (c) => branchProducts.listAdminProductBranches(c, 'no-existe'), // 404 PRODUCT_NOT_FOUND
      (c) => branchProducts.setAdminBranchProductPricing(c, 'sucursal-1', 'dumplings', '60.00'), // 503 BRANCH_PRODUCTS_BUSY
      (c) => branchProducts.setAdminBranchProductPricing(c, 'sucursal-1', 'dumplings', '60.00'),
      (c) => branchProducts.setAdminBranchProductPricing(c, 'sucursal-1', 'dumplings', '60.00'), // idempotente
      (c) => branchProducts.setAdminBranchProductPricing(c, 'sucursal-1', 'dumplings', '0.00'), // 422
      (c) => branchProducts.setAdminBranchProductPricing(c, 'sucursal-1', 'dumplings', '85'), // 400
      (c) => branchProducts.setAdminBranchProductPricing(c, 'zzz', 'dumplings', '60.00'), // 404 sucursal
      (c) => branchProducts.setAdminBranchProductPricing(c, 'sucursal-1', 'zzz', '60.00'), // 404 producto
      (c) =>
        branchProducts.setAdminProductAvailability(c, 'dumplings', {
          branchId: 'sucursal-1',
          available: false,
        }),
      (c) => branchProducts.getStoreBranchMenu(c, { branchId: 'sucursal-1' }),
      (c) => branchProducts.setAdminBranchProductPricing(c, 'sucursal-1', 'dumplings', null),
      (c) =>
        branchProducts.setAdminProductAvailability(c, 'dumplings', {
          branchId: 'sucursal-1',
          available: true,
        }), // la fila vuelve al defecto
      (c) => branchProducts.listAdminProductBranches(c, 'dumplings'),
    ];
    expect(await run(admin, p.http)).toEqual(await run(admin, p.mock.client));
  });

  it('F15: promociones (público, lista/detalle admin, alta, edición, estado; 400/401/403/404/409/422/503) producen los mismos resultados y errores', async () => {
    const p = pair();
    for (const h of [p.mock, p.backend]) h.store.promotionsBusy = 1;
    const anon: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => promotions.listStorePromotions(c, 'sucursal-1'),
      (c) => promotions.listStorePromotions(c, 'sucursal-2', 'upcoming'),
      (c) => promotions.listStorePromotions(c, 'zzz'), // 404 BRANCH_NOT_FOUND
      (c) => promotions.listAdminPromotions(c), // 401
    ];
    expect(await run(anon, p.http)).toEqual(await run(anon, p.mock.client));

    p.asStaff('manager');
    const manager: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => promotions.listAdminPromotions(c), // 403 sin promotions.read
      (c) => promotions.getAdminPromotion(c, 'happy-hour'), // 403
    ];
    expect(await run(manager, p.http)).toEqual(await run(manager, p.mock.client));

    p.asStaff('admin');
    const valid = {
      name: 'Jueves de sake',
      kind: 'PERCENT' as const,
      value: '15.00',
      startsAt: '2026-11-01T06:00:00.000Z',
      endsAt: '2026-12-01T06:00:00.000Z',
      branchScope: 'SELECTED' as const,
      branchIds: ['sucursal-1'],
      productScope: 'ALL' as const,
      schedule: [{ weekday: 4, startsAt: '18:00', endsAt: '22:00' }],
    };
    const admin: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => promotions.listAdminPromotions(c, { pageSize: 3, sort: 'name', order: 'asc' }),
      (c) => promotions.listAdminPromotions(c, { status: 'running', kind: 'PERCENT', q: 'cupón' }),
      (c) => promotions.listAdminPromotions(c, { branchId: 'sucursal-2' }),
      (c) => promotions.listAdminPromotions(c, { branchId: 'zzz' }), // 404
      (c) => promotions.listAdminPromotions(c, { pageSize: 101 }), // 400
      (c) => promotions.getAdminPromotion(c, 'happy-hour'),
      (c) => promotions.getAdminPromotion(c, 'no-existe'), // 404 PROMOTION_NOT_FOUND
      (c) => promotions.createAdminPromotion(c, valid), // 503 PROMOTIONS_BUSY
      (c) => promotions.createAdminPromotion(c, valid),
      (c) => promotions.createAdminPromotion(c, { ...valid, code: 'bienvenido10' }), // 409 código
      (c) => promotions.createAdminPromotion(c, { ...valid, value: '100.01' }), // 422 valor
      (c) => promotions.createAdminPromotion(c, { ...valid, endsAt: valid.startsAt }), // 422 periodo
      (c) =>
        promotions.createAdminPromotion(c, {
          ...valid,
          schedule: [{ weekday: 4, startsAt: '18:00', endsAt: '15:00' }],
        }), // 422 horario
      (c) =>
        promotions.createAdminPromotion(c, {
          ...valid,
          productScope: 'SELECTED',
          productIds: ['no-existe'],
        }), // 422 alcance
      (c) => promotions.createAdminPromotion(c, { ...valid, value: '15' }), // 400
      (c) => promotions.updateAdminPromotion(c, 'promo-1', { expectedVersion: 1, name: 'Nuevo' }),
      (c) => promotions.updateAdminPromotion(c, 'promo-1', { expectedVersion: 1, name: 'Otro' }), // 409 versión
      (c) => promotions.updateAdminPromotion(c, 'promo-1', { expectedVersion: 2, name: 'Nuevo' }), // sin cambios
      (c) => promotions.updateAdminPromotionStatus(c, 'promo-1', { active: false }),
      (c) => promotions.updateAdminPromotionStatus(c, 'promo-1', { active: false }), // idempotente
      (c) => promotions.getAdminPromotion(c, 'promo-1'),
      (c) => promotions.listStorePromotions(c, 'sucursal-1', 'upcoming'),
    ];
    expect(await run(admin, p.http)).toEqual(await run(admin, p.mock.client));
  });

  it('F16: banners (público, lista/detalle admin, alta, edición, estado, reordenado; 400/401/403/404/409/422/503) producen los mismos resultados y errores', async () => {
    const p = pair();
    for (const h of [p.mock, p.backend]) h.store.bannersBusy = 1;
    const anon: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => banners.listStoreBanners(c, null), // 503 BANNERS_BUSY
      (c) => banners.listStoreBanners(c, null),
      (c) => banners.listStoreBanners(c, 'sucursal-1', 'en'),
      (c) => banners.listStoreBanners(c, 'sucursal-2'),
      (c) => banners.listStoreBanners(c, 'zzz'), // 404 BRANCH_NOT_FOUND
      (c) => banners.listStoreBanners(c, 'sucursal-4'), // inactiva
      (c) => banners.listStoreBanners(c, null, 'fr' as never), // 400
      (c) => banners.listAdminBanners(c), // 401
    ];
    expect(await run(anon, p.http)).toEqual(await run(anon, p.mock.client));

    p.asStaff('manager');
    const manager: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => banners.listAdminBanners(c), // 403 sin banners.read
      (c) => banners.getAdminBanner(c, 'banner-favoritos'), // 403
      (c) => banners.reorderAdminBanners(c, []), // 403
    ];
    expect(await run(manager, p.http)).toEqual(await run(manager, p.mock.client));

    p.asStaff('admin');
    const valid = {
      code: 'paridad',
      imageAssetId: 'media-seed-banner-favoritos',
      translations: { es: { title: 'Paridad', imageAlt: 'Imagen de paridad' } },
      cta: { type: 'MENU' as const },
      branchScope: 'ALL' as const,
    };
    const order = [
      'banner-favoritos',
      'banner-happy-hour',
      'banner-calientito',
      'banner-equipo',
      'banner-fin-de-mes',
      'banner-navidad',
      'banner-bienvenida',
    ];
    const admin: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => banners.listAdminBanners(c, { pageSize: 3, page: 2 }),
      (c) => banners.listAdminBanners(c, { lifecycle: 'SCHEDULED' }),
      (c) => banners.listAdminBanners(c, { q: 'te merecés', branchId: 'sucursal-1' }),
      (c) => banners.listAdminBanners(c, { branchId: 'zzz' }), // 404
      (c) => banners.listAdminBanners(c, { pageSize: 101 }), // 400
      (c) => banners.getAdminBanner(c, 'banner-fin-de-mes'),
      (c) => banners.getAdminBanner(c, 'no-existe'), // 404 BANNER_NOT_FOUND
      (c) => banners.createAdminBanner(c, valid), // 503 BANNERS_BUSY
      (c) => banners.createAdminBanner(c, valid),
      (c) => banners.createAdminBanner(c, { ...valid, code: 'favoritos' }), // 409 código
      (c) => banners.createAdminBanner(c, { ...valid, code: 'x1', endsAt: valid.code }), // 400 instante
      (c) =>
        banners.createAdminBanner(c, {
          ...valid,
          code: 'periodo',
          startsAt: '2026-12-01T10:00:00.000Z',
          endsAt: '2026-12-01T10:00:00.000Z',
        }), // 422 periodo
      (c) => banners.createAdminBanner(c, { ...valid, code: 'img', imageAssetId: 'media-seed-1' }), // 422 imagen
      (c) =>
        banners.createAdminBanner(c, {
          ...valid,
          code: 'cta',
          cta: { type: 'PAGE', page: 'X' as never },
        }), // 422 CTA
      (c) =>
        banners.createAdminBanner(c, { ...valid, code: 'ext', cta: { type: 'EXTERNAL' as never } }), // 400
      (c) => banners.createAdminBanner(c, { ...valid, code: 'promo', promotionId: 'fin-de-mes' }), // 422 promoción
      (c) => banners.createAdminBanner(c, { ...valid, code: 'scope', branchScope: 'SELECTED' }), // 422 alcance
      (c) => banners.updateAdminBanner(c, 'banner-1', { expectedVersion: 1, sortOrder: 3 }),
      (c) => banners.updateAdminBanner(c, 'banner-1', { expectedVersion: 1, sortOrder: 4 }), // 409 versión
      (c) => banners.updateAdminBanner(c, 'banner-1', { expectedVersion: 2, sortOrder: 3 }), // sin cambios
      (c) => banners.updateAdminBannerStatus(c, 'banner-1', { active: false }),
      (c) => banners.updateAdminBannerStatus(c, 'banner-1', { active: false }), // idempotente
      (c) => banners.reorderAdminBanners(c, order), // 422 (falta banner-1 y paridad)
      (c) => banners.reorderAdminBanners(c, [...order, 'banner-1'].reverse()),
      (c) => banners.reorderAdminBanners(c, [...order, 'banner-1'].reverse()), // idempotente
      (c) => banners.listStoreBanners(c, 'sucursal-1', 'en'),
      (c) => banners.getAdminBanner(c, 'banner-1'),
    ];
    expect(await run(admin, p.http)).toEqual(await run(admin, p.mock.client));
  });

  it('F12: modificadores (grupos, opciones, reordenar, asociación, ficha pública, 400/401/403/404/409/422/503) producen los mismos resultados y errores', async () => {
    const p = pair();
    p.asStaff('admin');
    for (const h of [p.mock, p.backend]) h.store.modifiersBusy = 1;
    const ids = ['mopt-salsa-extra', 'mopt-aguacate', 'mopt-queso-crema', 'mopt-tempura-crunch'];
    const steps: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => products.getStoreProduct(c, 'sushi-pizza'), // modifierGroups
      (c) => modifiers.listAdminModifierGroups(c),
      (c) => modifiers.listAdminModifierGroups(c, { q: 'sal', active: true, pageSize: 5 }),
      (c) => modifiers.listAdminModifierGroups(c, { pageSize: 101 }), // 400
      (c) => modifiers.getAdminModifierGroup(c, 'mgroup-extras'),
      (c) => modifiers.getAdminModifierGroup(c, 'no-existe'), // 404 MODIFIER_GROUP_NOT_FOUND
      (c) => modifiers.createAdminModifierGroup(c, { name: 'Término' }), // 503 MODIFIERS_BUSY
      (c) =>
        modifiers.createAdminModifierGroup(c, {
          name: 'Término',
          minSelect: 1,
          maxSelect: 1,
          options: [{ name: 'Medio', extraPrice: '0.00' }, { name: 'Bien cocido' }],
        }),
      (c) => modifiers.createAdminModifierGroup(c, { name: 'EXTRAS' }), // 409 nombre de grupo
      (c) => modifiers.createAdminModifierGroup(c, { name: 'Malo', minSelect: 3, maxSelect: 2 }), // 422 límites
      (c) => modifiers.createAdminModifierGroup(c, { name: 'Malo', minSelect: 2, maxSelect: 2 }), // 422 inalcanzable
      (c) => modifiers.createAdminModifierGroup(c, { name: '' }), // 400
      (c) => modifiers.updateAdminModifierGroup(c, 'mgroup-extras', { maxSelect: 2 }),
      (c) => modifiers.updateAdminModifierGroup(c, 'mgroup-extras', {}), // 400
      (c) => modifiers.updateAdminModifierGroup(c, 'mgroup-extras', { minSelect: 4, maxSelect: 4 }), // 422
      (c) =>
        modifiers.createAdminModifier(c, 'mgroup-bebida', { name: 'Limonada', extraPrice: '1.50' }),
      (c) => modifiers.createAdminModifier(c, 'mgroup-bebida', { name: 'té frío' }), // 409 opción
      (c) => modifiers.createAdminModifier(c, 'mgroup-bebida', { name: 'X', extraPrice: '5' }), // 400
      (c) => modifiers.createAdminModifier(c, 'no-existe', { name: 'X' }), // 404 grupo
      (c) => modifiers.reorderAdminModifiers(c, 'mgroup-extras', { orderedIds: ids }),
      (c) => modifiers.reorderAdminModifiers(c, 'mgroup-extras', { orderedIds: ids.slice(1) }), // 422 mismatch
      (c) =>
        modifiers.updateAdminModifier(c, 'mopt-aguacate', { extraPrice: '4.50', active: false }),
      (c) => modifiers.updateAdminModifier(c, 'no-existe', { name: 'X' }), // 404 opción
      (c) => modifiers.updateAdminModifier(c, 'mopt-anguila', { active: false }),
      (c) => modifiers.updateAdminModifier(c, 'mopt-mayo-spicy', { active: false }),
      (c) => modifiers.updateAdminModifier(c, 'mopt-ponzu', { active: false }), // 422 unsatisfiable
      (c) => modifiers.getAdminProductModifiers(c, 'sushi-pizza'),
      (c) => modifiers.getAdminProductModifiers(c, 'no-existe'), // 404 PRODUCT_NOT_FOUND
      (c) => modifiers.replaceAdminProductModifierGroups(c, 'dumplings', ['mgroup-extras']),
      (c) => modifiers.replaceAdminProductModifierGroups(c, 'dumplings', ['mgroup-bebida']), // 422 inactivo
      (c) => modifiers.replaceAdminProductModifierGroups(c, 'dumplings', []),
      (c) => modifiers.replaceAdminProductModifierGroups(c, 'no-existe', []), // 404
      (c) => products.getStoreProduct(c, 'california-roll'), // la ficha refleja los cambios
    ];
    const a = await run(steps, p.mock.client);
    const b = await run(steps, p.http);
    expect(b).toEqual(a);
    expect(
      a
        .flatMap((x) => ('error' in x ? [x.error.businessCode] : []))
        .filter(Boolean)
        .sort(),
    ).toEqual(
      [
        'MODIFIER_GROUP_INVALID',
        'MODIFIER_GROUP_NAME_TAKEN',
        'MODIFIER_GROUP_NOT_FOUND',
        'MODIFIER_GROUP_NOT_FOUND',
        'MODIFIER_GROUP_UNSATISFIABLE',
        'MODIFIER_LIMITS_INVALID',
        'MODIFIER_LIMITS_INVALID',
        'MODIFIER_LIMITS_INVALID',
        'MODIFIER_NAME_TAKEN',
        'MODIFIER_NOT_FOUND',
        'MODIFIER_REORDER_MISMATCH',
        'MODIFIERS_BUSY',
        'PRODUCT_NOT_FOUND',
        'PRODUCT_NOT_FOUND',
      ].sort(),
    );
    // La ficha pública trae modifierGroups en ambos adaptadores (contrato: requerido, vacío si no hay).
    expect(a[0]).toMatchObject({ ok: { modifierGroups: [{ name: 'Salsa' }, { name: 'Extras' }] } });
    // Sin sesión: administración 401; 403 sin permiso (cocina); la ficha pública funciona.
    for (const role of [null, 'kitchen'] as const) {
      const anon = pair();
      if (role) anon.asStaff(role);
      const probe: ((c: DataClient) => Promise<unknown>)[] = [
        (c) => modifiers.listAdminModifierGroups(c),
        (c) => modifiers.createAdminModifierGroup(c, { name: 'X' }),
        (c) => products.getStoreProduct(c, 'california-roll'),
      ];
      const x = await run(probe, anon.mock.client);
      expect(await run(probe, anon.http)).toEqual(x);
      expect(x[0]).toMatchObject({ error: { status: role ? 403 : 401 } });
      expect(x[2]).toHaveProperty('ok');
    }
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
        branchProducts.setAdminProductAvailability(c, 'gaseosas', {
          branchId: 'sucursal-1',
          available: false,
        }),
      (c) => products.updateAdminProduct(c, 'gaseosas', { basePrice: '0.00' }),
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

  it('F17: config — con http no emite solicitud (la ruta no existe en la API) y falla con el 404 que ya manejaban las pantallas', async () => {
    const p = pair();
    let requests = 0;
    const http = withShortcuts('http', async (path, options) => {
      requests++;
      return p.http.request(path, options);
    });
    await expect(store.getStoreConfig(http)).rejects.toMatchObject({ status: 404 });
    expect(requests).toBe(0);
    expect(await store.getStoreConfig(p.mock.client)).toMatchObject({ currency: 'GTQ' });
  });

  it('F17: bootstrap, menú paginado, búsqueda y ficha con sucursal producen los mismos resultados y errores (200/400/404/503)', async () => {
    const p = pair();
    for (const h of [p.mock, p.backend]) h.store.storeBusy = 1;
    const reads: ((c: DataClient) => Promise<unknown>)[] = [
      (c) => store.getStoreBootstrap(c, { branchId: 'sucursal-1' }), // 503 STORE_BUSY (determinista)
      (c) => store.getStoreBootstrap(c, { branchId: 'sucursal-1' }),
      (c) => store.getStoreBootstrap(c, { branchId: 'sucursal-2', locale: 'en' }),
      (c) => store.getStoreBootstrap(c),
      (c) => store.getStoreBootstrap(c, { branchId: 'zzz' }), // 404
      (c) => store.getStoreBootstrap(c, { branchId: 'sucursal-4' }), // 404 inactiva
      (c) =>
        branchProducts.getStoreBranchMenu(c, { branchId: 'sucursal-1', pageSize: 10, page: 3 }),
      (c) => branchProducts.getStoreBranchMenu(c, { branchId: 'sucursal-1', page: 99 }), // vacía
      (c) => branchProducts.getStoreBranchMenu(c, { sort: 'price', order: 'desc', pageSize: 5 }),
      (c) =>
        branchProducts.getStoreBranchMenu(c, { categorySlug: 'rolls', branchId: 'sucursal-2' }),
      (c) => branchProducts.getStoreBranchMenu(c, { categorySlug: 'no-existe' }), // lista vacía
      (c) => branchProducts.getStoreBranchMenu(c, { available: true }), // 400: exige sucursal
      (c) => branchProducts.getStoreBranchMenu(c, { branchId: 'sucursal-2', available: true }),
      (c) => store.searchStoreProducts(c, { q: 'salmon', branchId: 'sucursal-1' }),
      (c) => store.searchStoreProducts(c, { q: '  ROLL ', pageSize: 5, page: 2 }),
      (c) => store.searchStoreProducts(c, { q: 'zzzz-sin-resultados' }), // 200 vacío
      (c) => store.searchStoreProducts(c, { q: 'a' }), // 400 q corto
      (c) => store.searchStoreProducts(c, { q: 'x'.repeat(81) }), // 400 q largo
      (c) => store.searchStoreProducts(c, { q: '100%_\\' }), // comodines literales
      (c) => store.searchStoreProducts(c, { q: 'roll', available: true }), // 400
      (c) => store.searchStoreProducts(c, { q: 'roll', branchId: 'zzz' }), // 404
      (c) => products.getStoreProduct(c, 'dynamita-roll'),
      (c) => products.getStoreProduct(c, 'dynamita-roll', 'sucursal-2'),
      (c) => products.getStoreProduct(c, 'dynamita-roll', 'zzz'), // 404 BRANCH_NOT_FOUND
      (c) => products.getStoreProduct(c, 'no-existe', 'sucursal-1'), // 404 PRODUCT_NOT_FOUND
    ];
    const expected = await run(reads, p.mock.client);
    expect(await run(reads, p.http)).toEqual(expected);
    // Sanidad: el 503 salió una vez y hubo 200, 400 y 404 de verdad (la prueba no es vacía).
    const codes = expected.map((x) => ('error' in x ? x.error.status : 200));
    expect(codes[0]).toBe(503);
    expect(codes).toEqual(expect.arrayContaining([200, 400, 404]));
  });

  it.each(['offline', 'error', 'forbidden', 'request-rejected', 'rider-unavailable'] as const)(
    'escenario %s produce los mismos errores',
    async (scenario) => {
      const p = pair(scenario);
      p.asStaff('manager');
      const steps: ((c: DataClient) => Promise<unknown>)[] = [
        (c) => products.listStoreProducts(c),
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
