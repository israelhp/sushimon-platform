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
    '/' + 'x'.repeat(400),
    '',
  ])('rechaza %j', (input) => {
    expect(safeNextPath(input, '/inicio')).toBe('/inicio');
  });

  it('usa el valor por defecto con null/undefined', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined, '/x')).toBe('/x');
  });
});
