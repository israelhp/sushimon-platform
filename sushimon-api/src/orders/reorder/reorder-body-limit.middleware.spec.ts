import { PayloadTooLargeException } from '@nestjs/common';
import type { Request } from 'express';
import {
  REORDER_MAX_BODY_BYTES,
  reorderBodyLimitMiddleware,
} from './reorder-body-limit.middleware.js';

const req = (contentLength: string | undefined, body: unknown) =>
  ({
    header: (name: string) => (name === 'content-length' ? contentLength : undefined),
    body,
  }) as unknown as Request;

const run = (r: Request) => {
  const next = vi.fn();
  let error: unknown = null;
  try {
    reorderBodyLimitMiddleware(r, {} as never, next);
  } catch (e) {
    error = e;
  }
  return { next, error };
};

describe('reorderBodyLimitMiddleware (F23)', () => {
  it('acepta ausente, `{}` y branchId', () => {
    for (const r of [req(undefined, undefined), req('2', {}), req('50', { branchId: 'x' })]) {
      const { next, error } = run(r);
      expect(error).toBeNull();
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it('Content-Length declarado > 2 KB => 413 sin llamar a next', () => {
    const { next, error } = run(req(String(REORDER_MAX_BODY_BYTES + 1), {}));
    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect(next).not.toHaveBeenCalled();
  });

  it('sin Content-Length (chunked) mide el JSON ya parseado', () => {
    const { error } = run(req(undefined, { x: 'a'.repeat(REORDER_MAX_BODY_BYTES) }));
    expect(error).toBeInstanceOf(PayloadTooLargeException);
  });
});
