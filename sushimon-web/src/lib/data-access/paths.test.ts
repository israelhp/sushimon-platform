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
    ]);
    const documented = [...doc.matchAll(/`(\/v1\/[^`?\s[]+)/g)]
      .map((m) => (m[1] ?? '').replace(/\{(\w+)\}/g, 'X'))
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
