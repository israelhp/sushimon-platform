'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMemo } from 'react';
import { cardToCatalogProduct } from '@/features/catalog/catalog-product';
import { ProductCard } from '@/features/catalog/components/product-card';
import { useProducts } from '@/features/catalog/hooks';
import { useFavoritesList } from '@/features/favorites/hooks';
import { useCustomerScope } from '@/features/session/customer-scope';
import { useHomeBootstrap } from '@/features/store/hooks';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { STORE_ROUTES } from '@/features/store-shell/nav';

const MAX_FAVORITES = 4;

/**
 * "Favoritos 人気" del Inicio (F17). Dos fuentes, nunca mezcladas en la caché pública:
 * 1. DESTACADOS de la tienda: `bootstrap.featured` (tarjetas del servidor). Hoy la API devuelve `[]` (P23: sin criterio de destacados;
 *    el mock lo emula) y entonces esta rama NO se renderiza: no se inventan ids ni se muestra una sección vacía.
 * 2. Favoritos del CLIENTE autenticado: `GET /v1/me/favorites` (F06) por separado; los precios y la disponibilidad salen del menú de
 *    la sucursal elegida (que solo se pide si hay favoritos que mostrar). Un visitante no dispara ninguna de estas solicitudes.
 * Sin ninguna de las dos la sección no ocupa espacio. Un error del bootstrap sí se avisa (con «Reintentar»).
 */
export function FavoritesSection() {
  const t = useTranslations('home');
  const tu = useTranslations('ui');
  const bootstrap = useHomeBootstrap();
  const identity = useCustomerScope();
  const favoritesList = useFavoritesList(1);
  const featured = useMemo(
    () =>
      (bootstrap.data?.featured ?? []).slice(0, MAX_FAVORITES).map((c) => cardToCatalogProduct(c)),
    [bootstrap.data],
  );
  const showFeatured = featured.length > 0;
  const ownIds = useMemo(
    () =>
      identity.state === 'ready' && !showFeatured
        ? (favoritesList.data?.items ?? [])
            .filter((i) => i.status === 'ACTIVE')
            .map((i) => i.productId)
        : [],
    [identity.state, showFeatured, favoritesList.data],
  );
  const catalog = useProducts({ enabled: ownIds.length > 0 });
  const own = useMemo(() => {
    const byId = new Map((catalog.data ?? []).map((p) => [p.id, p]));
    return ownIds.flatMap((id) => byId.get(id) ?? []).slice(0, MAX_FAVORITES);
  }, [catalog.data, ownIds]);

  const items = showFeatured ? featured : own;
  const pending = !showFeatured && ownIds.length > 0 && catalog.isPending;
  if (bootstrap.isError && !showFeatured) {
    return <ErrorNotice onRetry={() => void bootstrap.refetch()} />;
  }
  if (!pending && items.length === 0) return null;

  return (
    <section aria-labelledby="favs-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id="favs-title" className="disp text-[24px] sm:text-[32px]">
          {showFeatured ? t('favorites') : t('yourFavorites')}{' '}
          {showFeatured ? (
            <span className="ml-1 font-jp text-[13px] tracking-[0.15em] text-primary" lang="ja">
              人気
            </span>
          ) : null}
        </h2>
        <Link href={STORE_ROUTES.menu} className="link-btn !min-h-0 text-sm">
          {t('seeMenu')}
        </Link>
      </div>
      {pending ? (
        <div
          aria-busy="true"
          aria-label={tu('loading')}
          className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0"
        >
          {Array.from({ length: Math.min(ownIds.length, MAX_FAVORITES) }, (_, i) => (
            <Skeleton key={i} className="h-[190px] w-[150px] flex-none sm:w-auto" />
          ))}
        </div>
      ) : (
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} catalog={items} />
          ))}
        </div>
      )}
    </section>
  );
}

/** "29 productos en el menú · Precios en quetzales": el contador sale del bootstrap (`productCount`), sin cargar el catálogo. */
export function HomeFootnote() {
  const t = useTranslations('home');
  const bootstrap = useHomeBootstrap();
  const count = bootstrap.data?.productCount ?? 0;
  if (count === 0) return null;
  return <p className="text-center text-[12px] text-muted">{t('footnote', { a: count })}</p>;
}
