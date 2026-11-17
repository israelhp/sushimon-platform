import { translateStoreDbError } from './store-db-errors.js';

const code = (e: unknown) => (e as { getResponse: () => { code: string } }).getResponse().code;

describe('translateStoreDbError', () => {
  it.each(['P2028', 'P2024', 'P1001', 'P1008', '55P03', '40P01', '40001', '57014'])(
    '%s => 503 STORE_BUSY con mensaje fijo (sin la causa)',
    (c) => {
      const out = translateStoreDbError(
        Object.assign(new Error('password authentication failed for user "postgres"'), { code: c }),
      );
      expect((out as { getStatus: () => number }).getStatus()).toBe(503);
      expect(code(out)).toBe('STORE_BUSY');
      expect(JSON.stringify((out as { getResponse: () => unknown }).getResponse())).not.toContain(
        'password',
      );
    },
  );
  it('el SQLSTATE también se reconoce dentro de meta/cause (adaptador pg)', () => {
    const viaCause = translateStoreDbError({ cause: { originalCode: '40001' } });
    const viaMeta = translateStoreDbError({
      meta: { driverAdapterError: { cause: { originalCode: '55P03' } } },
    });
    expect(code(viaCause)).toBe('STORE_BUSY');
    expect(code(viaMeta)).toBe('STORE_BUSY');
  });
  it('cualquier otro error vuelve igual (=> 500 genérico del filtro)', () => {
    const other = Object.assign(new Error('x'), { code: 'P2002' });
    expect(translateStoreDbError(other)).toBe(other);
    expect(translateStoreDbError('texto')).toBe('texto');
    expect(translateStoreDbError(null)).toBeNull();
  });
});
