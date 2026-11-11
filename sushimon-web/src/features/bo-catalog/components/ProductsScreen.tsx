'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { BoProductArt, IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import {
  useBoCategories,
  useBoProducts,
  useSetProductAvailability,
} from '@/features/backoffice/hooks';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { errorMessage, isForbidden } from '@/features/bo-orders/error-message';
import { cn } from '@/lib/cn';
import type { Product } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { can } from '@/lib/permissions';
import {
  availabilityPatch,
  availabilityState,
  categoryLook,
  countByCategory,
  filterProducts,
  sortCategories,
  type AvailabilityKind,
  type AvailabilityState,
} from '../catalog-view';
import { useCatalogScope } from '../use-catalog-scope';
import { ProductModal } from './ProductModal';

type View = 'grid' | 'tabla';

const KIND_TONE: Record<AvailabilityKind, PillTone> = {
  on: 'success',
  off: 'muted',
  partial: 'warning',
};

/** Pantalla Productos: tarjetas o tabla, búsqueda, filtro por categoría y disponibilidad por sucursal. */
export function ProductsScreen() {
  const t = useTranslations('backoffice.products');
  const tu = useTranslations('ui');
  const toast = useToast();
  const { role } = useShell();
  const { scope, activeBranches, title: branchTitle } = useCatalogScope();
  const products = useBoProducts();
  const categories = useBoCategories();
  const setAvailability = useSetProductAvailability();
  const canEdit = can(role, 'products.edit');

  const [view, setView] = useState<View>('grid');
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  /** `null` = cerrado; `{}` = alta; `{ product }` = edición. */
  const [form, setForm] = useState<{ product?: Product } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const all = useMemo(() => products.data ?? [], [products.data]);
  const productCategories = useMemo(
    () => sortCategories(categories.data ?? []).filter((c) => c.kind === 'products'),
    [categories.data],
  );
  const categoryName = useMemo(
    () => new Map(productCategories.map((c) => [c.id, c.name])),
    [productCategories],
  );
  const counts = useMemo(() => countByCategory(all), [all]);
  const shown = useMemo(() => filterProducts(all, { query, categoryId }), [all, query, categoryId]);

  if (isForbidden(products.error)) return <ForbiddenScreen reason="server" />;

  const tabs: TabItem<string>[] = [
    { value: 'all', label: t('all'), count: all.length },
    ...productCategories.map((c) => ({ value: c.id, label: c.name, count: counts.get(c.id) ?? 0 })),
  ];

  const toggle = (p: Product, state: AvailabilityState) => {
    const value = state.kind !== 'on';
    setPendingId(p.id);
    setAvailability.mutate(
      { id: p.id, availability: availabilityPatch(scope, value) },
      {
        onSuccess: () =>
          toast.notify(t(value ? 'toast.available' : 'toast.soldOut', { name: p.name })),
        onError: (error) => toast.notify(t('availabilityError', { message: errorMessage(error) })),
        onSettled: () => setPendingId(null),
      },
    );
  };

  const clearFilters = () => {
    setQuery('');
    setCategoryId('all');
  };

  const stateLabel = (s: AvailabilityState) =>
    s.kind === 'on'
      ? t('stateOn')
      : s.kind === 'off'
        ? t('stateOff')
        : t('statePartial', { on: s.on, total: s.total });

  const renderSwitch = (p: Product, state: AvailabilityState) => (
    <Switch
      zone="bo"
      checked={state.kind === 'on'}
      mixed={state.kind === 'partial'}
      label={t('switchLabel', { name: p.name })}
      title={t('switchTitle')}
      disabled={pendingId === p.id || scope.length === 0}
      onCheckedChange={() => toggle(p, state)}
    />
  );

  const editButton = (p: Product) =>
    canEdit ? (
      <button
        type="button"
        className="icon-btn bordered"
        aria-label={t('editLabel', { name: p.name })}
        title={t('edit')}
        onClick={() => setForm({ product: p })}
      >
        <IconPencil size="sm" />
      </button>
    ) : null;

  return (
    <div className="page" style={{ animation: 'none' }}>
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">
            {t('subtitle', { count: all.length, branch: branchTitle })}
          </div>
        </div>
        <SegmentedControl
          zone="bo"
          label={t('viewLabel')}
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: t('viewGrid') },
            { value: 'tabla', label: t('viewTable') },
          ]}
        />
        {canEdit ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={products.isPending || categories.isPending}
            onClick={() => setForm({})}
          >
            <IconPlus size="sm" />
            {t('new')}
          </button>
        ) : null}
      </div>

      <div className="toolbar">
        <SearchInput
          zone="bo"
          inline
          value={query}
          onValueChange={setQuery}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
        />
        <Tabs
          zone="bo"
          label={t('categoriesLabel')}
          items={tabs}
          value={categoryId}
          onChange={setCategoryId}
        />
      </div>

      {products.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void products.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {products.isPending ? (
        <div className="pgrid" aria-busy="true" aria-label={tu('loading')}>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} zone="bo" style={{ height: 320, borderRadius: 16 }} />
          ))}
        </div>
      ) : shown.length === 0 && !products.isError ? (
        <EmptyState
          zone="bo"
          title={t('empty.title')}
          description={all.length === 0 ? t('empty.none') : t('empty.description')}
          action={
            all.length > 0 ? (
              <button type="button" className="btn mt8" onClick={clearFilters}>
                {t('empty.clear')}
              </button>
            ) : undefined
          }
        />
      ) : view === 'grid' ? (
        <div className="pgrid" role="list">
          {shown.map((p) => {
            const state = availabilityState(p, scope);
            const look = categoryLook(p.categoryId);
            return (
              <div
                key={p.id}
                role="listitem"
                className={cn('pcard', state.kind === 'off' && 'off')}
              >
                <div className={cn('pimg', look.tile)}>
                  <Pill zone="bo" tone={KIND_TONE[state.kind]}>
                    {stateLabel(state)}
                  </Pill>
                  <BoProductArt kind={look.art} />
                </div>
                <div className="pbody">
                  <div className="pcat">{categoryName.get(p.categoryId) ?? t('noCategory')}</div>
                  <div className="pname">{p.name}</div>
                  <div className="pdesc">{p.description}</div>
                  <div className="pfoot">
                    <span className="price">{formatMoney(p.price)}</span>
                    <span className="spacer" />
                    {renderSwitch(p, state)}
                    {editButton(p)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <div className="tscroll" style={{ paddingTop: 14 }}>
            <div className="min-prod" role="table" aria-label={t('title')}>
              <div className="thead cols-prod" role="row">
                <span role="columnheader">{t('table.photo')}</span>
                <span role="columnheader">{t('table.name')}</span>
                <span role="columnheader">{t('table.category')}</span>
                <span role="columnheader">{t('table.price')}</span>
                <span role="columnheader">{t('table.availability')}</span>
                <span role="columnheader">
                  <span className="sr-only">{t('edit')}</span>
                </span>
              </div>
              {shown.map((p) => {
                const state = availabilityState(p, scope);
                const look = categoryLook(p.categoryId);
                return (
                  <div className="trow cols-prod" role="row" key={p.id}>
                    <div className={cn('thumb', look.tile)} role="cell">
                      <BoProductArt kind={look.art} variant="thumb" />
                    </div>
                    <div role="cell">
                      <div className="cell-main">{p.name}</div>
                      <div className="cell-sub trunc">{p.description}</div>
                    </div>
                    <div className="sm hide-sm" style={{ fontWeight: 700 }} role="cell">
                      {categoryName.get(p.categoryId) ?? t('noCategory')}
                    </div>
                    <div className="num strong" role="cell">
                      {formatMoney(p.price)}
                    </div>
                    <div className="sw-row" role="cell">
                      {renderSwitch(p, state)}
                      {stateLabel(state)}
                    </div>
                    <div className="row-actions" role="cell">
                      {editButton(p)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {form ? (
        <ProductModal
          product={form.product}
          categories={productCategories}
          branches={activeBranches}
          onClose={() => setForm(null)}
        />
      ) : null}
    </div>
  );
}
