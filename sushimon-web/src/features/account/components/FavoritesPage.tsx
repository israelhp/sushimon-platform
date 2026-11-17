'use client';

import { Heart, Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ProductCard } from '@/features/catalog/components/product-card';
import { useProducts } from '@/features/catalog/hooks';
import { productName } from '@/features/catalog/localized';
import { productSlug } from '@/features/catalog/catalog-product';
import { useProductSheet } from '@/features/catalog/product-sheet-context';
import { RemoveFavoriteButton } from '@/features/favorites/components/RemoveFavoriteButton';
import { useFavoritesList } from '@/features/favorites/hooks';
import { useCustomerScope } from '@/features/session/customer-scope';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { useAuthModal } from '@/features/store-shell/store-shell-context';
import type { FavoriteItem, Product } from '@/lib/data-access/models';
import { FAVORITES_PAGE_SIZE } from '@/services/favorites';
import { AccountSection } from './AccountSection';
import { SectionEmpty } from './HubCard';

/**
 * Mis favoritos (F06, spec 010 D18). Los datos son los de la API (orden por `addedAt`, estado de cada producto); para
 * PINTAR la tarjeta se busca el `Product` completo (precio y disponibilidad) en el catálogo existente por `productId`:
 * la relación nunca copia el catálogo ni el precio. Si el producto no está en el catálogo, ya no se puede pedir, o la API
 * no pudo consultarlo (`UNKNOWN`), la fila es discreta y segura (sin precio ni ids internos) y permite quitarlo.
 * Sin sesión: aviso que abre el inicio de sesión y estado vacío.
 */
export function FavoritesPage() {
  const t = useTranslations('fav');
  const tUi = useTranslations('ui');
  const identity = useCustomerScope();
  const auth = useAuthModal();
  const [page, setPage] = useState(1);
  const list = useFavoritesList(page);
  const products = useProducts();

  const guest = identity.state === 'guest';
  const data = guest ? undefined : list.data;
  const catalog = useMemo(() => products.data ?? [], [products.data]);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / FAVORITES_PAGE_SIZE)) : 1;

  // Si al quitar se vació la última página, se vuelve a la última que tenga datos (ajuste durante el render).
  if (data && data.items.length === 0 && data.total > 0 && page > totalPages) setPage(totalPages);

  let body;
  if (guest) {
    body = <EmptyFavorites />;
  } else if (list.isError) {
    body = <ErrorNotice message={t('error')} onRetry={() => void list.refetch()} />;
  } else if (!data) {
    body = (
      <div
        role="status"
        aria-busy="true"
        aria-label={tUi('loading')}
        className="grid gap-2.5 lg:grid-cols-2"
      >
        <Skeleton className="h-[112px] w-full rounded-2xl" />
        <Skeleton className="h-[112px] w-full rounded-2xl" />
      </div>
    );
  } else if (data.total === 0) {
    body = <EmptyFavorites />;
  } else {
    body = (
      <>
        {data.catalogStatus === 'UNAVAILABLE' ? (
          <p role="status" className="notice notice-warn mb-3 flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
            <span>{t('catalogDown')}</span>
          </p>
        ) : null}
        <ul aria-label={t('listLabel')} className="m-0 grid list-none gap-2.5 p-0 lg:grid-cols-2">
          {data.items.map((item) => (
            <li key={item.productId}>
              <FavoriteRow
                item={item}
                catalog={catalog}
                product={byId.get(item.productId)}
                catalogPending={products.isPending}
              />
            </li>
          ))}
        </ul>
        {totalPages > 1 ? (
          <nav
            aria-label={t('title')}
            className="mt-4 flex items-center justify-between gap-3 text-sm"
          >
            <button
              type="button"
              className="btn !min-h-[44px]"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('prev')}
            </button>
            <span className="text-muted">{t('pageOf', { a: page, b: totalPages })}</span>
            <button
              type="button"
              className="btn !min-h-[44px]"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              {t('next')}
            </button>
          </nav>
        ) : null}
      </>
    );
  }

  return (
    <AccountSection
      title={t('title')}
      intro={data && data.total > 0 ? t('count', { a: data.total }) : undefined}
      requireAuth={false}
    >
      {guest ? (
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

function EmptyFavorites() {
  const t = useTranslations('fav');
  const tCommon = useTranslations('common');
  return (
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
}

/** Una fila: tarjeta del catálogo si el producto es pedible aquí; si no, fila discreta con "Quitar". */
function FavoriteRow({
  item,
  catalog,
  product,
  catalogPending,
}: {
  item: FavoriteItem;
  catalog: readonly Product[];
  /** Producto del catálogo de la tienda (búsqueda por Map en el padre); undefined si no está o aún carga. */
  product: Product | undefined;
  /** El catálogo aún carga: las filas con resumen de la API se pintan ya, sin precio, y pasan a tarjeta al llegar. */
  catalogPending: boolean;
}) {
  const t = useTranslations('fav');
  const locale = useLocale();
  const { openProduct } = useProductSheet();
  const orderable = item.status === 'ACTIVE' || item.status === 'UNAVAILABLE';

  if (product && product.available && item.status === 'ACTIVE') {
    return <ProductCard product={product} catalog={catalog} variant="row" />;
  }

  // Nombre: catálogo > resumen de la API > texto genérico. Nunca el id crudo.
  const summary = item.product;
  const name = product
    ? productName(product, locale)
    : summary
      ? locale === 'en'
        ? (summary.nameEn ?? summary.name)
        : summary.name
      : t('savedProduct');
  const note =
    catalogPending && summary && item.status === 'ACTIVE'
      ? null
      : item.status === 'UNKNOWN'
        ? t('unknownDetails')
        : item.status === 'INACTIVE' || item.status === 'REMOVED'
          ? t('retired')
          : t('unavailable');

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-3">
      <span className="min-w-0 flex-1">
        {product && orderable ? (
          <button
            type="button"
            onClick={() => openProduct(product.id, productSlug(product), product)}
            className="block max-w-full truncate text-left font-extrabold hover:underline"
          >
            {name}
          </button>
        ) : (
          <span className="block font-extrabold">{name}</span>
        )}
        {note ? <span className="block text-[13px] text-muted">{note}</span> : null}
      </span>
      <RemoveFavoriteButton productId={item.productId} name={name} />
    </div>
  );
}
