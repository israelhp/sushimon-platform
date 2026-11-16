'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { BoProductArt, IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/features/bo-admin/components/ConfirmModal';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { isForbidden } from '@/features/bo-orders/error-message';
import { useAdminCategories } from '@/features/categories/hooks';
import { useAdminProducts, useUpdateProduct } from '@/features/products/hooks';
import { queryKeys } from '@/features/query-keys';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/cn';
import type { AdminProduct } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { canGlobally } from '@/lib/permissions';
import { priceToNumber } from '@/lib/product-rules';
import { categoryLook } from '../catalog-view';
import {
  categorySlugChain,
  productServerError,
  statusToActive,
  visibilityReason,
  type ProductStatusFilter,
} from '../products-view';
import { BranchProductsMatrix } from './BranchProductsMatrix';
import { ProductBranchesModal } from './ProductBranchesModal';
import { ProductModal } from './ProductModal';
import { firstProductImage } from '@/features/catalog/components/product-art';

type View = 'grid' | 'tabla';
/** F13: «Catálogo» (productos) o «Por sucursal» (matriz de precio y disponibilidad de una sucursal). */
type Mode = 'catalog' | 'branch';
const PAGE_SIZE = 20;

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'status'; id: string }
  | { kind: 'branches'; id: string };

/**
 * Pantalla Productos (F11): lista PAGINADA del servidor (búsqueda con debounce, filtro por categoría y estado), alta, edición y
 * activar/desactivar con confirmación. Muestra `publiclyVisible` y el motivo (inactivo o categoría oculta). La vista exige
 * `catalog.read`; crear/editar `catalog.create`/`catalog.update` con alcance GLOBAL (si no, se deshabilitan con aviso: el
 * servidor responde 403 de todos modos). Sin borrado. F13 (contrato): cada tarjeta abre la hoja «Sucursales» (precio especial y
 * disponibilidad por sucursal; no exige `catalog.update`) y la vista «Por sucursal» muestra la matriz de una sucursal.
 */
