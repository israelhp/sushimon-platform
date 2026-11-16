import { BadRequestException } from '@nestjs/common';
import { translateCategoryDbError } from './category-db-errors.js';

const payload = (e: unknown) => (e as { getResponse(): Record<string, unknown> }).getResponse();
const status = (e: unknown) => (e as { getStatus(): number }).getStatus();

describe('translateCategoryDbError', () => {
  it('UNIQUE (P2002 o 23505) => 409 CATEGORY_SLUG_TAKEN', () => {
    for (const error of [
      Object.assign(new Error('u'), { code: 'P2002', meta: { target: ['slug'] } }),
      { code: '23505', constraint: 'categories_slug_key' },
      { cause: { code: '23505' }, meta: { constraint: 'categories_slug_key' } },
    ]) {
      const out = translateCategoryDbError(error);
      expect(status(out)).toBe(409);
      expect(payload(out)['code']).toBe('CATEGORY_SLUG_TAKEN');
    }
  });
  it('UNIQUE de otra restricción o sin objetivo conocido => NO es 409: mismo error (500 genérico)', () => {
    for (const error of [
      { code: 'P2002', meta: { target: ['id'] } },
      { code: '23505', constraint: 'categories_pkey' },
      { code: '23505' },
      { cause: { code: '23505' } },
    ]) {
      expect(translateCategoryDbError(error)).toBe(error);
    }
  });
  it('P2028 y 55P03 => 503 CATEGORIES_BUSY con mensaje fijo, sin filtrar el original', () => {
    for (const error of [
      { code: 'P2028', message: 'Transaction already closed: host=db-prod' },
      { cause: { code: '55P03' }, message: 'lock timeout host=db-prod' },
      { meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } },
    ]) {
      const out = translateCategoryDbError(error);
      expect(status(out)).toBe(503);
      expect(payload(out)).toMatchObject({ code: 'CATEGORIES_BUSY' });
      expect(JSON.stringify(payload(out))).not.toContain('db-prod');
    }
  });
  it('trigger categories_parent_cycle (23514) => 422 CATEGORY_CYCLE', () => {
    const out = translateCategoryDbError({
      code: '23514',
      message: 'ERROR: categories_parent_cycle',
    });
    expect(status(out)).toBe(422);
    expect(payload(out)['code']).toBe('CATEGORY_CYCLE');
  });
  it('trigger categories_max_depth (error de driver anidado) => 422 CATEGORY_DEPTH_EXCEEDED', () => {
    const out = translateCategoryDbError({
      meta: { driverAdapterError: { cause: { originalCode: '23514' } } },
      cause: { message: 'categories_max_depth' },
    });
    expect(status(out)).toBe(422);
    expect(payload(out)['code']).toBe('CATEGORY_DEPTH_EXCEEDED');
  });
  it('otro CHECK => 400 genérico sin nombre de la restricción', () => {
    const out = translateCategoryDbError({
      code: '23514',
      message: 'violates check constraint "categories_slug_format_chk"',
    });
    expect(out).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(payload(out))).not.toContain('categories_slug_format_chk');
  });
  it('error no del dominio => el mismo error (500 genérico)', () => {
    const error = new Error('boom');
    expect(translateCategoryDbError(error)).toBe(error);
    expect(translateCategoryDbError(null)).toBeNull();
  });
});
