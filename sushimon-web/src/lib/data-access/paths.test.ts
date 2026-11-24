import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mockRoutes } from '@/mocks/handlers';
import { paths } from './paths';

describe('paths', () => {
  it('construye rutas y codifica segmentos', () => {
    expect(paths.order('MON-490217')).toBe('/v1/orders/MON-490217');
    expect(paths.myFavorite('a b/c')).toBe('/v1/me/favorites/a%20b%2Fc');
    expect(paths.boOrderStatus('MON-1')).toBe('/v1/backoffice/orders/MON-1/status');
    expect(paths.deliveryAdvance('MON-1')).toBe('/v1/backoffice/deliveries/MON-1/advance');
  });

  it('F07: rutas de sucursales del contrato (público y admin) y de la operación simulada', () => {
    expect(paths.branches()).toBe('/v1/branches');
    expect(paths.branch('a b')).toBe('/v1/branches/a%20b');
    expect(paths.adminBranches()).toBe('/v1/admin/branches');
    expect(paths.adminBranch('b1')).toBe('/v1/admin/branches/b1');
    expect(paths.adminBranchStatus('b1')).toBe('/v1/admin/branches/b1/status');
    // La operación simulada de la sucursal (zona/área) es F33: solo existe en el mock, bajo /v1/demo.
    expect(paths.demoBranchOperations()).toBe('/v1/demo/branches/operations');
    expect(Object.values(paths).map((f) => (f as (id: string) => string)('X'))).not.toContain(
      '/v1/backoffice/branches',
    );
  });

  it('F10: rutas de categorías del menú (público y admin)', () => {
    expect(paths.storeCategories()).toBe('/v1/store/categories');
    expect(paths.adminCategories()).toBe('/v1/admin/categories');
    expect(paths.adminCategory('c 1')).toBe('/v1/admin/categories/c%201');
    expect(paths.adminCategoriesReorder()).toBe('/v1/admin/categories/reorder');
  });

  it('F15: rutas de promociones (público y admin); las rutas mock previas quedaron retiradas', () => {
    expect(paths.storePromotions()).toBe('/v1/store/promotions');
    expect(paths.adminPromotions()).toBe('/v1/admin/promotions');
    expect(paths.adminPromotion('p 1')).toBe('/v1/admin/promotions/p%201');
    expect(paths.adminPromotionStatus('p1')).toBe('/v1/admin/promotions/p1/status');
    // F16: banners (contrato).
    expect(paths.storeBanners()).toBe('/v1/store/banners');
    expect(paths.adminBanners()).toBe('/v1/admin/banners');
    expect(paths.adminBannersOrder()).toBe('/v1/admin/banners/order');
    expect(paths.adminBanner('b 1')).toBe('/v1/admin/banners/b%201');
    expect(paths.adminBannerStatus('b1')).toBe('/v1/admin/banners/b1/status');
    for (const key of [
      'GET /v1/store/banners',
      'GET /v1/admin/banners',
      'POST /v1/admin/banners',
      'PUT /v1/admin/banners/order',
      'GET /v1/admin/banners/:id',
      'PATCH /v1/admin/banners/:id',
      'PATCH /v1/admin/banners/:id/status',
    ]) {
      expect(Object.keys(mockRoutes)).toContain(key);
    }
    expect(Object.keys(paths)).not.toContain('banners');
    expect(Object.keys(paths)).not.toContain('boBanners');
    expect(Object.keys(paths)).not.toContain('promotions');
    expect(Object.keys(paths)).not.toContain('boPromotions');
    expect(Object.keys(mockRoutes)).not.toContain('GET /v1/promotions');
    expect(Object.keys(mockRoutes)).not.toContain('GET /v1/backoffice/promotions');
  });

  it('F22: rutas de pedidos del backoffice (contrato admin-orders) y su espejo en el mock', () => {
    expect(paths.adminOrders()).toBe('/v1/admin/orders');
    expect(paths.adminOrderBoard()).toBe('/v1/admin/orders/board');
    expect(paths.adminOrder('o 1')).toBe('/v1/admin/orders/o%201');
    expect(paths.adminOrderAccept('o1')).toBe('/v1/admin/orders/o1/accept');
    expect(paths.adminOrderReject('o1')).toBe('/v1/admin/orders/o1/reject');
    expect(paths.adminOrderStartPreparing('o1')).toBe('/v1/admin/orders/o1/start-preparing');
    expect(paths.adminOrderMarkReady('o1')).toBe('/v1/admin/orders/o1/mark-ready');
    expect(paths.adminOrderComplete('o1')).toBe('/v1/admin/orders/o1/complete');
    expect(paths.adminOrderCancel('o1')).toBe('/v1/admin/orders/o1/cancel');
    const keys = Object.keys(mockRoutes);
    for (const key of [
      'GET /v1/admin/orders',
      'GET /v1/admin/orders/board',
      'GET /v1/admin/orders/:id',
      'POST /v1/admin/orders/:id/accept',
      'POST /v1/admin/orders/:id/reject',
      'POST /v1/admin/orders/:id/start-preparing',
      'POST /v1/admin/orders/:id/mark-ready',
      'POST /v1/admin/orders/:id/complete',
      'POST /v1/admin/orders/:id/cancel',
    ]) {
      expect(keys).toContain(key);
    }
    // `board` se registra ANTES de `:id` (si no, «board» sería un id).
    expect(keys.indexOf('GET /v1/admin/orders/board')).toBeLessThan(
      keys.indexOf('GET /v1/admin/orders/:id'),
    );
  });

  it('F12: rutas de modificadores (grupos, opciones y asociación a productos)', () => {
    expect(paths.adminModifierGroups()).toBe('/v1/admin/modifier-groups');
    expect(paths.adminModifierGroup('g 1')).toBe('/v1/admin/modifier-groups/g%201');
    expect(paths.adminModifierGroupOptions('g1')).toBe('/v1/admin/modifier-groups/g1/modifiers');
    expect(paths.adminModifierGroupReorder('g1')).toBe(
      '/v1/admin/modifier-groups/g1/modifiers/reorder',
    );
    expect(paths.adminModifier('m1')).toBe('/v1/admin/modifiers/m1');
    expect(paths.adminProductModifiers('p1')).toBe('/v1/admin/products/p1/modifiers');
    expect(paths.adminProductModifierGroups('p1')).toBe('/v1/admin/products/p1/modifier-groups');
  });

  it('F09: rutas de catálogos, zonas, configuración de entrega y cobertura', () => {
    expect(paths.locationDepartments()).toBe('/v1/locations/departments');
    expect(paths.locationMunicipalities()).toBe('/v1/locations/municipalities');
    expect(paths.adminDeliveryZones()).toBe('/v1/admin/delivery-zones');
    expect(paths.adminDeliveryZone('z 1')).toBe('/v1/admin/delivery-zones/z%201');
    expect(paths.adminDeliveryZoneStatus('z1')).toBe('/v1/admin/delivery-zones/z1/status');
    expect(paths.adminBranchDeliverySettings('b1')).toBe('/v1/admin/branches/b1/delivery-settings');
    expect(paths.deliveryCoverageCheck()).toBe('/v1/delivery-coverage/check');
    expect(paths.checkoutQuote()).toBe('/v1/checkout/quote');
    // La cotización por «niveles» (tiers/ETA del mock) se retiró: la tarifa propia viene de `checkDeliveryCoverage`.
    expect(Object.keys(paths)).not.toContain('deliveryQuote');
  });

  it('F03: rutas de empleados, roles y permisos del contrato (sin /v1/backoffice/users)', () => {
    expect(paths.adminStaff()).toBe('/v1/admin/staff');
    expect(paths.adminStaffMember('u 1')).toBe('/v1/admin/staff/u%201');
    expect(paths.adminStaffStatus('u1')).toBe('/v1/admin/staff/u1/status');
    expect(paths.adminStaffAssignments('u1')).toBe('/v1/admin/staff/u1/assignments');
    expect(paths.adminStaffMfaReset('u1')).toBe('/v1/admin/staff/u1/mfa-reset');
    expect(paths.adminRoles()).toBe('/v1/admin/roles');
    expect(paths.adminRole('r1')).toBe('/v1/admin/roles/r1');
    expect(paths.adminRolePermissions('r1')).toBe('/v1/admin/roles/r1/permissions');
    expect(paths.adminPermissions()).toBe('/v1/admin/permissions');
    expect(paths.adminContext()).toBe('/v1/admin/me/context');
    expect(Object.keys(paths)).not.toContain('users');
  });

  it('F27: rutas de motoristas propios (id codificado, sin DELETE) y distintas de las de despacho simulado', () => {
    expect(paths.adminRiders()).toBe('/v1/admin/riders');
    expect(paths.adminRider('r 1')).toBe('/v1/admin/riders/r%201');
    expect(paths.adminRiderStatus('r1')).toBe('/v1/admin/riders/r1/status');
    expect(paths.adminRiderAvailability('r1')).toBe('/v1/admin/riders/r1/availability');
    expect(paths.riders()).toBe('/v1/backoffice/riders');
  });

  it('F28: rutas de entregas propias (id codificado, sin PATCH/DELETE) y distintas del despacho simulado', () => {
    expect(paths.adminDeliveries()).toBe('/v1/admin/deliveries');
    expect(paths.adminDelivery('d 1')).toBe('/v1/admin/deliveries/d%201');
    expect(paths.adminDeliveryAssignOwnRider('d1')).toBe(
      '/v1/admin/deliveries/d1/assign-own-rider',
    );
    expect(paths.adminDeliveryUnassignRider('d1')).toBe('/v1/admin/deliveries/d1/unassign-rider');
    expect(paths.adminDeliveryMarkPickedUp('d1')).toBe('/v1/admin/deliveries/d1/mark-picked-up');
    expect(paths.adminDeliveryMarkDelivered('d1')).toBe('/v1/admin/deliveries/d1/mark-delivered');
    expect(paths.adminDeliveryReturnToBranch('d1')).toBe(
      '/v1/admin/deliveries/d1/return-to-branch',
    );
    expect(paths.adminDeliveryCancel('d1')).toBe('/v1/admin/deliveries/d1/cancel');
    // El despacho simulado (PedidosYa, MOCK_ONLY) conserva sus rutas.
    expect(paths.deliveries()).toBe('/v1/backoffice/deliveries');
    expect(paths.boOrderDispatch('X')).toBe('/v1/backoffice/orders/X/dispatch');
  });

  it('F23: rutas del historial, el recibo y la vista previa (id codificado) y su espejo mock', () => {
    expect(paths.myOrders()).toBe('/v1/me/orders');
    expect(paths.orderReceipt('a b')).toBe('/v1/orders/a%20b/receipt');
    expect(paths.orderReorderPreview('X')).toBe('/v1/orders/X/reorder-preview');
    expect(paths.demoMyDraftOrders()).toBe('/v1/demo/me/orders');
    expect(Object.keys(mockRoutes)).toEqual(
      expect.arrayContaining([
        'GET /v1/me/orders',
        'GET /v1/orders/:id/receipt',
        'POST /v1/orders/:id/reorder-preview',
      ]),
    );
  });

  it('cada ruta de paths tiene handler mock (paridad de superficie)', () => {
    const patterns = Object.keys(mockRoutes).map((k) => {
      const pattern = k.split(' ')[1] ?? '';
      return new RegExp(`^${pattern.replace(/:([A-Za-z]+)/g, '[^/]+')}$`);
    });
    for (const [name, build] of Object.entries(paths)) {
      const path = (build as (id: string) => string)('X');
      expect(
        patterns.some((r) => r.test(path)),
        `${name} → ${path}`,
      ).toBe(true);
    }
  });

  it('F14: rutas de medios (intent, complete, biblioteca) y de imágenes de producto; el PUT simulado solo en /v1/demo', () => {
    expect(paths.adminMediaUploadIntents()).toBe('/v1/admin/media/upload-intents');
    expect(paths.adminMediaComplete()).toBe('/v1/admin/media/complete');
    expect(paths.adminMediaList()).toBe('/v1/admin/media');
    expect(paths.adminMedia('m 1')).toBe('/v1/admin/media/m%201');
    expect(paths.adminProductMediaList('p1')).toBe('/v1/admin/products/p1/media');
    expect(paths.adminProductMediaOrder('p1')).toBe('/v1/admin/products/p1/media/order');
    expect(paths.adminProductMediaItem('p1', 'x/y')).toBe('/v1/admin/products/p1/media/x%2Fy');
    expect(paths.demoMediaObject('a1')).toBe('/v1/demo/media/objects/a1');
  });

  it('F13: rutas de precio y disponibilidad por sucursal; la demo de disponibilidad se retiró', () => {
    expect(paths.storeMenu()).toBe('/v1/store/menu');
    expect(paths.adminBranchProducts('b 1')).toBe('/v1/admin/branches/b%201/products');
    expect(paths.adminBranchProductPricing('b1', 'p1')).toBe(
      '/v1/admin/branches/b1/products/p1/pricing',
    );
    expect(paths.adminProductBranches('p1')).toBe('/v1/admin/products/p1/branches');
    expect(paths.adminProductAvailability('p1')).toBe('/v1/admin/products/p1/availability');
    expect(Object.keys(mockRoutes)).not.toContain(
      'PATCH /v1/demo/catalog/products/:id/availability',
    );
    expect('demoProductAvailability' in paths).toBe(false);
    // Los extras simulados siguen (ilustración, destacado, textos en inglés).
    expect(paths.demoProductExtras()).toBe('/v1/demo/catalog/product-extras');
    for (const key of [
      'GET /v1/store/menu',
      'GET /v1/admin/branches/:id/products',
      'GET /v1/admin/products/:id/branches',
      'PUT /v1/admin/branches/:id/products/:productId/pricing',
      'PATCH /v1/admin/products/:id/availability',
    ]) {
      expect(Object.keys(mockRoutes)).toContain(key);
    }
  });

  it('F17: rutas del bootstrap y la búsqueda; el mock registra los cuatro agregados públicos', () => {
    expect(paths.storeBootstrap()).toBe('/v1/store/bootstrap');
    expect(paths.storeSearch()).toBe('/v1/store/search');
    for (const key of [
      'GET /v1/store/bootstrap',
      'GET /v1/store/search',
      'GET /v1/store/menu',
      'GET /v1/store/products/:slug',
    ]) {
      expect(Object.keys(mockRoutes)).toContain(key);
    }
  });

  it('todas las rutas del documento de endpoints previstos están en el mock', () => {
    const doc = readFileSync(
      join(__dirname, '../../../../docs/contracts/planned-endpoints.md'),
      'utf8',
    );
    // Rutas del documento que el contrato real (F07) reemplazó: ahora son `/v1/admin/branches[...]`.
    // `/v1/delivery/quote` (tiers y ETA inventados) lo sustituye `POST /v1/delivery-coverage/check` (F09); F19 lo redefine.
    const superseded = new Set([
      '/v1/backoffice/branches',
      '/v1/backoffice/users',
      '/v1/delivery/quote',
      // F11: los sustituyen `/v1/store/products` y `/v1/admin/products`; lo no cubierto (disponibilidad F13) vive en `/v1/demo/catalog/*`.
      '/v1/catalog/products',
      '/v1/backoffice/products',
      // F13: la sustituyen `GET /v1/store/menu`, `/v1/admin/branches/{id}/products`, `/v1/admin/products/{id}/branches`,
      // `PUT …/pricing` y `PATCH /v1/admin/products/{id}/availability`; la ruta demo se RETIRÓ del mock.
      '/v1/demo/catalog/products/:id/availability',
      // F15: las sustituyen `GET /v1/store/promotions` y `/v1/admin/promotions[/{id}[/status]]`; las rutas mock previas se RETIRARON.
      '/v1/promotions',
      '/v1/backoffice/promotions',
      // F19: el documento la menciona SOLO para descartarla (la ruta vigente es `POST /v1/checkout/quote`).
      '/v1/store/checkout/quote',
      // F24: solo efectivo; el mock de tarjeta/Neonet se RETIRÓ (el contrato conserva el borrador para F25, BLOCKED_EXTERNAL).
      '/v1/payments/card',
    ]);
    // F28: el documento usa notación de familia (`/v1/admin/deliveries*`) y alternativas (`…/{mark-picked-up,mark-delivered}`):
    // la familia se cubre con las rutas concretas y las alternativas se expanden una por una.
    const expand = (path: string): string[] => {
      const alt = /\/\{([\w-]+(?:,[\w-]+)+)\}$/.exec(path);
      return alt
        ? (alt[1] ?? '').split(',').map((name) => path.replace(alt[0], `/${name}`))
        : [path];
    };
    const documented = [...doc.matchAll(/`(\/v1\/[^`?\s[]+)/g)]
      .map((m) => (m[1] ?? '').replace(/\{(\w+)\}/g, 'X'))
      .filter((path) => !path.endsWith('*'))
      .flatMap(expand)
      .filter((path) => !superseded.has(path));
    expect(documented.length).toBeGreaterThan(25);
    const registered = Object.keys(mockRoutes).map(
      (k) => new RegExp(`^${(k.split(' ')[1] ?? '').replace(/:([A-Za-z]+)/g, '[^/]+')}$`),
    );
    for (const path of documented) {
      expect(
        registered.some((r) => r.test(path)),
        path,
      ).toBe(true);
    }
  });
});
