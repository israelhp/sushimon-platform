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

  it('UNIQUE de banners_code_key (varias formas) => 409 BANNER_CODE_TAKEN', () => {
    expect(
      info(translateBannerDbError(err('P2002', 'u', { target: ['banners_code_key'] }))),
    ).toEqual({ status: 409, code: 'BANNER_CODE_TAKEN' });
    expect(info(translateBannerDbError(err('P2002', 'u', { target: ['code'] })))).toEqual({
      status: 409,
      code: 'BANNER_CODE_TAKEN',
    });
    expect(
      info(
        translateBannerDbError(
          err('23505', 'duplicate key value violates unique constraint "banners_code_key"'),
        ),
      ),
    ).toEqual({ status: 409, code: 'BANNER_CODE_TAKEN' });
  });

  it('otra UNIQUE (p. ej. banner_branches_pkey o un nombre que solo CONTIENE banners_code_key) NO se traduce', () => {
    for (const e of [
      err('P2002', 'u', { target: ['banner_branches_pkey'] }),
      err('P2002', 'u', { target: ['other_banners_code_key_x'] }),
      err('23505', 'duplicate key value violates unique constraint "media_assets_object_key_key"'),
    ])
      expect(translateBannerDbError(e)).toBe(e);
  });

  it('FK conocida => 422/404 del dominio; FK desconocida o genérica => tal cual', () => {
    expect(
      info(
        translateBannerDbError(err('P2003', 'violates foreign key "banners_image_asset_id_fkey"')),
      ),
    ).toEqual({ status: 422, code: 'BANNER_IMAGE_INVALID' });
    expect(
      info(
        translateBannerDbError(err('23503', 'violates foreign key "banners_cta_product_id_fkey"')),
      ),
    ).toEqual({ status: 422, code: 'BANNER_CTA_INVALID' });
    expect(
      info(
        translateBannerDbError(err('23503', 'violates foreign key "banners_cta_category_id_fkey"')),
      ),
    ).toEqual({ status: 422, code: 'BANNER_CTA_INVALID' });
    expect(
      info(
        translateBannerDbError(err('23503', 'violates foreign key "banners_promotion_id_fkey"')),
      ),
    ).toEqual({ status: 422, code: 'BANNER_PROMOTION_INVALID' });
    expect(
      info(
        translateBannerDbError(
          err('23503', 'violates foreign key "banner_branches_branch_id_fkey"'),
        ),
      ),
    ).toEqual({ status: 404, code: 'BRANCH_NOT_FOUND' });
    const unknown = err('23503', 'violates foreign key "otra_fkey" (branch_id)');
    expect(translateBannerDbError(unknown)).toBe(unknown);
  });

  it('CHECK conocidos => 422; otros CHECK => tal cual', () => {
    expect(
      info(translateBannerDbError(err('23514', 'violates check constraint "banners_period_chk"'))),
    ).toEqual({
      status: 422,
      code: 'BANNER_PERIOD_INVALID',
    });
    expect(
      info(
        translateBannerDbError(err('23514', 'violates check constraint "banners_cta_refs_chk"')),
      ),
    ).toEqual({
      status: 422,
      code: 'BANNER_CTA_INVALID',
    });
    const other = err('23514', 'violates check constraint "banners_code_format_chk"');
    expect(translateBannerDbError(other)).toBe(other);
  });

  it('errores ajenos o no objetos se devuelven tal cual', () => {
    const e = new Error('boom');
    expect(translateBannerDbError(e)).toBe(e);
    expect(translateBannerDbError('texto')).toBe('texto');
    expect(translateBannerDbError(null)).toBeNull();
  });
});
