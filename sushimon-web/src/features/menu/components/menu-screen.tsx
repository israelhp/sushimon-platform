'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { useProducts } from '@/features/catalog/hooks';
import { usePublicBranches } from '@/features/branches/hooks';
import { useStoreCategories } from '@/features/categories/hooks';
import { useOptionalOrderMode } from '@/features/order-mode/order-mode-context';
import { useStoreSearch } from '@/features/store/hooks';
import { PRODUCT_SEARCH_MAX } from '@/lib/product-rules';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  STORE_SEARCH_DEBOUNCE_MS,
  STORE_SEARCH_MIN,
  isSearchable,
  normalizeSearchText,
} from '@/lib/store-rules';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { ALL_CATEGORY, menuSections, resolveCategory, visibleSections } from '../menu-model';
import { MenuCartAside } from './menu-cart-aside';
import { MenuCartBar } from './menu-cart-bar';
import { MenuHappyBanner } from './menu-happy-banner';
import { MenuHeader } from './menu-header';
import { MenuSearchResults, searchErrorInfo } from './menu-search-results';
import { MenuSection } from './menu-section';
import { MenuSubnav } from './menu-subnav';

/**
 * Pantalla del menú: cabecera con chips de categoría (`?cat=` en la URL), acceso a Happy Hour,
 * secciones por categoría y panel del pedido (escritorio). Estados de carga, error y vacío.
 */
export function MenuScreen() {
  const t = useTranslations();
  const params = useSearchParams();
  const categories = useStoreCategories();
  const products = useProducts();
  const branchId = useOptionalOrderMode()?.mode.branchId ?? null;
  const branches = usePublicBranches();
  const branchName = branchId
    ? (branches.data?.find((b) => b.id === branchId)?.name ?? null)
    : null;
  const hintId = useId();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, STORE_SEARCH_DEBOUNCE_MS);
  // F17: la búsqueda del servidor pide 2 a 80 caracteres. Con 1 solo se avisa y se sigue mostrando el menú; al borrar el texto se vuelve
  // al menú de inmediato (el debounce solo retrasa la PETICIÓN, no el regreso).
  const typed = normalizeSearchText(search);
  const tooShort = typed.length > 0 && typed.length < STORE_SEARCH_MIN;
  const query = typed.length >= STORE_SEARCH_MIN ? normalizeSearchText(debounced) : '';
  const searching = typed.length >= STORE_SEARCH_MIN;
  const searchState = useStoreSearch(query, { branchId });

  const tree = categories.data?.items ?? [];
  const loading = categories.isPending || products.isPending;
  const failed = categories.isError || products.isError;
  const sections = categories.data && products.data ? menuSections(tree, products.data) : [];
  const active = resolveCategory(tree, params.get('cat'));
  const shown = visibleSections(sections, tree, active);
  // El campo de búsqueda sigue montado (sin perder foco ni texto) mientras el menú se recarga, p. ej. al cambiar de sucursal.
  const showSearch = Boolean(categories.data) && tree.length > 0 && !failed;

  // Región `role="status"` PERMANENTE (una sola): los anuncios cambian su texto, no montan regiones nuevas.
  const announcement = (() => {
    if (loading) return t('menu.pageLoading');
    if (failed) return '';
    if (searching) {
      if (!isSearchable(query) || (searchState.isPending && !searchState.data)) {
        return t('menu.searchLoading');
      }
      if (searchState.isError && !searchState.data) {
        return (
          searchErrorInfo(searchState.error, (k) => t(`menu.${k}`)).message ?? t('ui.errorTitle')
        );
      }
      const first = searchState.data?.pages[0];
      if (!first) return '';
      if (searchState.isPlaceholderData) return t('menu.searchUpdating');
      return first.total === 0
        ? t('menu.searchEmptyTitle', { q: query })
        : t('menu.searchCount', {
            shown: searchState.data?.pages.reduce((n, p) => n + p.items.length, 0) ?? 0,
            total: first.total,
          });
    }
    return branchName ? t('menu.menuOf', { branch: branchName }) : '';
  })();

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 pb-16 md:pb-24">
        <MenuHeader tree={tree} active={active} />
        <div className="wrap pt-4">
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
          {showSearch ? (
            <div role="search" className="mb-4 max-w-[520px]">
              <SearchInput
                label={t('menu.searchLabel')}
                placeholder={t('menu.searchPlaceholder')}
                maxLength={PRODUCT_SEARCH_MAX}
                value={search}
                onValueChange={setSearch}
                aria-describedby={tooShort ? hintId : undefined}
              />
              {tooShort ? (
                <p id={hintId} className="mt-1.5 text-[13px] text-muted">
                  {t('menu.searchTooShort')}
                </p>
              ) : null}
              {!searching && branchName ? (
                <p className="mt-1.5 text-[13px] font-bold text-muted">
                  {t('menu.menuOf', { branch: branchName })}
                </p>
              ) : null}
            </div>
          ) : null}
          {loading ? (
            <div aria-busy="true">
              <span className="sr-only">{t('ui.loading')}</span>
              {showSearch ? null : <Skeleton className="mb-5 h-[68px]" />}
              {[0, 1].map((n) => (
                <div key={n} className="mb-7">
                  <Skeleton className="mb-3 h-7 w-40" />
                  <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {[0, 1, 2].map((m) => (
                      <Skeleton key={m} className="h-[112px] rounded-2xl" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : failed ? (
            <ErrorNotice
              onRetry={() => {
                void categories.refetch();
                void products.refetch();
              }}
            />
          ) : tree.length === 0 || sections.length === 0 ? (
            <EmptyState title={t('menu.emptyTitle')} description={t('menu.emptySub')} />
          ) : searching ? (
            <MenuSearchResults
              q={query}
              catalog={products.data ?? []}
              search={searchState}
              branchName={branchName}
            />
          ) : (
            <>
              <MenuSubnav tree={tree} active={active} />
              {active === ALL_CATEGORY ? <MenuHappyBanner /> : null}
              {shown.length === 0 ? (
                <EmptyState compact title={t('menu.categoryEmpty')} />
              ) : (
                shown.map((section) => (
                  <MenuSection
                    key={section.category.id}
                    section={section}
                    catalog={products.data ?? []}
                  />
                ))
              )}
              <p className="mt-2 text-center text-[13px] text-muted lg:hidden">
                {t('menu.tapHint')}
              </p>
            </>
          )}
        </div>
      </div>
      <MenuCartAside />
      <MenuCartBar />
    </div>
  );
}
