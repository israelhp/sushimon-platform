import { HttpException } from '@nestjs/common';
import { translateRidersDbError } from './riders-errors.js';

const pgError = (code: string, message = 'x') => ({
  code: 'P2010',
  meta: { code, message },
  message,
});
const codeOf = (e: unknown) => (e as HttpException).getResponse() as { code?: string };

describe('translateRidersDbError', () => {
  const guard = 'ERROR: app.riders: la sucursal debe existir y estar activa';

  it('23514 del trigger de sucursal => 422 BRANCH_NOT_AVAILABLE (solo con branchCheck)', () => {
    const out = translateRidersDbError(pgError('23514', guard), { branchCheck: true });
    expect((out as HttpException).getStatus()).toBe(422);
    expect(codeOf(out).code).toBe('BRANCH_NOT_AVAILABLE');
    const raw = pgError('23514', guard);
    expect(translateRidersDbError(raw)).toBe(raw);
  });

  it('cualquier otro 23514 (CHECK de formato, versión, etc.) NO se traduce: queda como error interno', () => {
    for (const msg of [
      'new row violates check constraint "riders_phone_check"',
      'app.riders: todo UPDATE debe subir version en 1',
    ]) {
      const raw = pgError('23514', msg);
      const out = translateRidersDbError(raw, { branchCheck: true });
      expect(out).toBe(raw);
      expect(out).not.toBeInstanceOf(HttpException);
    }
  });

  it('23503/P2003 (FK de sucursal) => 422; 23505 => 409 sin detalles', () => {
    expect(codeOf(translateRidersDbError({ code: '23503' }, { branchCheck: true })).code).toBe(
      'BRANCH_NOT_AVAILABLE',
    );
    expect(codeOf(translateRidersDbError({ code: 'P2003' }, { branchCheck: true })).code).toBe(
      'BRANCH_NOT_AVAILABLE',
    );
    const dup = translateRidersDbError({ code: '23505' });
    expect((dup as HttpException).getStatus()).toBe(409);
    expect(JSON.stringify((dup as HttpException).getResponse())).not.toMatch(/riders_|constraint/);
  });
});
