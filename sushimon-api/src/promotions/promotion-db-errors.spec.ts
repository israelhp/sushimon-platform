import { translatePromotionDbError } from './promotion-db-errors.js';

const body = (e: unknown) => (e as { getResponse?: () => { code?: string } }).getResponse?.() ?? {};
const status = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();

describe('translatePromotionDbError', () => {
  it.each(['P2028', '55P03', '40P01', '40001'])('%s => 503 PROMOTIONS_BUSY', (code) => {
    const e = translatePromotionDbError({ code });
    expect(status(e)).toBe(503);
    expect(body(e).code).toBe('PROMOTIONS_BUSY');
  });
  it('UNIQUE de code => 409 PROMOTION_CODE_TAKEN', () => {
    const e = translatePromotionDbError({
      code: 'P2002',
      meta: { target: ['promotions_code_key'] },
    });
    expect(status(e)).toBe(409);
    expect(body(e).code).toBe('PROMOTION_CODE_TAKEN');
  });
  it('UNIQUE con target ["code"] (adaptador) => 409; otro P2002 aunque su mensaje mencione code => tal cual', () => {
    const adapter = {
      code: 'P2002',
      meta: { driverAdapterError: { cause: { constraint: { fields: ['code'] } } } },
    };
    expect(body(translatePromotionDbError(adapter)).code).toBe('PROMOTION_CODE_TAKEN');
    const other = {
      code: 'P2002',
      message: 'Unique constraint failed on promotion_weekdays_pkey (code)',
      meta: { target: ['promotion_weekdays_pkey'] },
    };
    expect(translatePromotionDbError(other)).toBe(other);
  });
  it('UNIQUE de otra restricción se devuelve tal cual (=> 500)', () => {
    const err = { code: 'P2002', meta: { target: ['otra_cosa_key'] } };
    expect(translatePromotionDbError(err)).toBe(err);
  });
  it('FK de sucursal => 404 BRANCH_NOT_FOUND; de producto => 422 PROMOTION_SCOPE_INVALID', () => {
    const b = translatePromotionDbError({
      code: '23503',
      message: 'promotion_branches_branch_id_fkey',
    });
    expect(status(b)).toBe(404);
    expect(body(b).code).toBe('BRANCH_NOT_FOUND');
    const p = translatePromotionDbError({
      code: 'P2003',
      message: 'promotion_products_product_id_fkey',
    });
    expect(status(p)).toBe(422);
    expect(body(p).code).toBe('PROMOTION_SCOPE_INVALID');
  });
  it('EXCLUDE (23P01) => 422 PROMOTION_SCHEDULE_INVALID; CHECK => 400', () => {
    expect(body(translatePromotionDbError({ code: '23P01' })).code).toBe(
      'PROMOTION_SCHEDULE_INVALID',
    );
    expect(status(translatePromotionDbError({ code: '23514' }))).toBe(400);
  });
  it('errores desconocidos pasan sin cambios', () => {
    const err = new Error('x');
    expect(translatePromotionDbError(err)).toBe(err);
    expect(translatePromotionDbError('x')).toBe('x');
  });
});
