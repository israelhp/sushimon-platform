import { BadRequestException } from '@nestjs/common';
import { translateProductDbError } from './product-db-errors.js';

const payload = (e: unknown) => (e as { getResponse(): Record<string, unknown> }).getResponse();
const status = (e: unknown) => (e as { getStatus(): number }).getStatus();

describe('translateProductDbError', () => {
  it('UNIQUE de slug => 409 PRODUCT_SLUG_TAKEN (P2002 o 23505, por columna o por restricción)', () => {
    for (const error of [
      Object.assign(new Error('u'), { code: 'P2002', meta: { target: ['slug'] } }),
      { code: '23505', constraint: 'products_slug_key' },
      { cause: { code: '23505' }, meta: { constraint: 'products_slug_key' } },
    ]) {
      const out = translateProductDbError(error);
      expect(status(out)).toBe(409);
      expect(payload(out)['code']).toBe('PRODUCT_SLUG_TAKEN');
    }
  });
  it('UNIQUE de sku => 409 PRODUCT_SKU_TAKEN', () => {
    for (const error of [
      { code: 'P2002', meta: { target: ['sku'] } },
      { code: '23505', constraint: 'products_sku_key' },
    ]) {
      const out = translateProductDbError(error);
      expect(status(out)).toBe(409);
      expect(payload(out)['code']).toBe('PRODUCT_SKU_TAKEN');
    }
  });
  it('otra restricción única o sin objetivo => NO es 409: mismo error (500 genérico)', () => {
    for (const error of [
      { code: 'P2002', meta: { target: ['id'] } },
      { code: '23505', constraint: 'product_media_product_sort_key' },
      { code: '23505', constraint: 'products_pkey' },
      { code: '23505' },
      { cause: { code: '23505' } },
    ]) {
      expect(translateProductDbError(error)).toBe(error);
    }
  });
  it('P2028 y 55P03 => 503 PRODUCTS_BUSY con mensaje fijo, sin filtrar el original', () => {
    for (const error of [
      { code: 'P2028', message: 'Transaction already closed: host=db-prod' },
      { cause: { code: '55P03' }, message: 'lock timeout host=db-prod' },
      { meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } },
    ]) {
      const out = translateProductDbError(error);
      expect(status(out)).toBe(503);
      expect(payload(out)).toMatchObject({ code: 'PRODUCTS_BUSY' });
      expect(JSON.stringify(payload(out))).not.toContain('db-prod');
    }
  });
  it('trigger product_media_max_items (23514) => 422 PRODUCT_MEDIA_INVALID', () => {
    for (const error of [
      { code: '23514', message: 'ERROR: product_media_max_items' },
      {
        meta: { driverAdapterError: { cause: { originalCode: '23514' } } },
        cause: { message: 'product_media_max_items' },
      },
    ]) {
      const out = translateProductDbError(error);
      expect(status(out)).toBe(422);
      expect(payload(out)['code']).toBe('PRODUCT_MEDIA_INVALID');
    }
  });
  it('otro CHECK => 400 genérico sin nombre de la restricción', () => {
    const out = translateProductDbError({
      code: '23514',
      message: 'violates check constraint "products_base_price_chk"',
    });
    expect(out).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(payload(out))).not.toContain('products_base_price_chk');
  });
  it('FK de categoría (23503) => 422 PRODUCT_CATEGORY_INVALID; otra FK => mismo error', () => {
    const out = translateProductDbError({
      code: '23503',
      message: 'violates foreign key constraint "products_category_id_fkey"',
    });
    expect(status(out)).toBe(422);
    expect(payload(out)['code']).toBe('PRODUCT_CATEGORY_INVALID');
    const other = { code: '23503', message: 'otra' };
    expect(translateProductDbError(other)).toBe(other);
  });
  it('errores desconocidos o no objeto pasan intactos', () => {
    const generic = new Error('boom');
    expect(translateProductDbError(generic)).toBe(generic);
    expect(translateProductDbError('x')).toBe('x');
    expect(translateProductDbError(null)).toBeNull();
  });
});
