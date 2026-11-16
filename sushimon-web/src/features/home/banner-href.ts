import type { StoreBannerCta } from '@/lib/data-access/models';
import { STORE_ROUTES } from '@/features/store-shell/nav';

/**
 * F16 — Destino de un banner. Función CERRADA: el servidor entrega un CTA estructurado (tipo + slug/id/página de lista blanca),
 * NUNCA una ruta ni una URL; aquí se traduce a una de las rutas conocidas de la tienda. No existe `EXTERNAL`: cualquier tipo,
 * página o slug que no encaje (dato corrupto, tipo futuro) NO produce enlace. Las rutas siempre empiezan por `/` y por una
 * constante de `STORE_ROUTES`; el slug se valida y se codifica, así que jamás puede salir de `/menu`.
 */
export type BannerAction =
  { type: 'none' } | { type: 'link'; href: string } | { type: 'product'; productId: string };

const NONE: BannerAction = { type: 'none' };

/** Slug de categoría tal como lo genera el servidor (minúsculas, números y guiones). */
const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PAGE_ROUTES = {
  CAREERS: STORE_ROUTES.careers,
  TRACK_ORDER: STORE_ROUTES.track,
  INCIDENTS: STORE_ROUTES.incidents,
} as const;

export function bannerAction(cta: StoreBannerCta | null | undefined): BannerAction {
  if (!cta) return NONE;
  switch (cta.type) {
    case 'MENU':
      return { type: 'link', href: STORE_ROUTES.menu };
    case 'PROMOTIONS':
      return { type: 'link', href: STORE_ROUTES.promos };
    case 'CATEGORY':
      return typeof cta.categorySlug === 'string' && CATEGORY_SLUG.test(cta.categorySlug)
        ? { type: 'link', href: `${STORE_ROUTES.menu}?cat=${encodeURIComponent(cta.categorySlug)}` }
        : NONE;
    case 'PRODUCT':
      return typeof cta.productId === 'string' && cta.productId.length > 0
        ? { type: 'product', productId: cta.productId }
        : NONE;
    case 'PAGE': {
      const page = cta.page;
      return page && Object.hasOwn(PAGE_ROUTES, page)
        ? { type: 'link', href: PAGE_ROUTES[page] }
        : NONE;
    }
    default:
      // `NONE` y cualquier tipo desconocido: sin enlace.
      return NONE;
  }
}
