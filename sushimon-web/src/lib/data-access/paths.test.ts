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
    const documented = [...doc.matchAll(/`(\/v1\/[^`?\s[]+)/g)].map((m) =>
      (m[1] ?? '').replace(/\{(\w+)\}/g, 'X'),
    );
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
