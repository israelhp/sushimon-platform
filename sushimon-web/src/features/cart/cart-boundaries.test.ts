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

  it('clearAfterOrder (solo pedido REAL, F20): solo se INVOCA desde use-place-order.ts con un id confirmado; nadie más vacía por pedido', () => {
    const relative = (f: string) => f.replace(/^.*\/src\//, 'src/');
    const callers = files
      .filter((f) => /\.clearAfterOrder\(/.test(readFileSync(f, 'utf8')))
      .map(relative);
    expect(callers).toEqual(['src/features/checkout/use-place-order.ts']);
    const caller = readFileSync(join(root, 'features/checkout/use-place-order.ts'), 'utf8');
    // Solo con el id construido por `confirmedOrderId(created)` y solo tras el 200/201 (nunca en el `catch`).
    expect(caller).toMatch(/const id = confirmedOrderId\(created\)/);
    expect(caller).toMatch(/if \(l\.clearCart\) l\.cart\.clearAfterOrder\(id\)/);
    const catchBlock = caller.slice(caller.indexOf('} catch (error) {'));
    expect(catchBlock.slice(0, catchBlock.indexOf('finally'))).not.toMatch(/clearAfterOrder/);
  });

  it('ConfirmedOrderId es un tipo marcado: solo lo construye confirmedOrderId(created) y clearAfterOrder no acepta string', () => {
    const ctx = readFileSync(join(root, 'features/cart/cart-context.tsx'), 'utf8');
    expect(ctx).toMatch(/clearAfterOrder: \(orderId: ConfirmedOrderId\) => void/);
    const brand = readFileSync(join(root, 'features/cart/confirmed-order.ts'), 'utf8');
    expect(brand).toMatch(/unique symbol/);
    const casters = files
      .filter((f) => /as ConfirmedOrderId/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(/^.*\/src\//, 'src/'));
    expect(casters).toEqual(['src/features/cart/confirmed-order.ts']);
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

  it('toQuoteInput solo lo consume la cotización de checkout (F19, use-checkout-data)', () => {
    const callers = files
      .filter((f) => /toQuoteInput\(/.test(readFileSync(f, 'utf8')) && !/cart-rules\.ts$/.test(f))
      .map((f) => f.replace(/^.*\/src\//, 'src/'));
    expect(callers).toEqual(['src/features/checkout/use-checkout-data.ts']);
  });
});
