'use client';

import { Heart, Info } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import { FavoriteButton } from '@/features/catalog/components/favorite-button';
import { ProductCard } from '@/features/catalog/components/product-card';
import { useProducts } from '@/features/catalog/hooks';
import { productName } from '@/features/catalog/localized';
import { useDemoSession } from '@/features/session/demo-session';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { useAuthModal } from '@/features/store-shell/store-shell-context';
import { useFavorites } from '../hooks';
import { AccountSection } from './AccountSection';
import { SectionEmpty } from './HubCard';

/**
 * Favoritos. Los favoritos pertenecen a la cuenta: sin sesión se muestra el aviso (que abre el inicio
 * de sesión simulado) y el estado vacío; con sesión, la lista con los productos que ya no están
 * disponibles marcados para poder quitarlos.
 */
export function FavoritesPage() {
  const t = useTranslations('fav');
  const tCommon = useTranslations('common');
  const tUi = useTranslations('ui');
  const locale = useLocale();
  const { customer } = useDemoSession();
  const auth = useAuthModal();
  const favorites = useFavorites();
  const products = useProducts();

  const ids = customer ? (favorites.data ?? []) : [];
  const catalog = products.data ?? [];
  const failed = !!customer && (favorites.isError || products.isError);
  const loading = !!customer && !failed && (favorites.isPending || products.isPending);

  let body;
  if (loading) {
    body = (
      <div aria-busy="true" aria-label={tUi('loading')} className="grid gap-2.5 lg:grid-cols-2">
        <Skeleton className="h-[112px] w-full rounded-2xl" />
        <Skeleton className="h-[112px] w-full rounded-2xl" />
      </div>
    );
  } else if (failed) {
    body = (
      <ErrorNotice
        message={t('error')}
        onRetry={() => {
          void favorites.refetch();
          void products.refetch();
        }}
      />
    );
  } else if (ids.length === 0) {
    body = (
      <SectionEmpty
        icon={<Heart className="h-6 w-6" aria-hidden="true" />}
        title={t('empty')}
        text={t('emptySub')}
        action={
          <Link href="/menu" className="btn btn-primary !min-h-[44px] no-underline">
            {tCommon('goMenu')}
          </Link>
        }
      />
    );
  } else {
    body = (
      <ul className="m-0 grid list-none gap-2.5 p-0 lg:grid-cols-2">
        {ids.map((id) => {
          const product = catalog.find((p) => p.id === id);
          return (
            <li key={id}>
              {product && product.available ? (
                <ProductCard product={product} catalog={catalog} variant="row" />
              ) : (
                <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-3 opacity-80">
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold">
                      {product ? productName(product, locale) : id}
                    </span>
                    <span className="block text-[13px] text-muted">{t('unavailable')}</span>
                  </span>
                  <FavoriteButton
                    productId={id}
                    name={product ? productName(product, locale) : id}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <AccountSection title={t('title')} requireAuth={false}>
      {!customer ? (
        <button
          type="button"
          onClick={auth.open}
          className="mb-3 flex w-full items-start gap-2 rounded-xl bg-subtle px-3.5 py-3 text-left text-[13px] font-bold leading-snug hover:bg-line/40"
        >
          <Info className="mt-0.5 h-4 w-4 flex-none text-secondary" aria-hidden="true" />{' '}
          {t('guestNote')}
        </button>
      ) : null}
      {body}
    </AccountSection>
  );
}
