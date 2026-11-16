import { isUniqueViolation, translateMediaDbError } from './media-db-errors.js';

const payload = (e: unknown) => (e as { getResponse(): Record<string, unknown> }).getResponse();
const status = (e: unknown) => (e as { getStatus(): number }).getStatus();

describe('translateMediaDbError', () => {
  it.each(['P2028', '55P03', '40P01', '40001'])('%s => 503 MEDIA_BUSY (mensaje fijo)', (code) => {
    const out = translateMediaDbError(
      Object.assign(new Error('detalle interno SELECT ...'), { code }),
    );
    expect(status(out)).toBe(503);
    expect(payload(out)['code']).toBe('MEDIA_BUSY');
    expect(JSON.stringify(payload(out))).not.toContain('SELECT');
  });

  it('el SQLSTATE puede venir anidado en meta/cause', () => {
    expect(payload(translateMediaDbError({ meta: { code: '55P03' } }))['code']).toBe('MEDIA_BUSY');
    expect(payload(translateMediaDbError({ cause: { originalCode: '40P01' } }))['code']).toBe(
      'MEDIA_BUSY',
    );
    expect(
      payload(
        translateMediaDbError({
          meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
        }),
      )['code'],
    ).toBe('MEDIA_BUSY');
  });

  it('FK RESTRICT (P2003/23503) => 409 MEDIA_IN_USE', () => {
    for (const code of ['P2003', '23503']) {
      const out = translateMediaDbError({ code });
      expect(status(out)).toBe(409);
      expect(payload(out)['code']).toBe('MEDIA_IN_USE');
    }
  });

  it('lo desconocido pasa intacto (500 genérico)', () => {
    const generic = new Error('boom');
    expect(translateMediaDbError(generic)).toBe(generic);
    expect(translateMediaDbError('x')).toBe('x');
    expect(translateMediaDbError(null)).toBeNull();
    const unique = { code: 'P2002' };
    expect(translateMediaDbError(unique)).toBe(unique);
  });

  it('isUniqueViolation reconoce P2002 y 23505', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ code: 'P2003' })).toBe(false);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
  });
});
