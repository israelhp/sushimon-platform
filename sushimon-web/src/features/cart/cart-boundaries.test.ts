import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}
const root = join(__dirname, '..', '..');

describe('límites del carrito (#34, F18)', () => {
  const files = sources(root);

  it('clearAfterOrder (solo pedido REAL, F20) NO existe aún: ni en el contexto ni en ninguna pantalla', () => {
    const used = files.filter((f) =>
      /clearAfterOrder\s*[(:=]|\.clearAfterOrder/.test(readFileSync(f, 'utf8')),
    );
    expect(used).toEqual([]);
  });

  it('el carrito no usa fetch ni toca otra clave de almacenamiento que monsushi-cart-v2/v1', () => {
    for (const f of files.filter(
      (x) => /features\/cart\//.test(x) || /lib\/cart-rules\.ts$/.test(x),
    )) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/\bfetch\(/);
      expect(text, f).not.toMatch(/sessionStorage/);
    }
  });

  it('toQuoteInput no se consume todavía: la cotización real es F19', () => {
    const callers = files.filter(
      (f) => /toQuoteInput\(/.test(readFileSync(f, 'utf8')) && !/cart-rules\.ts$/.test(f),
    );
    expect(callers).toEqual([]);
  });
});
