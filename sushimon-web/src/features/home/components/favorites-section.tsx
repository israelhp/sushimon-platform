'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Product } from '@/lib/data-access/models';
import { ProductCard } from '@/features/catalog/components/product-card';
import { useProducts } from '@/features/catalog/hooks';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { STORE_ROUTES } from '@/features/store-shell/nav';

/**
 * Selección editorial del Inicio (ids del prototipo, en su orden). Si el catálogo no los trae todos,
 * se completa con los productos marcados como favoritos (`featured`). La selección es de presentación:
 * el contrato aún no expone un ranking de "más pedidos".
 */
export const HOME_FAVORITE_IDS = [
  'platanito-roll',
  'california-roll',
  'calientito-roll',
  'cangreburger',
] as const;
const MAX_FAVORITES = 4;

export function pickFavorites(products: readonly Product[]): Product[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const picked = HOME_FAVORITE_IDS.flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });
  for (const p of products) {
    if (picked.length >= MAX_FAVORITES) break;
    if (p.featured && !picked.some((x) => x.id === p.id)) picked.push(p);
  }
  return picked.slice(0, MAX_FAVORITES);
}

/** "Favoritos 人気" (los favoritos de los MONcheros) con tarjetas de producto que abren la ficha. */
export function FavoritesSection() {
  const t = useTranslations('home');
  const tu = useTranslations('ui');
  const products = useProducts();
  const favorites = products.data ? pickFavorites(products.data) : [];

  return (
    <section aria-labelledby="favs-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id="favs-title" className="disp text-[24px] sm:text-[32px]">
          {t('favorites')}{' '}
          <span className="ml-1 font-jp text-[13px] tracking-[0.15em] text-primary" lang="ja">
            人気
          </span>
        </h2>
        <Link href={STORE_ROUTES.menu} className="link-btn !min-h-0 text-sm">
          {t('seeMenu')}
        </Link>
      </div>
      {products.isPending ? (
        <div
          aria-busy="true"
          aria-label={tu('loading')}
          className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[190px] w-[150px] flex-none sm:w-auto" />
          ))}
        </div>
      ) : products.isError ? (
        <ErrorNotice onRetry={() => void products.refetch()} />
      ) : favorites.length === 0 ? (
        <p className="m-0 rounded-2xl border border-dashed border-line bg-surface p-5 text-center text-sm text-muted">
          {t('noProducts')}
        </p>
      ) : (
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0">
          {favorites.map((product) => (
            <ProductCard key={product.id} product={product} catalog={products.data ?? []} />
          ))}
        </div>
      )}
    </section>
  );
}

/** "29 productos en el menú · Precios en quetzales". */
export function HomeFootnote() {
  const t = useTranslations('home');
  const products = useProducts();
  if (!products.data || products.data.length === 0) return null;
  return (
    <p className="text-center text-[12px] text-muted">
      {t('footnote', { a: products.data.length })}
    </p>
  );
}
