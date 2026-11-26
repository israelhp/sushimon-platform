import { BadRequestException } from '@nestjs/common';
import { translateProductDbError, translateProductDeleteError } from './product-db-errors.js';

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
  it('F14: deadlock (40P01) y fallo de serialización (40001) => 503 PRODUCTS_BUSY', () => {
    for (const code of ['40P01', '40001']) {
      const out = translateProductDbError({ code });
      expect(status(out)).toBe(503);
      expect(payload(out)['code']).toBe('PRODUCTS_BUSY');
    }
  });
  it('F14: FK del asset (carrera con el borrado) => 404 MEDIA_NOT_FOUND', () => {
    const out = translateProductDbError({
      code: '23503',
      message: 'violates foreign key constraint "product_media_asset_id_fkey"',
    });
    expect(status(out)).toBe(404);
    expect(payload(out)['code']).toBe('MEDIA_NOT_FOUND');
  });
  it('errores desconocidos o no objeto pasan intactos', () => {
    const generic = new Error('boom');
    expect(translateProductDbError(generic)).toBe(generic);
    expect(translateProductDbError('x')).toBe('x');
    expect(translateProductDbError(null)).toBeNull();
  });
});

describe('translateProductDeleteError (ADR-0035)', () => {
  const used = { orders: 3, promotions: 1, banners: 0 };
  const none = { orders: 0, promotions: 0, banners: 0 };

  it('23503/P2003 (también en cause) recuenta y responde 409 PRODUCT_IN_USE con el usage real', async () => {
    for (const error of [
      { code: 'P2003' },
      { code: '23503' },
      { cause: { code: '23503' } },
      Object.assign(new Error('fk'), { code: 'P2003', meta: { field_name: 'x' } }),
    ]) {
      const recount = vi.fn().mockResolvedValue(used);
      const out = await translateProductDeleteError(error, recount);
      expect(recount).toHaveBeenCalledTimes(1);
      expect(status(out)).toBe(409);
      expect(payload(out)).toMatchObject({
        code: 'PRODUCT_IN_USE',
        extra: { usage: used },
      });
    }
  });

  it('23503 con recuento en cero o fallido => 503 PRODUCTS_BUSY (nunca ceros inventados)', async () => {
    for (const recount of [
      vi.fn().mockResolvedValue(none),
      vi.fn().mockRejectedValue(new Error('x')),
    ]) {
      const out = await translateProductDeleteError({ code: '23503' }, recount);
      expect(status(out)).toBe(503);
      expect(payload(out)['code']).toBe('PRODUCTS_BUSY');
    }
  });

  it('55P03/P2028 => 503 PRODUCTS_BUSY sin recontar; otros errores pasan igual', async () => {
    const recount = vi.fn();
    for (const error of [{ code: '55P03' }, { code: 'P2028' }, { cause: { code: '40P01' } }]) {
      const out = await translateProductDeleteError(error, recount);
      expect(payload(out)['code']).toBe('PRODUCTS_BUSY');
    }
    const boom = new Error('otro');
    expect(await translateProductDeleteError(boom, recount)).toBe(boom);
    expect(recount).not.toHaveBeenCalled();
  });
});
