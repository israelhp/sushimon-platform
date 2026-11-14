import { BadRequestException, ConflictException } from '@nestjs/common';
import { translateBranchDbError } from './branch-db-errors.js';

describe('translateBranchDbError', () => {
  it.each([
    ['P2002 de code', { code: 'P2002', meta: { target: ['code'] } }],
    ['P2002 sin objetivo informado', { code: 'P2002' }],
    ['23505 de branches_code_key', { cause: { code: '23505' }, constraint: 'branches_code_key' }],
    [
      'P2002 vía adaptador',
      {
        code: 'P2002',
        meta: {
          driverAdapterError: { cause: { originalCode: '23505', constraint: 'branches_code_key' } },
        },
      },
    ],
  ])('%s → 409', (_n, e) => {
    expect(translateBranchDbError(e)).toBeInstanceOf(ConflictException);
  });

  it('UNIQUE de otra restricción no es 409 (se propaga)', () => {
    const e = { code: 'P2002', meta: { target: ['audit_events_pkey'] } };
    expect(translateBranchDbError(e)).toBe(e);
  });

  it.each([
    { code: 'P2004' },
    { code: '23514' },
    { cause: { code: '23514' } },
    { meta: { code: '23514' } },
  ])('CHECK %j → 400 genérico sin nombre de restricción', (e) => {
    const out = translateBranchDbError({ ...e, message: 'branches_code_format' });
    expect(out).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((out as BadRequestException).getResponse())).not.toContain('branches_');
  });

  it('errores desconocidos se devuelven tal cual (500 en el filtro)', () => {
    const e = new Error('boom');
    expect(translateBranchDbError(e)).toBe(e);
    expect(translateBranchDbError(null)).toBeNull();
  });
});
