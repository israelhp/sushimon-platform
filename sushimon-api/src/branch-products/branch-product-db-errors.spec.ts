import { translateBranchProductDbError } from './branch-product-db-errors.js';

const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { status?: number }).status;

describe('translateBranchProductDbError', () => {
  it('P2028, 55P03, 40P01 y 40001 => 503 BRANCH_PRODUCTS_BUSY', () => {
    for (const c of ['P2028', '55P03', '40P01', '40001']) {
      const e = translateBranchProductDbError({ code: c });
      expect(status(e), c).toBe(503);
      expect(code(e), c).toBe('BRANCH_PRODUCTS_BUSY');
    }
    expect(code(translateBranchProductDbError({ cause: { code: '40001' } }))).toBe(
      'BRANCH_PRODUCTS_BUSY',
    );
    expect(
      code(
        translateBranchProductDbError({
          meta: { driverAdapterError: { cause: { originalCode: '55P03' } } },
        }),
      ),
    ).toBe('BRANCH_PRODUCTS_BUSY');
  });

  it('FK por carrera: sucursal => BRANCH_NOT_FOUND; producto => PRODUCT_NOT_FOUND; otra => mismo error', () => {
    const branch = translateBranchProductDbError({
      code: 'P2003',
      message: 'violates "branch_products_branch_id_fkey"',
    });
    expect([status(branch), code(branch)]).toEqual([404, 'BRANCH_NOT_FOUND']);
    const product = translateBranchProductDbError({
      code: '23503',
      meta: { message: 'branch_products_product_id_fkey' },
    });
    expect([status(product), code(product)]).toEqual([404, 'PRODUCT_NOT_FOUND']);
    const other = { code: 'P2003', message: 'otra_fkey' };
    expect(translateBranchProductDbError(other)).toBe(other);
  });

  it('CHECK => 400 genérico', () => {
    expect(status(translateBranchProductDbError({ code: '23514' }))).toBe(400);
  });

  it('errores desconocidos o no objetos pasan sin cambios', () => {
    const unknown = new Error('boom');
    expect(translateBranchProductDbError(unknown)).toBe(unknown);
    expect(translateBranchProductDbError('x')).toBe('x');
    expect(translateBranchProductDbError(null)).toBeNull();
  });
});
