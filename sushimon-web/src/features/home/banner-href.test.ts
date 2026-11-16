import { describe, expect, it } from 'vitest';
import { bannerAction } from './banner-href';

describe('bannerAction: destino por función cerrada', () => {
  it('traduce cada tipo a una ruta conocida de la tienda', () => {
    expect(bannerAction({ type: 'MENU' })).toEqual({ type: 'link', href: '/menu' });
    expect(bannerAction({ type: 'PROMOTIONS' })).toEqual({ type: 'link', href: '/promociones' });
    expect(bannerAction({ type: 'CATEGORY', categorySlug: 'rolls-frios' })).toEqual({
      type: 'link',
      href: '/menu?cat=rolls-frios',
    });
    expect(bannerAction({ type: 'PRODUCT', productId: 'calientito-roll' })).toEqual({
      type: 'product',
      productId: 'calientito-roll',
    });
    expect(bannerAction({ type: 'PAGE', page: 'CAREERS' })).toEqual({
      type: 'link',
      href: '/trabaja-con-nosotros',
    });
    expect(bannerAction({ type: 'PAGE', page: 'TRACK_ORDER' })).toEqual({
      type: 'link',
      href: '/consultar',
    });
    expect(bannerAction({ type: 'PAGE', page: 'INCIDENTS' })).toEqual({
      type: 'link',
      href: '/incidencias',
    });
    expect(bannerAction({ type: 'NONE' })).toEqual({ type: 'none' });
  });

  it('nunca produce un enlace con texto libre del servidor', () => {
    const hostile = [
      { type: 'EXTERNAL', page: 'https://evil.test' },
      { type: 'CATEGORY', categorySlug: '../admin' },
      { type: 'CATEGORY', categorySlug: 'a&x=1' },
      { type: 'CATEGORY', categorySlug: 'javascript:alert(1)' },
      { type: 'CATEGORY', categorySlug: null },
      { type: 'PAGE', page: '//evil.test' },
      { type: 'PAGE', page: 'constructor' },
      { type: 'PAGE', page: 'toString' },
      { type: 'PRODUCT', productId: '' },
      { type: 'PRODUCT', productId: null },
      { type: 'PAGE' },
      { type: undefined },
    ];
    for (const cta of hostile) expect(bannerAction(cta as never)).toEqual({ type: 'none' });
    expect(bannerAction(null)).toEqual({ type: 'none' });
    expect(bannerAction(undefined)).toEqual({ type: 'none' });
  });
});
