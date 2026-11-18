import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { IS_OPTIONAL_AUTH_KEY } from './optional-auth.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
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

/** F19: `@OptionalAuth()` (ADR-0025 D2). El metadato se lee por clave: nunca confundirlo con `@Public()`. */
describe('JwtAuthGuard con @OptionalAuth()', () => {
  function setupKeys(
    keys: { isPublic?: boolean; isOptional?: boolean },
    header: string | undefined,
    verify: () => Promise<unknown> = () => Promise.resolve({ authUserId: 'u' }),
  ) {
    const req: Record<string, unknown> = { header: () => header, id: 'req-1' };
    const res = { setHeader: vi.fn() };
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    const verifier = { verify: vi.fn(verify) };
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === IS_PUBLIC_KEY
          ? keys.isPublic
          : key === IS_OPTIONAL_AUTH_KEY
            ? keys.isOptional
            : undefined,
    } as unknown as Reflector;
    return {
      guard: new JwtAuthGuard(reflector, verifier as unknown as JwtVerifierService),
      ctx,
      req,
      res,
      verifier,
    };
  }

  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('sin cabecera Authorization => invitado: pasa, sin verificar y sin principal', async () => {
    const s = setupKeys({ isOptional: true }, undefined);
    await expect(s.guard.canActivate(s.ctx)).resolves.toBe(true);
    expect(s.verifier.verify).not.toHaveBeenCalled();
    expect(s.req['principal']).toBeUndefined();
  });

  it('token válido => principal poblado (antes del throttler por actor)', async () => {
    const s = setupKeys({ isOptional: true }, `Bearer ${TOKEN}`);
    await expect(s.guard.canActivate(s.ctx)).resolves.toBe(true);
    expect(s.req['principal']).toEqual({ authUserId: 'u' });
  });

  it.each(['', 'Bearer', `Basic ${TOKEN}`, `bearer ${TOKEN}`, 'Bearer a.b', `Bearer ${TOKEN} x`])(
    'cabecera presente pero inválida %j => 401 (nunca se degrada a invitado)',
    async (header) => {
      const s = setupKeys({ isOptional: true }, header);
      await expect(s.guard.canActivate(s.ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(s.req['principal']).toBeUndefined();
    },
  );

  it('token con firma/vigencia inválida => 401 aunque la ruta sea opcional', async () => {
    const s = setupKeys({ isOptional: true }, `Bearer ${TOKEN}`, () =>
      Promise.reject(new InvalidTokenError('expired')),
    );
    await expect(s.guard.canActivate(s.ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(s.req['principal']).toBeUndefined();
  });

  it('REGRESIÓN: sin el metadato, la ausencia de token sigue siendo 401', async () => {
    const s = setupKeys({}, undefined);
    await expect(s.guard.canActivate(s.ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    const explicit = setupKeys({ isOptional: false }, undefined);
    await expect(explicit.guard.canActivate(explicit.ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(explicit.res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
  });

  it('@Public() sigue pasando sin verificar y @OptionalAuth() no equivale a @Public()', async () => {
    const pub = setupKeys({ isPublic: true }, undefined);
    await expect(pub.guard.canActivate(pub.ctx)).resolves.toBe(true);
    const opt = setupKeys({ isOptional: true }, `Bearer ${TOKEN}`);
    await opt.guard.canActivate(opt.ctx);
    expect(opt.verifier.verify).toHaveBeenCalledWith(TOKEN);
  });
});
