import { translateStaffDbError } from './staff-db-errors.js';

const err = (props: Record<string, unknown>) => Object.assign(new Error('db'), props);

describe('translateStaffDbError', () => {
  it.each([
    [
      err({ code: 'P2002', meta: { target: ['email'] } }),
      409,
      'Ya existe un empleado con ese correo',
    ],
    [err({ code: 'P2002' }), 409, 'Ya existe un empleado con ese correo'],
    [err({ code: '23505', cause: { code: '23505' } }), 409, 'Ya existe un empleado con ese correo'],
    [err({ code: 'P2002', meta: { target: ['otra'] } }), 409, 'Conflicto con el estado actual'],
    [err({ code: '40001' }), 409, 'Conflicto de concurrencia, reintente'],
    [err({ code: 'P2034' }), 409, 'Conflicto de concurrencia, reintente'],
  ])('unique/serialización → 409', (error, status, message) => {
    expect(translateStaffDbError(error)).toMatchObject({ status, message });
  });

  it.each([
    ['CHECK (P2004)', err({ code: 'P2004' })],
    [
      'trigger/CHECK SQLSTATE 23514',
      err({ meta: { driverAdapterError: { cause: { originalCode: '23514' } } } }),
    ],
    ['FK (P2003)', err({ code: 'P2003' })],
    ['FK SQLSTATE 23503', err({ code: '23503' })],
  ])('%s → 400 genérico', (_n, error) => {
    const out = translateStaffDbError(error) as { status: number; response: { message: string[] } };
    expect(out.status).toBe(400);
    expect(JSON.stringify(out.response)).not.toMatch(/constraint|trigger|staff_/i);
  });

  it('otros errores pasan intactos (500 genérico en el filtro)', () => {
    const e = new Error('boom');
    expect(translateStaffDbError(e)).toBe(e);
    expect(translateStaffDbError('x')).toBe('x');
  });
});
