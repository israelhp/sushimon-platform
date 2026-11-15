import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it.each([
    ['/cuenta', '/cuenta'],
    ['/backoffice/pedidos?x=1#a', '/backoffice/pedidos?x=1#a'],
    ['/', '/'],
  ])('acepta %s', (input, out) => {
    expect(safeNextPath(input)).toBe(out);
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'cuenta',
    '/a\nb',
    '/\t/evil.example',
    '/\u0000/evil',
    '/' + 'x'.repeat(400),
    '',
  ])('rechaza %j', (input) => {
    expect(safeNextPath(input, '/inicio')).toBe('/inicio');
  });

  // Payloads de open redirect: nunca pueden salir del origen. Lo que se acepta se normaliza a una ruta interna.
  it.each(['/%2F%2Fevil.example', '/..//evil.example', '/%5Cevil.example', '/./\\evil.example'])(
    'no deja salir del origen con %j',
    (input) => {
      const out = safeNextPath(input, '/inicio');
      expect(out.startsWith('/')).toBe(true);
      expect(out.startsWith('//')).toBe(false);
      expect(out.startsWith('/\\')).toBe(false);
      expect(new URL(out, 'http://internal.invalid').origin).toBe('http://internal.invalid');
    },
  );

  it('usa el valor por defecto con null/undefined', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined, '/x')).toBe('/x');
  });
});
