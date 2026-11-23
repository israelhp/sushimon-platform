'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { isForbidden } from '@/features/bo-orders/error-message';
import type { AdminRiderSummary } from '@/lib/data-access/models';
import { useAdminRiders, useRiderBranches } from '../hooks';
import {
  DEFAULT_RIDER_LIST,
  RIDER_PAGE_SIZE,
  branchesWhere,
  hasRiderFilters,
  riderOccupancy,
  riderPageCount,
  toRiderFilters,
  type RiderListState,
  type RiderSortKey,
  type RiderStatusFilter,
} from '../rider-model';
import { RiderAvailabilityControl } from './RiderAvailabilityControl';
import { RiderDrawer, type RiderDrawerAction } from './RiderDrawer';
import { RiderFormModal } from './RiderFormModal';
import { RiderStatusModal } from './RiderStatusModal';
import { RiderTransferModal } from './RiderTransferModal';

const SEARCH_DEBOUNCE_MS = 300;

type Modal =
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'status'; rider: AdminRiderSummary }
  | { kind: 'transfer'; rider: AdminRiderSummary };

/**
 * Motoristas propios (F27, spec 028 §12): listado paginado con búsqueda por nombre (con retardo), filtros de sucursal, estado y
 * disponibilidad, orden, detalle en panel lateral y alta/edición/traslado/estado/disponibilidad. La UI solo muestra u oculta:
 * `riders.read|create|update` por sucursal orientan y la API decide (403/404/409 se muestran en los modales). El teléfono llega
 * enmascarado; sin F28 la ocupación es «sin dato» (nunca «libre»).
 */
