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
