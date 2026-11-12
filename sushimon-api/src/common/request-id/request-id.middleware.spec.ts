import type { Request, Response } from 'express';
import { requestIdMiddleware } from './request-id.middleware.js';

function run(incoming?: string) {
  const req = { header: () => incoming } as unknown as Request;
  const setHeader = vi.fn();
  const res = { setHeader } as unknown as Response;
  const next = vi.fn();
  requestIdMiddleware(req, res, next);
  return { req, setHeader, next };
}

describe('requestIdMiddleware', () => {
  it('genera un UUID y lo devuelve en la cabecera', () => {
    const { req, setHeader, next } = run();
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(next).toHaveBeenCalled();
  });
  it('reutiliza un id entrante seguro', () => {
    expect(run('trace-abc-12345').req.id).toBe('trace-abc-12345');
  });
  it.each(['corto', 'con espacios y\nsalto', 'x'.repeat(65), '<script>alert(1)</script>'])(
    'descarta id inseguro %j',
    (bad) => {
      expect(run(bad).req.id).not.toBe(bad);
    },
  );
});
