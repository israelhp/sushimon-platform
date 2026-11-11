import { describe, expect, it } from 'vitest';
import { ROLE_MENU } from '@/lib/permissions';
import { navForRole, screenFromPath, screenHref } from './nav';

const screensOf = (role: 'admin' | 'manager' | 'kitchen') =>
  navForRole(role).flatMap((s) => s.items.map((i) => i.screen));

describe('menú por rol', () => {
  it('administrador ve las 9 pantallas en 3 secciones', () => {
    expect(screensOf('admin')).toEqual(ROLE_MENU.admin);
    expect(navForRole('admin').map((s) => s.key)).toEqual(['operation', 'catalog', 'admin']);
  });

  it('encargado ve su operación, productos y reportes', () => {
    expect(screensOf('manager')).toEqual(['panel', 'pedidos', 'entregas', 'productos', 'reportes']);
  });

  it('cocina solo ve Pedidos (sin Entregas) y se omiten las secciones vacías', () => {
    expect(screensOf('kitchen')).toEqual(['pedidos']);
    expect(navForRole('kitchen')).toHaveLength(1);
  });
});

describe('rutas', () => {
  it('construye y reconoce las rutas reales', () => {
    expect(screenHref('pedidos')).toBe('/backoffice/pedidos');
    expect(screenFromPath('/backoffice/entregas')).toBe('entregas');
    expect(screenFromPath('/backoffice/login')).toBeNull();
    expect(screenFromPath(null)).toBeNull();
  });
});
