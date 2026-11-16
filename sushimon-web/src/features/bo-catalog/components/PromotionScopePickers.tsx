'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAdminBranches } from '@/features/branches/hooks';
import { useAdminCategories } from '@/features/categories/hooks';
import { useAdminProducts } from '@/features/products/hooks';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import type { PromotionScope } from '@/lib/data-access/models';
import { PROMOTION_BRANCHES_MAX, PROMOTION_PRODUCTS_MAX } from '@/lib/promotion-rules';
import type { SelectedProduct } from '../promotions-view';

const PAGE_SIZE = 8;

/** Alcance de sucursales: «Todas» (incluye las futuras; exige alcance global) o una selección de las sucursales reales (F07). */
export function BranchScopePicker({
  scope,
  branchIds,
  allowAll,
  onChange,
  describedBy,
  invalid,
}: {
  scope: PromotionScope;
  branchIds: readonly string[];
  /** Solo con alcance global del permiso (el servidor responde 403 si no). */
  allowAll: boolean;
  onChange: (scope: PromotionScope, branchIds: string[]) => void;
  describedBy?: string;
  invalid?: boolean;
}) {
  const t = useTranslations('backoffice.promotions.form');
  const tu = useTranslations('ui');
  const branches = useAdminBranches({ pageSize: 100 });
  const items = branches.data?.items ?? [];
  const toggle = (id: string) =>
    onChange(
      'SELECTED',
      branchIds.includes(id) ? branchIds.filter((x) => x !== id) : [...branchIds, id],
    );
  return (
    <div className="field span-2">
      <span className="flabel" id="promo-branches-label">
        {t('branches')}
      </span>
      <SegmentedControl
        zone="bo"
        label={t('branches')}
        value={scope}
        onChange={(next) => onChange(next, next === 'ALL' ? [] : [...branchIds])}
        options={[
          { value: 'ALL', label: t('branchesAll'), disabled: !allowAll && scope !== 'ALL' },
          { value: 'SELECTED', label: t('branchesSelected') },
        ]}
      />
      {scope === 'ALL' ? (
        <span className="xs muted" style={{ fontWeight: 600 }}>
          {t('branchesAllHint')}
        </span>
      ) : branches.isPending ? (
        <span className="sm muted" aria-busy="true">
          {tu('loading')}
        </span>
      ) : branches.isError ? (
        <span className="sm" role="alert">
          {t('branchesError')}{' '}
          <button type="button" className="link-btn" onClick={() => void branches.refetch()}>
            {tu('retry')}
          </button>
        </span>
      ) : (
        <div role="group" aria-labelledby="promo-branches-label">
          <ul
            className="row gap8 wrap"
            style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}
          >
            {items.map((b, i) => (
              <li key={b.id}>
                <label className="row gap8">
                  <input
                    type="checkbox"
                    data-field={i === 0 ? 'branches' : undefined}
                    checked={branchIds.includes(b.id)}
                    aria-invalid={invalid ? true : undefined}
                    aria-describedby={describedBy}
                    onChange={() => toggle(b.id)}
                  />
                  <span className="sm" style={{ fontWeight: 700 }}>
                    {b.name}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {scope === 'SELECTED' ? (
        <span className="xs muted" style={{ fontWeight: 600 }}>
          {t('selectedCount', { count: branchIds.length, max: PROMOTION_BRANCHES_MAX })}
        </span>
      ) : null}
    </div>
  );
}

/** Alcance de productos: «Todos» o una selección buscando en el catálogo real (F11), con filtro por categoría (F10). */
export function ProductScopePicker({
  scope,
  products,
  onChange,
  describedBy,
  invalid,
}: {
  scope: PromotionScope;
  products: readonly SelectedProduct[];
  onChange: (scope: PromotionScope, products: SelectedProduct[]) => void;
  describedBy?: string;
  invalid?: boolean;
}) {
  const t = useTranslations('backoffice.promotions.form');
  const tu = useTranslations('ui');
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(query, 300).trim();
  const categories = useAdminCategories();
  const list = useAdminProducts({
    q: q || undefined,
    categoryId: categoryId === 'all' ? undefined : categoryId,
    page,
    pageSize: PAGE_SIZE,
  });
  const selected = new Set(products.map((p) => p.id));
  const toggle = (p: SelectedProduct) =>
    onChange(
      'SELECTED',
      selected.has(p.id) ? products.filter((x) => x.id !== p.id) : [...products, p],
    );
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="field span-2">
      <span className="flabel" id="promo-products-label">
        {t('products')}
      </span>
      <SegmentedControl
        zone="bo"
        label={t('products')}
        value={scope}
        onChange={(next) => onChange(next, next === 'ALL' ? [] : [...products])}
        options={[
          { value: 'ALL', label: t('productsAll') },
          { value: 'SELECTED', label: t('productsSelected') },
        ]}
      />
      {scope === 'ALL' ? (
        <span className="xs muted" style={{ fontWeight: 600 }}>
          {t('productsAllHint')}
        </span>
      ) : (
        <>
          {products.length > 0 ? (
            <ul className="chips" aria-label={t('productsChosen')} style={{ listStyle: 'none' }}>
              {products.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="chip on"
                    aria-label={t('productRemove', { name: p.name })}
                    onClick={() => toggle(p)}
                  >
                    {p.name} ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <span className="xs muted" style={{ fontWeight: 600 }}>
            {t('selectedCount', { count: products.length, max: PROMOTION_PRODUCTS_MAX })}
          </span>
          <div className="toolbar">
            <SearchInput
              zone="bo"
              inline
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
              label={t('productSearch')}
              placeholder={t('productSearchPlaceholder')}
              maxLength={80}
            />
            <select
              className="inp"
              aria-label={t('productCategory')}
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">{t('productCategoryAll')}</option>
              {(categories.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {`${'— '.repeat(c.depth - 1)}${c.name}`}
                </option>
              ))}
            </select>
          </div>
          {list.isPending ? (
            <span className="sm muted" aria-busy="true">
              {tu('loading')}
            </span>
          ) : list.isError ? (
            <span className="sm" role="alert">
              {t('productsError')}{' '}
              <button type="button" className="link-btn" onClick={() => void list.refetch()}>
                {tu('retry')}
              </button>
            </span>
          ) : (list.data?.items.length ?? 0) === 0 ? (
            <span className="sm muted">{t('productsNone')}</span>
          ) : (
            <div role="group" aria-labelledby="promo-products-label">
              <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
                {list.data?.items.map((p, i) => (
                  <li key={p.id}>
                    <label className="row gap8">
                      <input
                        type="checkbox"
                        data-field={i === 0 ? 'products' : undefined}
                        checked={selected.has(p.id)}
                        aria-invalid={invalid ? true : undefined}
                        aria-describedby={describedBy}
                        onChange={() => toggle({ id: p.id, name: p.name })}
                      />
                      <span className="sm" style={{ fontWeight: 700 }}>
                        {p.name}
                        {p.active ? '' : ` (${t('productInactive')})`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {total > PAGE_SIZE ? (
            <div className="row gap8">
              <button
                type="button"
                className="btn sm"
                disabled={page <= 1}
                onClick={() => setPage((n) => Math.max(1, n - 1))}
              >
                {t('pagePrev')}
              </button>
              <span className="sm muted" role="status">
                {t('pageStatus', { page, pages })}
              </span>
              <button
                type="button"
                className="btn sm"
                disabled={page >= pages}
                onClick={() => setPage((n) => n + 1)}
              >
                {t('pageNext')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
