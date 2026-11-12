import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { HealthTokenGuard } from './health-token.guard.js';

const TOKEN = 'token-de-prueba-123456';
const ctx = (header?: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ header: () => header }) }),
  }) as unknown as ExecutionContext;
const guard = (expected?: string) =>
  new HealthTokenGuard({ get: () => expected } as unknown as ConfigService<never, true>);

describe('HealthTokenGuard', () => {
  it('permite con el token correcto', () => {
    expect(guard(TOKEN).canActivate(ctx(TOKEN))).toBe(true);
  });
  it.each([undefined, '', 'otro', `${TOKEN}x`])('rechaza token %j', (h) => {
    expect(() => guard(TOKEN).canActivate(ctx(h))).toThrow(UnauthorizedException);
  });
  it('sin token configurado queda abierto (solo fuera de producción)', () => {
    expect(guard(undefined).canActivate(ctx())).toBe(true);
  });
});