export function RidersScreen() {
  const t = useTranslations('backoffice.riders');
  const tu = useTranslations('ui');
  const { can } = useShell();
  const branches = useRiderBranches();
  const [list, setList] = useState<RiderListState>(DEFAULT_RIDER_LIST);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // La búsqueda se envía con un pequeño retardo y reinicia la página.
  useEffect(() => {
    const id = setTimeout(
      () => setList((s) => (s.q === search ? s : { ...s, q: search, page: 1 })),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [search]);

  const filters = useMemo(() => toRiderFilters(list), [list]);
  const riders = useAdminRiders(filters);
  const items = riders.data?.items ?? [];
  const total = riders.data?.total ?? 0;
  const pages = riderPageCount(total, riders.data?.pageSize ?? RIDER_PAGE_SIZE);
  // «Ocupado» solo se ofrece si el servidor ya sabe de ocupación (con F28); antes no hay nada que filtrar.
  const busyKnown = items.some((r) => r.busyKnown);

  // Si la página pedida quedó vacía (p. ej., tras un filtro), retrocede una página.
  if (riders.data && !riders.isPlaceholderData && items.length === 0 && list.page > 1) {
    setList((s) => ({ ...s, page: Math.max(1, Math.min(s.page - 1, pages)) }));
  }

  if (isForbidden(riders.error)) return <ForbiddenScreen reason="server" />;

  const setFilter = (patch: Partial<RiderListState>) =>
    setList((s) => ({ ...s, ...patch, page: 1 }));
  const clearFilters = () => {
    setSearch('');
    setList(DEFAULT_RIDER_LIST);
  };
  const canCreate = branchesWhere(branches, (id) => can('riders.create', id)).length > 0;
  const orderText = list.order === 'asc' ? t('orderAsc') : t('orderDesc');
  const sortLabels: Record<RiderSortKey, string> = {
    fullName: t('sortName'),
    createdAt: t('sortCreated'),
    updatedAt: t('sortUpdated'),
  };
  const targetsFor = (rider: AdminRiderSummary) =>
    branchesWhere(branches, (id) => id !== rider.branchId && can('riders.update', id));
  const fromDrawer = (action: RiderDrawerAction, rider: AdminRiderSummary) => {
    if (action === 'edit') setModal({ kind: 'edit', id: rider.id });
    else setModal({ kind: action, rider });
  };

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">{riders.data ? t('subtitle', { total }) : ' '}</div>
        </div>
        <SearchInput
          zone="bo"
          inline
          clearable
          value={search}
          onValueChange={setSearch}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          maxLength={80}
        />
        {canCreate ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModal({ kind: 'create' })}
          >
            <IconPlus size="sm" />
            {t('new')}
          </button>
        ) : null}
      </div>

      <div className="toolbar toolbar-mb" role="group" aria-label={t('filtersLabel')}>
        <label className="toolbar-field">
          <span className="toolbar-label">{t('filterBranch')}</span>
          <select
            className="inp"
            value={list.branchId}
            onChange={(e) => setFilter({ branchId: e.target.value })}
          >
            <option value="">{t('optAllBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar-field">
          <span className="toolbar-label">{t('filterStatus')}</span>
          <select
            className="inp"
            value={list.status}
            onChange={(e) => setFilter({ status: e.target.value as RiderStatusFilter })}
          >
            <option value="all">{t('optAll')}</option>
            <option value="active">{t('optActive')}</option>
            <option value="inactive">{t('optInactive')}</option>
          </select>
        </label>
        <label className="toolbar-field">
          <span className="toolbar-label">{t('filterAvailability')}</span>
          <select
            className="inp"
            value={list.availability}
            onChange={(e) =>
              setFilter({ availability: e.target.value as RiderListState['availability'] })
            }
          >
            <option value="">{t('optAll')}</option>
            <option value="AVAILABLE">{t('optAvailable')}</option>
            <option value="UNAVAILABLE">{t('optUnavailable')}</option>
            {busyKnown ? <option value="BUSY">{t('optBusy')}</option> : null}
          </select>
        </label>
        <label className="toolbar-field">
          <span className="toolbar-label">{t('sortLabel')}</span>
          <select
            className="inp"
            value={list.sort}
            onChange={(e) => setFilter({ sort: e.target.value as RiderSortKey })}
          >
            {(Object.keys(sortLabels) as RiderSortKey[]).map((key) => (
              <option key={key} value={key}>
                {sortLabels[key]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn toolbar-order"
          aria-label={t('orderToggle', { order: orderText })}
          onClick={() => setFilter({ order: list.order === 'asc' ? 'desc' : 'asc' })}
        >
          <span aria-hidden="true">{list.order === 'asc' ? '↑' : '↓'}</span> {orderText}
        </button>
      </div>

      {riders.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void riders.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      <div className="card">
        <div className="tscroll" style={{ paddingTop: 14 }}>
          <div
            className="min-riders"
            role="table"
            aria-label={t('tableLabel')}
            aria-busy={riders.isPending || riders.isFetching}
          >
            <div role="rowgroup">
              <div className="thead cols-riders" role="row">
                <span role="columnheader">{t('colName')}</span>
                <span role="columnheader">{t('colPhone')}</span>
                <span role="columnheader">{t('colBranch')}</span>
                <span role="columnheader">{t('colStatus')}</span>
                <span role="columnheader">{t('colAvailability')}</span>
                <span role="columnheader">
                  <span className="sr-only">{t('colActions')}</span>
                </span>
              </div>
            </div>
            <div role="rowgroup">
              {riders.isPending
                ? [0, 1, 2, 3].map((i) => (
                    <div key={i} className="trow cols-riders" role="row">
                      <div role="cell" style={{ gridColumn: '1 / -1' }}>
                        <Skeleton zone="bo" style={{ height: 34, borderRadius: 10 }} />
                      </div>
                    </div>
                  ))
                : items.map((rider) => {
                    const canUpdate = can('riders.update', rider.branchId);
                    const occupancy = riderOccupancy(rider);
                    return (
                      <div key={rider.id} className="trow cols-riders" role="row">
                        <div role="cell" style={{ minWidth: 0 }}>
                          <button
                            type="button"
                            className="link-btn cell-main trunc"
                            aria-label={t('viewLabel', { name: rider.fullName })}
                            onClick={() => setDetailId(rider.id)}
                          >
                            {rider.fullName}
                          </button>
                          <div className="xs muted" style={{ fontWeight: 600 }}>
                            {rider.vehicleType
                              ? t(`vehicles.${rider.vehicleType}`)
                              : t('vehicleNone')}
                          </div>
                        </div>
                        <div className="sm muted hide-sm" style={{ fontWeight: 600 }} role="cell">
                          {rider.phoneMasked}
                        </div>
                        <div className="sm r-branch" style={{ fontWeight: 600 }} role="cell">
                          {rider.branchName}
                        </div>
                        <div className="r-status" role="cell">
                          <Pill zone="bo" tone={rider.active ? 'success' : 'muted'}>
                            {rider.active ? t('statusActive') : t('statusInactive')}
                          </Pill>
                        </div>
                        <div className="r-avail" role="cell">
                          <RiderAvailabilityControl rider={rider} canEdit={canUpdate} />
                          <div className="xs muted" style={{ fontWeight: 600 }}>
                            {occupancy === 'unknown'
                              ? t('occupancyUnknown')
                              : t(occupancy === 'busy' ? 'occupancyBusy' : 'occupancyFree')}
                          </div>
                        </div>
                        <div className="row-actions r-act" role="cell">
                          {canUpdate ? (
                            <>
                              <button
                                type="button"
                                className="btn sm edit-btn"
                                aria-label={t('editLabel', { name: rider.fullName })}
                                onClick={() => setModal({ kind: 'edit', id: rider.id })}
                              >
                                <IconPencil size="sm" />
                                {t('edit')}
                              </button>
                              <button
                                type="button"
                                className="btn sm"
                                aria-label={t('transferLabel', { name: rider.fullName })}
                                onClick={() => setModal({ kind: 'transfer', rider })}
                              >
                                {t('transfer')}
                              </button>
                              <button
                                type="button"
                                className="btn sm"
                                aria-label={t(rider.active ? 'deactivateLabel' : 'activateLabel', {
                                  name: rider.fullName,
                                })}
                                onClick={() => setModal({ kind: 'status', rider })}
                              >
                                {t(rider.active ? 'deactivate' : 'activate')}
                              </button>
                            </>
                          ) : (
                            <span className="xs muted" style={{ fontWeight: 700 }}>
                              {t('readOnly')}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </div>
          </div>
          {!riders.isPending && !riders.isError && items.length === 0 ? (
            hasRiderFilters(list) ? (
              <EmptyState
                zone="bo"
                title={t('noResultsTitle')}
                description={t('noResultsText')}
                action={
                  <button type="button" className="btn mt8" onClick={clearFilters}>
                    {t('clearFilters')}
                  </button>
                }
              />
            ) : (
              <EmptyState zone="bo" title={t('emptyTitle')} description={t('emptyText')} />
            )
          ) : null}
        </div>
      </div>

      {pages > 1 ? (
        <nav className="row gap10" aria-label={t('pagerLabel')} style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn sm"
            disabled={list.page <= 1}
            onClick={() => setList((s) => ({ ...s, page: s.page - 1 }))}
          >
            {t('prev')}
          </button>
          <span className="sm" style={{ fontWeight: 700 }} aria-live="polite">
            {t('pageOf', { page: list.page, pages })}
          </span>
          <button
            type="button"
            className="btn sm"
            disabled={list.page >= pages}
            onClick={() => setList((s) => ({ ...s, page: s.page + 1 }))}
          >
            {t('next')}
          </button>
        </nav>
      ) : null}

      <p className="sm muted" style={{ fontWeight: 600 }}>
        {t('note')}
      </p>

      {detailId ? (
        <RiderDrawer riderId={detailId} onClose={() => setDetailId(null)} onAction={fromDrawer} />
      ) : null}
      {modal?.kind === 'create' ? <RiderFormModal onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'edit' ? (
        <RiderFormModal riderId={modal.id} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'status' ? (
        <RiderStatusModal rider={modal.rider} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'transfer' ? (
        <RiderTransferModal
          rider={modal.rider}
          targets={targetsFor(modal.rider)}
          onClose={() => setModal(null)}
          onReload={() => riders.refetch()}
        />
      ) : null}
    </div>
  );
}
