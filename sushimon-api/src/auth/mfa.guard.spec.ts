import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { MfaGuard } from './mfa.guard.js';

function ctx(req: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('MfaGuard', () => {
  const guard = new MfaGuard();

  it('aal2 verificado en el principal → permite', () => {
    expect(guard.canActivate(ctx({ principal: { aal: 'aal2' } }))).toBe(true);
  });

  it('aal1 → 403 MFA_REQUIRED', () => {
    expect(() => guard.canActivate(ctx({ principal: { aal: 'aal1' } }))).toThrow(
      new ForbiddenException('MFA_REQUIRED'),
    );
  });

  it('sin principal → 401 (nunca permite)', () => {
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it('ignora body, query, cabeceras y cookies que afirmen aal2', () => {
    const req = {
      principal: { aal: 'aal1' },
      body: { aal: 'aal2' },
      query: { aal: 'aal2' },
      headers: { 'x-aal': 'aal2' },
      cookies: { aal: 'aal2' },
    };
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });
});
