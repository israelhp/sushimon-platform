'use client';

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { toCatalogProduct, type CatalogProduct } from '@/features/catalog/catalog-product';
import { ProductCard } from '@/features/catalog/components/product-card';
import { useStoreProductSearch } from '@/features/catalog/hooks';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';

/**
 * Resultados de la búsqueda del menú (`GET /v1/store/products?q=`, hecha en el SERVIDOR: nombre, descripción o SKU sin acentos
 * ni mayúsculas) con «Ver más». Cada resultado reutiliza el producto del catálogo cargado (disponibilidad simulada); si no
 * está, se construye con valores neutros. `q` llega YA con debounce.
 */
export function MenuSearchResults({
  q,
  catalog,
}: {
  q: string;
  catalog: readonly CatalogProduct[];
}) {
  const t = useTranslations('menu');
  const tu = useTranslations('ui');
  const search = useStoreProductSearch(q);

  if (search.isPending) {
    return (
      <div
        aria-busy="true"
        aria-label={tu('loading')}
        className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
      >
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-[112px] rounded-2xl" />
        ))}
      </div>
    );
  }
  if (search.isError) return <ErrorNotice onRetry={() => void search.refetch()} />;

  const byId = new Map(catalog.map((p) => [p.id, p]));
  const results = search.data.pages.flatMap((page) => page.items);
  const total = search.data.pages[0]?.total ?? 0;
  const products = results.map((p) => byId.get(p.id) ?? toCatalogProduct(p));

  if (products.length === 0) {
    return (
      <EmptyState compact title={t('searchEmptyTitle', { q })} description={t('searchEmptySub')} />
    );
  }
  return (
    <section aria-labelledby="menu-search-title" className="mb-7">
      <h2 id="menu-search-title" className="disp mb-2.5 text-[22px] sm:text-[26px]">
        {t('searchResults', { q })}
      </h2>
      <p role="status" className="mb-3 text-sm text-muted">
        {t('searchCount', { shown: products.length, total })}
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} catalog={catalog} variant="row" />
        ))}
      </div>
      {search.hasNextPage ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            className="btn"
            disabled={search.isFetchingNextPage}
            onClick={() => void search.fetchNextPage()}
          >
            {search.isFetchingNextPage ? tu('loading') : t('searchMore')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
