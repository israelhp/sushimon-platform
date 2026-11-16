'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useAdminBranchProducts } from '@/features/branch-products/hooks';
import { useAdminCategories } from '@/features/categories/hooks';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { PRODUCT_SEARCH_MAX } from '@/lib/product-rules';
import { branchProductServerError } from '../branch-products-view';
import { BranchProductControls } from './BranchProductControls';

const PAGE_SIZE = 20;
type AvailabilityFilter = 'all' | 'available' | 'soldOut';

/**
 * Vista «Por sucursal» (F13): matriz de TODOS los productos de UNA sucursal con precio base, precio especial y disponibilidad,
 * filtros (texto, categoría, disponibilidad, solo con precio especial), paginación del servidor y edición en línea. Reutiliza
 * el selector de sucursal del backoffice (`shell`: solo ofrece las sucursales dentro del alcance del empleado). Sin
 * `catalog.update` el precio queda de solo lectura; sin `catalog.manage_availability` el interruptor se deshabilita.
 */
export function BranchProductsMatrix() {
  const t = useTranslations('backoffice.branchProducts');
  const tu = useTranslations('ui');
  const { branches, branchId, setBranchId, branchLocked, can } = useShell();
  const categoriesQuery = useAdminCategories();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const [onlyOverride, setOnlyOverride] = useState(false);
  const [page, setPage] = useState(1);

  // La matriz necesita UNA sucursal: la elegida en el selector del backoffice o, si son «todas», la primera del alcance.
  const activeId = branchId ?? branches[0]?.id ?? null;
  const q = useDebouncedValue(query, 300).trim();
  const matrix = useAdminBranchProducts(activeId, {
    q: q || undefined,
    categoryId: categoryId === 'all' ? undefined : categoryId,
    available: availability === 'all' ? undefined : availability === 'available',
    hasOverride: onlyOverride ? true : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const categories = useMemo(() => categoriesQuery.data?.items ?? [], [categoriesQuery.data]);
  const items = matrix.data?.items ?? [];
  const total = matrix.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q) || categoryId !== 'all' || availability !== 'all' || onlyOverride;
  const reset =
    <T,>(set: (v: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  return (
    <section aria-label={t('matrixTitle')}>
      <div className="toolbar">
        <label className="row gap8">
          <span className="sm" style={{ fontWeight: 700 }}>
            {t('branch')}
          </span>
          <select
            className="inp"
            aria-label={t('branch')}
            value={activeId ?? ''}
            disabled={branchLocked || branches.length === 0}
            onChange={(e) => {
              setBranchId(e.target.value || undefined);
              setPage(1);
            }}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <SearchInput
          zone="bo"
          inline
          value={query}
          onValueChange={reset(setQuery)}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          maxLength={PRODUCT_SEARCH_MAX}
        />
        <label className="row gap8">
          <span className="sr-only">{t('categoryFilter')}</span>
          <select
            className="inp"
            aria-label={t('categoryFilter')}
            value={categoryId}
            onChange={(e) => reset(setCategoryId)(e.target.value)}
          >
            <option value="all">{t('allCategories')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {`${'— '.repeat(c.depth - 1)}${c.name}`}
              </option>
            ))}
          </select>
        </label>
        <SegmentedControl
          zone="bo"
          label={t('availabilityFilter')}
          value={availability}
          onChange={reset(setAvailability)}
          options={[
            { value: 'all', label: t('filterAll') },
            { value: 'available', label: t('stateAvailable') },
            { value: 'soldOut', label: t('stateSoldOut') },
          ]}
        />
        <label className="row gap8">
          <input
            type="checkbox"
            checked={onlyOverride}
            onChange={(e) => reset(setOnlyOverride)(e.target.checked)}
          />
          <span className="sm" style={{ fontWeight: 700 }}>
            {t('onlyOverride')}
          </span>
        </label>
      </div>

      {matrix.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {branchProductServerError(matrix.error).message}{' '}
          <button type="button" className="link-btn" onClick={() => void matrix.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {!activeId ? (
        <EmptyState zone="bo" title={t('noBranches')} />
      ) : matrix.isPending ? (
        <div aria-busy="true" aria-label={tu('loading')} style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} zone="bo" style={{ height: 110, borderRadius: 12 }} />
          ))}
        </div>
      ) : items.length === 0 && !matrix.isError ? (
        <EmptyState
          zone="bo"
          title={t('matrixEmpty')}
          description={filtered ? t('matrixEmptyFiltered') : undefined}
        />
      ) : (
        <ul
          aria-label={t('matrixTitle')}
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}
        >
          {items.map((row) => (
            <li
              key={`${row.productId}-${row.priceOverride ?? ''}-${row.available}-${row.updatedAt ?? ''}`}
              className="card"
              style={{ padding: 12 }}
            >
              <div
                className="row gap8"
                style={{ marginBottom: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
              >
                <strong>{row.name}</strong>
                <span className="xs muted">
                  {row.category.name} · <code>{row.slug}</code>
                  {row.sku ? ` · ${row.sku}` : ''}
                </span>
                {!row.publiclyVisible ? (
                  <Pill zone="bo" tone="warning">
                    {t('notVisibleShort')}
                  </Pill>
                ) : null}
              </div>
              <BranchProductControls
                state={row}
                label={row.name}
                canPrice={can('catalog.update', row.branchId)}
                canAvailability={can('catalog.manage_availability', row.branchId)}
              />
            </li>
          ))}
        </ul>
      )}

      {total > 0 ? (
        <nav
          className="row gap8"
          aria-label={t('pagerLabel')}
          style={{ justifyContent: 'center', marginTop: 16 }}
        >
          <button
            type="button"
            className="btn sm"
            disabled={page <= 1}
            onClick={() => setPage((n) => Math.max(1, n - 1))}
          >
            {t('prev')}
          </button>
          <span className="sm muted" role="status" style={{ fontWeight: 700 }}>
            {t('pagerStatus', { page, pages, total })}
          </span>
          <button
            type="button"
            className="btn sm"
            disabled={page >= pages}
            onClick={() => setPage((n) => n + 1)}
          >
            {t('next')}
          </button>
        </nav>
      ) : null}
    </section>
  );
}
