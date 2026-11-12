import { describe, expect, it } from 'vitest';
import { PRIMARY_NAV, STORE_ROUTES, isMoreActive, isRouteActive } from './nav';

const home = PRIMARY_NAV.find((i) => i.label === 'home')!;
const menu = PRIMARY_NAV.find((i) => i.label === 'menu')!;

describe('navegación de la tienda', () => {
  it('Inicio solo está activo en la raíz; Menú y Promos por prefijo', () => {
    expect(isRouteActive('/', home)).toBe(true);
    expect(isRouteActive('/menu', home)).toBe(false);
    expect(isRouteActive('/menu', menu)).toBe(true);
    expect(isRouteActive('/menu/rolls', menu)).toBe(true);
    expect(isRouteActive('/promociones', menu)).toBe(false);
  });

  it('Más agrupa cuenta, pedidos, consultar, incidencias y empleo', () => {
    for (const path of [
      '/mas',
      '/cuenta',
      '/cuenta/direcciones',
      '/pedidos/MON-490217',
      '/consultar',
      '/incidencias',
      '/trabaja-con-nosotros',
    ]) {
      expect(isMoreActive(path), path).toBe(true);
    }
    for (const path of ['/', '/menu', '/promociones', '/checkout']) {
      expect(isMoreActive(path), path).toBe(false);
    }
  });

  it('enlaza todas las rutas reales de la tienda', () => {
    expect(Object.values(STORE_ROUTES)).toEqual(
      expect.arrayContaining([
        '/',
        '/menu',
        '/promociones',
        '/checkout',
        '/mas',
        '/cuenta',
        '/consultar',
        '/incidencias',
        '/trabaja-con-nosotros',
      ]),
    );
  });
});
