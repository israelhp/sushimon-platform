'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cardToCatalogProduct, type CatalogProduct } from '@/features/catalog/catalog-product';
import { ProductCard } from '@/features/catalog/components/product-card';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import type { useStoreSearch } from '@/features/store/hooks';
import { isApiError } from '@/lib/data-access/errors';
import type { SimulatedProductExtras } from '@/lib/data-access/models';
import { isSearchable } from '@/lib/store-rules';

type SearchState = ReturnType<typeof useStoreSearch>;

/** Mensaje y espera de «Reintentar» según el error (429 con `Retry-After`; sin conexión; servicio no disponible). */
export function searchErrorInfo(
  error: unknown,
  t: (key: 'searchRateLimited' | 'searchOffline' | 'searchBusy') => string,
): { message?: string; cooldownSec: number } {
  if (!isApiError(error)) return { cooldownSec: 0 };
  if (error.status === 429)
    return { message: t('searchRateLimited'), cooldownSec: error.retryAfterSec ?? 5 };
  if (error.status === 0) return { message: t('searchOffline'), cooldownSec: 0 };
  if (error.status >= 500) return { message: t('searchBusy'), cooldownSec: 0 };
  return { cooldownSec: 0 };
}

/**
 * Resultados de la búsqueda del menú (`GET /v1/store/search`, F17), hecha en el SERVIDOR para la sucursal elegida. Los precios, la
 * disponibilidad y la promoción son los de la respuesta (los agotados se muestran deshabilitados); del catálogo ya cargado solo se
 * reutilizan los extras SIMULADOS. `q` llega YA con debounce.
 * - Al cambiar el texto se conservan los resultados previos (misma sucursal) como `inert` con una barra fina y «Actualizando…»: el texto
 *   no se atenúa. Al cambiar de SUCURSAL no queda nada de la anterior: se muestra el esqueleto.
 * - Los anuncios para lectores de pantalla los emite la región permanente de `MenuScreen` (aquí no hay `role="status"`).
 * - «Ver más»: `aria-disabled` mientras carga; al llegar la página el foco va al contador; si falla, aviso bajo la lista.
 */
export function MenuSearchResults({
  q,
  catalog,
  search,
  branchName,
}: {
  q: string;
  catalog: readonly CatalogProduct[];
  search: SearchState;
  branchName: string | null;
}) {
  const t = useTranslations('menu');
  const tu = useTranslations('ui');
  const counterRef = useRef<HTMLParagraphElement>(null);
  const wasFetchingNext = useRef(false);
  const { isFetchingNextPage, isFetchNextPageError } = search;
  useEffect(() => {
    if (wasFetchingNext.current && !isFetchingNextPage && !isFetchNextPageError) {
      counterRef.current?.focus();
    }
    wasFetchingNext.current = isFetchingNextPage;
  }, [isFetchingNextPage, isFetchNextPageError]);

  const waiting = !isSearchable(q);
  if (waiting || (search.isPending && !search.data)) {
    return (
      <div aria-busy="true" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <span className="sr-only">{tu('loading')}</span>
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-[112px] rounded-2xl" />
        ))}
      </div>
    );
  }
  if (search.isError && !search.data) {
    const info = searchErrorInfo(search.error, t);
    return (
      <ErrorNotice
        message={info.message}
        cooldownSec={info.cooldownSec}
        onRetry={() => void search.refetch()}
      />
    );
  }
  if (!search.data) return null;

  const byId = new Map(catalog.map((p) => [p.id, p]));
  const cards = search.data.pages.flatMap((page) => page.items);
  const total = search.data.pages[0]?.total ?? 0;
  const stale = search.isPlaceholderData;
  const products = cards.map((card) => {
    const known = byId.get(card.productId);
    const extras: SimulatedProductExtras | undefined = known
      ? {
          productId: known.id,
          nameEn: known.nameEn,
          descriptionEn: known.descriptionEn,
          illustration: known.illustration,
          featured: known.featured,
          food: known.food,
        }
      : undefined;
    return cardToCatalogProduct(card, extras);
  });

  if (products.length === 0) {
    return (
      <EmptyState compact title={t('searchEmptyTitle', { q })} description={t('searchEmptySub')} />
    );
  }
  const moreInfo = isFetchNextPageError ? searchErrorInfo(search.error, t) : null;
  // Para la página siguiente solo 429 y «sin conexión» tienen mensaje propio; el resto usa el genérico de «más resultados».
  const moreError =
    moreInfo &&
    isApiError(search.error) &&
    (search.error.status === 429 || search.error.status === 0)
      ? moreInfo
      : moreInfo
        ? { message: undefined, cooldownSec: 0 }
        : null;
  return (
    <section aria-labelledby="menu-search-title" aria-busy={stale} className="mb-7">
      <h2 id="menu-search-title" className="disp mb-1 break-words text-[22px] sm:text-[26px]">
        {t('searchResults', { q })}
      </h2>
      {branchName ? (
        <p className="mb-1 text-sm text-muted">{t('resultsIn', { branch: branchName })}</p>
      ) : null}
      <p ref={counterRef} tabIndex={-1} className="mb-3 text-sm text-muted outline-none">
        {stale ? t('searchUpdating') : t('searchCount', { shown: products.length, total })}
      </p>
      {stale ? (
        <div aria-hidden="true" className="mb-3 h-0.5 w-full animate-pulse rounded bg-brand-red" />
      ) : null}
      {/* `inert` mientras los datos están desfasados: nada interactuable de una consulta anterior. */}
      <div
        inert={stale}
        className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:grid-cols-3"
      >
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            catalog={catalog.length > 0 ? catalog : products}
            variant="row"
          />
        ))}
      </div>
      {moreError ? (
        <ErrorNotice
          className="mt-3"
          message={moreError.message ?? t('searchMoreError')}
          cooldownSec={moreError.cooldownSec}
          onRetry={() => void search.fetchNextPage()}
        />
      ) : null}
      {search.hasNextPage && !moreError ? (
        <div inert={stale} className="mt-4 text-center">
          <button
            type="button"
            className="btn"
            aria-disabled={isFetchingNextPage || undefined}
            onClick={() => {
              if (!isFetchingNextPage) void search.fetchNextPage();
            }}
          >
            {isFetchingNextPage ? tu('loading') : t('searchMore')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
