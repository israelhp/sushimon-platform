'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useProducts } from '@/features/catalog/hooks';
import { useStoreCategories } from '@/features/categories/hooks';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { ALL_CATEGORY, menuSections, resolveCategory, visibleSections } from '../menu-model';
import { MenuCartAside } from './menu-cart-aside';
import { MenuCartBar } from './menu-cart-bar';
import { MenuHappyBanner } from './menu-happy-banner';
import { MenuHeader } from './menu-header';
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

  const tree = categories.data?.items ?? [];
  const loading = categories.isPending || products.isPending;
  const failed = categories.isError || products.isError;
  const sections = categories.data && products.data ? menuSections(tree, products.data) : [];
  const active = resolveCategory(tree, params.get('cat'));
  const shown = visibleSections(sections, tree, active);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 pb-16 md:pb-24">
        <MenuHeader tree={tree} active={active} />
        <div className="wrap pt-4">
          {loading ? (
            <div aria-busy="true" aria-label={t('ui.loading')}>
              <Skeleton className="mb-5 h-[68px]" />
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
