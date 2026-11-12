import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { InvalidTokenError, type JwtVerifierService } from './jwt-verifier.service.js';

const TOKEN = 'aaa.bbb.ccc';

function setup(opts: { isPublic?: boolean; header?: string; verify?: () => Promise<unknown> }) {
  const req: Record<string, unknown> = { header: () => opts.header, id: 'req-1' };
  const res = { setHeader: vi.fn() };
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  const verifier = { verify: vi.fn(opts.verify ?? (() => Promise.resolve({ authUserId: 'u' }))) };
  const reflector = { getAllAndOverride: () => opts.isPublic } as unknown as Reflector;
  const guard = new JwtAuthGuard(reflector, verifier as unknown as JwtVerifierService);
  return { guard, ctx, req, res, verifier };
}

describe('JwtAuthGuard', () => {
  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('deja pasar rutas públicas sin verificar', async () => {
    const s = setup({ isPublic: true });
    await expect(s.guard.canActivate(s.ctx)).resolves.toBe(true);
    expect(s.verifier.verify).not.toHaveBeenCalled();
  });

  it('adjunta la identidad con un Bearer válido', async () => {
    const s = setup({ header: `Bearer ${TOKEN}` });
    await expect(s.guard.canActivate(s.ctx)).resolves.toBe(true);
    expect(s.verifier.verify).toHaveBeenCalledWith(TOKEN);
    expect(s.req['principal']).toEqual({ authUserId: 'u' });
  });

  it.each([
    undefined,
    '',
    'Bearer',
    `Basic ${TOKEN}`,
    `bearer ${TOKEN}`,
    `Bearer ${TOKEN} extra`,
    'Bearer a.b',
  ])('401 con cabecera %j', async (header) => {
    const s = setup({ header });
    await expect(s.guard.canActivate(s.ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(s.verifier.verify).not.toHaveBeenCalled();
    expect(s.res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
  });

  it('401 uniforme cuando la verificación falla (sin revelar el motivo)', async () => {
    const s = setup({
      header: `Bearer ${TOKEN}`,
      verify: () => Promise.reject(new InvalidTokenError('expired')),
    });
    const error = await s.guard.canActivate(s.ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).message).toBe('No autenticado');
  });

  it('un error inesperado del verificador también es 401', async () => {
    const s = setup({ header: `Bearer ${TOKEN}`, verify: () => Promise.reject(new Error('boom')) });
    await expect(s.guard.canActivate(s.ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
