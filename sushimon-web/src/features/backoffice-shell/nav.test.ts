import { describe, expect, it } from 'vitest';
import type { Grants } from '@/lib/permissions';
import { demoStaffFromSeed } from '@/mocks/fixtures/staff';
import { navForGrants, screenFromPath, screenHref } from './nav';

const screensOf = (grants: Grants) =>
  navForGrants(grants).flatMap((s) => s.items.map((i) => i.screen));
const grantsOf = (userId: string) => demoStaffFromSeed(userId).grants;

describe('menú por permisos (grants del contexto administrativo)', () => {
  it('administrador ve las 10 pantallas en 3 secciones', () => {
    expect(screensOf(grantsOf('u1'))).toEqual([
      'panel',
      'pedidos',
      'entregas',
      'productos',
      'categorias',
      'promociones',
      'sucursales',
      'usuarios',
      'roles',
      'reportes',
    ]);
    expect(navForGrants(grantsOf('u1')).map((s) => s.key)).toEqual([
      'operation',
      'catalog',
      'admin',
    ]);
  });

  it('encargado ve operación, productos, categorías (lectura, F10), su sucursal, usuarios, roles (lectura) y reportes', () => {
    expect(screensOf(grantsOf('u2'))).toEqual([
      'panel',
      'pedidos',
      'entregas',
      'productos',
      'categorias',
      'sucursales',
      'usuarios',
      'roles',
      'reportes',
    ]);
  });

  it('cocina solo ve Pedidos y se omiten las secciones vacías', () => {
    expect(screensOf(grantsOf('u5'))).toEqual(['pedidos']);
    expect(navForGrants(grantsOf('u5'))).toHaveLength(1);
  });

  it('empleado ve Pedidos y Entregas', () => {
    expect(screensOf(grantsOf('u9'))).toEqual(['pedidos', 'entregas']);
  });

  it('sin permisos no hay menú; un permiso suelto abre solo su pantalla', () => {
    expect(navForGrants({})).toEqual([]);
    expect(screensOf({ 'promotions.read': { allBranches: false, branchIds: ['b1'] } })).toEqual([
      'promociones',
    ]);
    // Un permiso sin sucursales no concede nada.
    expect(screensOf({ 'orders.read': { allBranches: false, branchIds: [] } })).toEqual([]);
  });
});

describe('rutas', () => {
  it('construye y reconoce las rutas reales', () => {
    expect(screenHref('pedidos')).toBe('/backoffice/pedidos');
    expect(screenHref('roles')).toBe('/backoffice/roles');
    expect(screenFromPath('/backoffice/entregas')).toBe('entregas');
    expect(screenFromPath('/backoffice/roles')).toBe('roles');
    expect(screenFromPath('/backoffice/login')).toBeNull();
    expect(screenFromPath(null)).toBeNull();
  });
});
