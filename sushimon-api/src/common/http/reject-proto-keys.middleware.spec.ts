import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { rejectProtoKeysMiddleware } from './reject-proto-keys.middleware.js';

const run = (body: unknown) => {
  const next = vi.fn();
  const call = () => rejectProtoKeysMiddleware({ body } as Request, {} as Response, next);
  return { next, call };
};

describe('rejectProtoKeysMiddleware', () => {
  it('rechaza __proto__ en cualquier nivel', () => {
    expect(run(JSON.parse('{"a":1,"__proto__":{"x":1}}')).call).toThrow(BadRequestException);
    expect(run(JSON.parse('{"a":{"b":[{"__proto__":1}]}}')).call).toThrow(BadRequestException);
  });

  it('deja pasar cuerpos normales, vacíos o ausentes', () => {
    for (const body of [{ a: 1, b: { c: [1, 2] } }, {}, undefined, null, 'texto']) {
      const { call, next } = run(body);
      call();
      expect(next).toHaveBeenCalledOnce();
    }
  });
});
