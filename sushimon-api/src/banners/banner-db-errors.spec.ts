import { translateBannerDbError } from './banner-db-errors.js';

const err = (code: string, message: string, meta?: Record<string, unknown>) =>
  Object.assign(new Error(message), { code, ...(meta ? { meta } : {}) });
const info = (e: unknown) => {
  const x = e as { getStatus?: () => number; getResponse?: () => unknown };
  const body = (x.getResponse?.() ?? {}) as { code?: string };
  return { status: x.getStatus?.(), code: body.code };
};

describe('translateBannerDbError', () => {
  it.each(['P2028', '55P03', '40P01', '40001'])('%s => 503 BANNERS_BUSY', (code) => {
    expect(info(translateBannerDbError(err(code, 'x')))).toEqual({
      status: 503,
      code: 'BANNERS_BUSY',
    });
  });

  it('también cuando el SQLSTATE viene en la causa del adaptador', () => {
    const e = Object.assign(new Error('x'), { cause: { originalCode: '55P03' } });
    expect(info(translateBannerDbError(e))).toEqual({ status: 503, code: 'BANNERS_BUSY' });
  });

  describe('trigger de tope (0023): 23514 con mensaje y constraint banners_max_count', () => {
    const limit = { status: 409, code: 'BANNER_LIMIT_REACHED' };

    it('por SQLSTATE 23514 + mensaje', () => {
      expect(info(translateBannerDbError(err('23514', 'banners_max_count')))).toEqual(limit);
    });

    it('por constraint/mensaje aunque el adaptador cambie el código (P2010, P2004, sin código)', () => {
      expect(
        info(
          translateBannerDbError(
            err('P2010', 'Raw query failed', { code: '23514', message: 'banners_max_count' }),
          ),
        ),
      ).toEqual(limit);
      expect(
        info(translateBannerDbError(err('P2004', 'x', { constraint: 'banners_max_count' }))),
      ).toEqual(limit);
      const wrapped = Object.assign(new Error('failed'), {
        cause: { originalCode: '23514', constraint: 'banners_max_count' },
      });
      expect(info(translateBannerDbError(wrapped))).toEqual(limit);
      expect(info(translateBannerDbError(new Error('banners_max_count')))).toEqual(limit);
    });

    it('otro CHECK o un nombre que solo CONTIENE banners_max_count NO se traduce', () => {
      for (const e of [
        err('23514', 'new row violates check constraint "banner_translations_image_alt_len_chk"'),
        err('23514', 'other_banners_max_count_x'),
        err('23514', 'banners_max_counter'),
      ])
        expect(translateBannerDbError(e)).toBe(e);
    });
  });

  it('FK de la imagen => 422 BANNER_IMAGE_INVALID; otra FK o genérica => tal cual', () => {
    expect(
      info(
        translateBannerDbError(
          err('23503', 'violates foreign key constraint "banners_image_asset_id_fkey"'),
        ),
      ),
    ).toEqual({ status: 422, code: 'BANNER_IMAGE_INVALID' });
    expect(
      info(
        translateBannerDbError(err('P2003', 'x', { field_name: 'banners_image_asset_id_fkey' })),
      ),
    ).toEqual({ status: 422, code: 'BANNER_IMAGE_INVALID' });
    for (const e of [
      err('23503', 'violates foreign key constraint "banner_translations_banner_id_fkey"'),
      err('P2003', 'x'),
    ])
      expect(translateBannerDbError(e)).toBe(e);
  });

  it('una UNIQUE (el código interno es único por construcción) y errores ajenos salen tal cual', () => {
    for (const e of [
      err('P2002', 'u', { target: ['banners_code_key'] }),
      err('23505', 'duplicate key value violates unique constraint "banners_code_key"'),
      err('XX000', 'boom'),
      new Error('x'),
    ])
      expect(translateBannerDbError(e)).toBe(e);
    expect(translateBannerDbError('cadena')).toBe('cadena');
    expect(translateBannerDbError(null)).toBeNull();
  });
});