export function ProductsScreen() {
  const t = useTranslations('backoffice.products');
  const tu = useTranslations('ui');
  const toast = useToast();
  const qc = useQueryClient();
  const { grants, can } = useShell();
  const categoriesQuery = useAdminCategories();
  const update = useUpdateProduct();

  const [mode, setMode] = useState<Mode>('catalog');
  const [view, setView] = useState<View>('grid');
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState<ProductStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [statusError, setStatusError] = useState('');

  const q = useDebouncedValue(query, 300).trim();
  const products = useAdminProducts({
    q: q || undefined,
    categoryId: categoryId === 'all' ? undefined : categoryId,
    active: statusToActive(status),
    page,
    pageSize: PAGE_SIZE,
  });

  const categories = useMemo(() => categoriesQuery.data?.items ?? [], [categoriesQuery.data]);
  const items = useMemo(() => products.data?.items ?? [], [products.data]);
  const total = products.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q) || categoryId !== 'all' || status !== 'all';

  const canCreate = canGlobally(grants, 'catalog.create');
  const canUpdate = canGlobally(grants, 'catalog.update');
  const anyWrite = can('catalog.create') || can('catalog.update');
  const noticeKey = canCreate || canUpdate ? null : anyWrite ? 'noticeScope' : 'noticeReadOnly';

  if (isForbidden(products.error)) return <ForbiddenScreen reason="server" />;

  const target =
    dialog && dialog.kind !== 'create' ? items.find((p) => p.id === dialog.id) : undefined;

  const close = () => {
    setDialog(null);
    setStatusError('');
  };
  const resetPage =
    <T,>(set: (v: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const clearFilters = () => {
    setQuery('');
    setCategoryId('all');
    setStatus('all');
    setPage(1);
  };

  const confirmStatus = (p: AdminProduct) =>
    update.mutate(
      { id: p.id, input: { active: !p.active } },
      {
        onSuccess: () => {
          toast.notify(t(p.active ? 'toastDeactivated' : 'toastActivated', { name: p.name }));
          close();
        },
        onError: (error) => {
          const parsed = productServerError(error);
          setStatusError(parsed.message);
          if (parsed.reload) void qc.invalidateQueries({ queryKey: queryKeys.products.all });
        },
      },
    );

  const visibilityPill = (p: AdminProduct) => {
    const reason = visibilityReason(p);
    return (
      <Pill
        zone="bo"
        tone={reason === 'visible' ? 'success' : reason === 'inactive' ? 'muted' : 'warning'}
      >
        {t(`visibility.${reason}`)}
      </Pill>
    );
  };

  const actions = (p: AdminProduct) => (
    <>
      <button
        type="button"
        className="btn sm"
        aria-label={t('branchesLabel', { name: p.name })}
        onClick={() => setDialog({ kind: 'branches', id: p.id })}
      >
        {t('branches')}
      </button>
      <button
        type="button"
        className="btn sm"
        disabled={!canUpdate}
        aria-label={t(p.active ? 'deactivateLabel' : 'activateLabel', { name: p.name })}
        onClick={() => setDialog({ kind: 'status', id: p.id })}
      >
        {t(p.active ? 'deactivate' : 'activate')}
      </button>
      <button
        type="button"
        className="icon-btn bordered"
        disabled={!canUpdate}
        aria-label={t('editLabel', { name: p.name })}
        title={t('edit')}
        onClick={() => setDialog({ kind: 'edit', id: p.id })}
      >
        <IconPencil size="sm" />
      </button>
    </>
  );

  const look = (p: AdminProduct) => categoryLook(categorySlugChain(p, categories));
  const photo = (p: AdminProduct, variant?: 'thumb') => {
    const image = firstProductImage(p);
    const l = look(p);
    return image ? (
      // eslint-disable-next-line @next/next/no-img-element -- URL https del catálogo (F14 aportará la subida)
      <img
        src={image.url}
        alt={image.altText ?? ''}
        loading="lazy"
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    ) : (
      <BoProductArt kind={l.art} variant={variant} />
    );
  };

  return (
    <div className="page" style={{ animation: 'none' }}>
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">
            {mode === 'branch' ? t('subtitleBranch') : t('subtitleReal', { count: total })}
          </div>
        </div>
        <SegmentedControl
          zone="bo"
          label={t('modeLabel')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'catalog', label: t('modeCatalog') },
            { value: 'branch', label: t('modeBranch') },
          ]}
        />
        {mode === 'catalog' ? (
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
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          hidden={mode === 'branch'}
          disabled={!canCreate || categoriesQuery.isPending}
          onClick={() => setDialog({ kind: 'create' })}
        >
          <IconPlus size="sm" />
          {t('new')}
        </button>
      </div>

      {mode === 'branch' ? <BranchProductsMatrix /> : null}

      {mode === 'branch' ? null : noticeKey ? (
        <Banner zone="bo" tone="info" role="status">
          {t(noticeKey)}
        </Banner>
      ) : null}

      {mode === 'catalog' ? (
        <>
          <div className="toolbar">
            <SearchInput
              zone="bo"
              inline
              value={query}
              onValueChange={resetPage(setQuery)}
              label={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
              maxLength={80}
            />
            <label className="row gap8">
              <span className="sr-only">{t('categoryFilter')}</span>
              <select
                className="inp"
                aria-label={t('categoryFilter')}
                value={categoryId}
                onChange={(e) => resetPage(setCategoryId)(e.target.value)}
              >
                <option value="all">{t('all')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${'— '.repeat(c.depth - 1)}${c.name}`}
                  </option>
                ))}
              </select>
            </label>
            <SegmentedControl
              zone="bo"
              label={t('statusFilter')}
              value={status}
              onChange={resetPage(setStatus)}
              options={[
                { value: 'all', label: t('statusAll') },
                { value: 'active', label: t('statusActive') },
                { value: 'inactive', label: t('statusInactive') },
              ]}
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
          ) : items.length === 0 && !products.isError ? (
            <EmptyState
              zone="bo"
              title={t('empty.title')}
              description={filtered ? t('empty.description') : t('empty.none')}
              action={
                filtered ? (
                  <button type="button" className="btn mt8" onClick={clearFilters}>
                    {t('empty.clear')}
                  </button>
                ) : undefined
              }
            />
          ) : view === 'grid' ? (
            <div className="pgrid" role="list">
              {items.map((p) => (
                <div
                  key={p.id}
                  role="listitem"
                  className={cn('pcard', !p.publiclyVisible && 'off')}
                >
                  <div className={cn('pimg', look(p).tile)}>
                    {visibilityPill(p)}
                    {photo(p)}
                  </div>
                  <div className="pbody">
                    <div className="pcat">{p.category.name}</div>
                    <div className="pname">{p.name}</div>
                    <div className="pdesc">{p.description}</div>
                    <div className="xs muted" style={{ fontWeight: 600 }}>
                      <code>{p.slug}</code>
                      {p.sku ? ` · ${p.sku}` : ''}
                    </div>
                    <div className="pfoot">
                      <span className="price">{formatMoney(priceToNumber(p.basePrice))}</span>
                      <span className="spacer" />
                      {actions(p)}
                    </div>
                  </div>
                </div>
              ))}
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
                    <span role="columnheader">{t('table.status')}</span>
                    <span role="columnheader">
                      <span className="sr-only">{t('edit')}</span>
                    </span>
                  </div>
                  {items.map((p) => (
                    <div className="trow cols-prod" role="row" key={p.id}>
                      <div className={cn('thumb', look(p).tile)} role="cell">
                        {photo(p, 'thumb')}
                      </div>
                      <div role="cell">
                        <div className="cell-main">{p.name}</div>
                        <div className="cell-sub trunc">{p.description}</div>
                      </div>
                      <div className="sm hide-sm" style={{ fontWeight: 700 }} role="cell">
                        {p.category.name}
                      </div>
                      <div className="num strong" role="cell">
                        {formatMoney(priceToNumber(p.basePrice))}
                      </div>
                      <div className="sw-row" role="cell">
                        {visibilityPill(p)}
                      </div>
                      <div className="row-actions" role="cell">
                        {actions(p)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {total > 0 ? (
            <nav
              className="row gap8"
              aria-label={t('pager.label')}
              style={{ justifyContent: 'center', marginTop: 16 }}
            >
              <button
                type="button"
                className="btn sm"
                disabled={page <= 1}
                onClick={() => setPage((n) => Math.max(1, n - 1))}
              >
                {t('pager.prev')}
              </button>
              <span className="sm muted" role="status" style={{ fontWeight: 700 }}>
                {t('pager.status', { page, pages, total })}
              </span>
              <button
                type="button"
                className="btn sm"
                disabled={page >= pages}
                onClick={() => setPage((n) => n + 1)}
              >
                {t('pager.next')}
              </button>
            </nav>
          ) : null}
        </>
      ) : null}

      {dialog?.kind === 'create' ? <ProductModal categories={categories} onClose={close} /> : null}
      {dialog?.kind === 'edit' && target ? (
        <ProductModal product={target} categories={categories} onClose={close} />
      ) : null}
      {dialog?.kind === 'branches' && target ? (
        <ProductBranchesModal productId={target.id} productName={target.name} onClose={close} />
      ) : null}
      {dialog?.kind === 'status' && target ? (
        <ConfirmModal
          title={t(target.active ? 'deactivateTitle' : 'activateTitle', { name: target.name })}
          description={t('statusNow', { state: t(`visibility.${visibilityReason(target)}`) })}
          confirmLabel={t(target.active ? 'deactivate' : 'activate')}
          cancelLabel={t('cancel')}
          pendingLabel={t('saving')}
          danger={target.active}
          pending={update.isPending}
          error={statusError}
          onConfirm={() => confirmStatus(target)}
          onClose={close}
        >
          {target.active
            ? t('deactivateBody', { name: target.name })
            : target.category.effectivelyVisible
              ? t('activateBody', { name: target.name })
              : t('activateHiddenBody', { name: target.name, category: target.category.name })}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
