import type { Request, Response } from 'express';
import { checkoutBodyLimitMiddleware } from './checkout-body-limit.middleware.js';

const run = (contentLength: string | undefined, body: unknown) => {
  const next = vi.fn();
  const req = { header: () => contentLength, body } as unknown as Request;
  const call = () => checkoutBodyLimitMiddleware(req, {} as Response, next);
  return { call, next };
};

describe('checkoutBodyLimitMiddleware (64 KB)', () => {
  it('deja pasar cuerpos pequeños', () => {
    const { call, next } = run('200', { a: 1 });
    call();
    expect(next).toHaveBeenCalledOnce();
  });

  it('Content-Length declarado > 64 KB => 400 QUOTE_LIMITS_EXCEEDED', () => {
    const { call, next } = run('65537', {});
    expect(call).toThrow(expect.objectContaining({ status: 400 }));
    expect(next).not.toHaveBeenCalled();
  });

  it('sin Content-Length (chunked): mide el JSON ya parseado', () => {
    const { call } = run(undefined, { x: 'a'.repeat(70_000) });
    expect(call).toThrow(expect.objectContaining({ status: 400 }));
    const ok = run(undefined, { x: 'a'.repeat(60_000) });
    ok.call();
    expect(ok.next).toHaveBeenCalledOnce();
  });

  it('exactamente 64 KB pasa', () => {
    const { call, next } = run('65536', {});
    call();
    expect(next).toHaveBeenCalledOnce();
  });

  const sel = (n: number) => Array.from({ length: n }, () => ({}));
  const cart = (lines: unknown[]) => ({ cart: { lines } });

  it('más de 30 líneas => 400 QUOTE_LIMITS_EXCEEDED antes de validar', () => {
    const lines = Array.from({ length: 31 }, () => ({ selections: [] }));
    const { call } = run('100', cart(lines));
    expect(call).toThrow(expect.objectContaining({ status: 400 }));
    const ok = run('100', cart(lines.slice(0, 30)));
    ok.call();
    expect(ok.next).toHaveBeenCalledOnce();
  });

  it('más de 30 selecciones en una línea o más de 300 en total => 400', () => {
    expect(run('100', cart([{ selections: sel(31) }])).call).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    const ok = run('100', cart([{ selections: sel(30) }]));
    ok.call();
    expect(ok.next).toHaveBeenCalledOnce();
    const eleven = Array.from({ length: 11 }, () => ({ selections: sel(28) })); // 308
    expect(run('100', cart(eleven)).call).toThrow(expect.objectContaining({ status: 400 }));
    const ten = Array.from({ length: 10 }, () => ({ selections: sel(30) })); // 300 exactos
    const exact = run('100', cart(ten));
    exact.call();
    expect(exact.next).toHaveBeenCalledOnce();
  });

  it('formas raras no lanzan TypeError (las rechazan los pipes después)', () => {
    for (const body of [
      undefined,
      null,
      'x',
      5,
      {},
      { cart: null },
      { cart: { lines: 'x' } },
      { cart: { lines: [null, 3, { selections: 'x' }] } },
    ]) {
      const r = run('10', body);
      expect(() => r.call()).not.toThrow();
      expect(r.next).toHaveBeenCalledOnce();
    }
  });
});
