'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { IconBike, IconClock, IconPencil, IconPlus, IconStore } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useBackofficeOrders, useDashboard } from '@/features/backoffice/hooks';
import { useAdminBranches } from '@/features/branches/hooks';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { isForbidden } from '@/features/bo-orders/error-message';
import type { AdminBranch } from '@/lib/data-access/models';
import { canGlobally } from '@/lib/permissions';
import { cn } from '@/lib/cn';
import {
  branchStats,
  coordinatesLabel,
  DEFAULT_BRANCH_LIST,
  hasActiveFilters,
  pageCount,
  toAdminFilters,
  type BranchListState,
  type BranchSortKey,
  type BranchStatusFilter,
} from '../branches-view';
import { formatMoneyCompact } from '../format';
import { AllDeliveryZonesModal, BranchDeliveryModal } from './BranchDeliveryModal';
import { BranchDeliverySummary } from './BranchDeliverySummary';
import { BranchFormModal } from './BranchFormModal';
import { BranchOperationalStatus } from './BranchOperationalStatus';
import { BranchScheduleModal } from './BranchScheduleModal';
import { BranchStatusModal } from './BranchStatusModal';

const SEARCH_DEBOUNCE_MS = 300;

const dateFormat = new Intl.DateTimeFormat('es-GT', {
  dateStyle: 'medium',
  timeZone: 'America/Guatemala',
});

type Modal =
  | { kind: 'create' }
  | { kind: 'edit'; branch: AdminBranch }
  | { kind: 'status'; branch: AdminBranch }
  | { kind: 'schedule'; branch: AdminBranch }
  | { kind: 'delivery'; branch: AdminBranch }
  | { kind: 'allZones' };

/**
 * Sucursales (admin) — F07. Lista paginada con búsqueda, filtro por estado y orden; alta, edición y activación /
 * desactivación (estado ADMINISTRATIVO, con motivo). F08: estado operativo diferenciado (abierta, cerrada por horario,
 * cierre extraordinario, sin horario) y editor de horario semanal y cierres. F09: «Entrega y zonas» por sucursal
 * (proveedores y zonas propias) y «Zonas de entrega» de todas las sucursales del alcance. Las estadísticas siguen
 * siendo SIMULADAS (F33) y se rotulan «Simulación». La pausa operativa no existe (pendiente de negocio). La UI solo
 * muestra/oculta; la API autoriza.
 */
export function BranchesScreen() {
  const t = useTranslations('backoffice.branches');
  const tu = useTranslations('ui');
  const ts = useTranslations('backoffice.branchSchedule');
  const td = useTranslations('backoffice.branchDelivery');
  const { can, grants } = useShell();
  const [list, setList] = useState<BranchListState>(DEFAULT_BRANCH_LIST);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);

  // La búsqueda se envía con un pequeño retardo y reinicia la página.
  useEffect(() => {
    const id = setTimeout(
      () => setList((s) => (s.q === search ? s : { ...s, q: search, page: 1 })),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [search]);

  const filters = useMemo(() => toAdminFilters(list), [list]);
  const branches = useAdminBranches(filters);
  // 🎭 Estadísticas SIMULADAS (F33).
  const dashboard = useDashboard();
  const orders = useBackofficeOrders({});

  const items = branches.data?.items ?? [];
  const total = branches.data?.total ?? 0;
  const pages = pageCount(total, branches.data?.pageSize);

  // Si la página pedida quedó vacía (p. ej., se desactivó la última fila de un filtro), retrocede una página.
  if (branches.data && !branches.isPlaceholderData && items.length === 0 && list.page > 1) {
    setList((s) => ({ ...s, page: Math.max(1, Math.min(s.page - 1, pages)) }));
  }

  if (isForbidden(branches.error)) return <ForbiddenScreen reason="server" />;

  const canEdit = can('branches.update');
  // El alta es global (solo con `branches.create` en todas las sucursales); la API lo vuelve a exigir.
  const canCreate = canGlobally(grants, 'branches.create');
  const setFilter = (patch: Partial<BranchListState>) =>
    setList((s) => ({ ...s, ...patch, page: 1 }));
  const clearFilters = () => {
    setSearch('');
    setList(DEFAULT_BRANCH_LIST);
  };

  const statusOptions: { value: BranchStatusFilter; label: string }[] = [
    { value: 'all', label: t('filterAll') },
    { value: 'active', label: t('filterActive') },
    { value: 'inactive', label: t('filterInactive') },
  ];
  const sortLabels: Record<BranchSortKey, string> = {
    name: t('sortName'),
    code: t('sortCode'),
    createdAt: t('sortCreated'),
  };

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">{branches.data ? t('subtitle', { total }) : ' '}</div>
        </div>
        <SearchInput
          zone="bo"
          inline
          clearable
          value={search}
          onValueChange={setSearch}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
        />
        <button type="button" className="btn" onClick={() => setModal({ kind: 'allZones' })}>
          <IconBike size="sm" />
          {td('allZonesOpen')}
        </button>
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

      <div className="row gap10" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        <SegmentedControl
          zone="bo"
          label={t('statusFilterLabel')}
          value={list.status}
          options={statusOptions}
          onChange={(status) => setFilter({ status })}
        />
        <label className="row gap8">
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('sortLabel')}
          </span>
          <select
            className="inp"
            style={{ width: 'auto' }}
            value={list.sort}
            onChange={(e) => setFilter({ sort: e.target.value as BranchSortKey })}
          >
            {(Object.keys(sortLabels) as BranchSortKey[]).map((key) => (
              <option key={key} value={key}>
                {sortLabels[key]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn sm"
          aria-label={t('orderToggle', {
            order: list.order === 'asc' ? t('orderAsc') : t('orderDesc'),
          })}
          onClick={() => setFilter({ order: list.order === 'asc' ? 'desc' : 'asc' })}
        >
          {list.order === 'asc' ? '↑' : '↓'} {list.order === 'asc' ? t('orderAsc') : t('orderDesc')}
        </button>
      </div>

      {branches.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void branches.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {branches.isPending ? (
        <div className="bgrid" aria-busy="true" aria-label={tu('loading')}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} zone="bo" style={{ height: 360, borderRadius: 16 }} />
          ))}
        </div>
      ) : !branches.isError && items.length === 0 ? (
        hasActiveFilters(list) ? (
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
      ) : (
        <div className="bgrid" aria-busy={branches.isFetching}>
          {items.map((branch) => {
            const stats = branchStats(branch.id, dashboard.data?.byBranch, orders.data);
            const statsPending = dashboard.isPending || orders.isPending;
            const statsAvailable = !dashboard.isError && !orders.isError;
            return (
              <div key={branch.id} className={cn('bcard', !branch.active && 'off')}>
                <div className="bcard-top">
                  <span className="bcard-ic">
                    <IconStore />
                  </span>
                  <div className="grow">
                    <div className="cname">{branch.name}</div>
                    <div className="sm muted" style={{ fontWeight: 700 }}>
                      <code>{branch.code}</code>
                    </div>
                  </div>
                  <Pill zone="bo" tone={branch.active ? 'success' : 'muted'}>
                    {branch.active ? t('statusActive') : t('statusInactive')}
                  </Pill>
                </div>
                <div className="bcard-b">
                  <dl className="kv">
                    <dt>{t('address')}</dt>
                    <dd>{branch.address}</dd>
                    <dt>{t('phone')}</dt>
                    <dd className="num">{branch.phone ?? t('noPhone')}</dd>
                    <dt>{t('coordinates')}</dt>
                    <dd>{coordinatesLabel(branch)}</dd>
                    <dt>{t('createdAt')}</dt>
                    <dd>{dateFormat.format(new Date(branch.createdAt))}</dd>
                    <dt>{ts('status.label')}</dt>
                    <dd>
                      <BranchOperationalStatus branch={branch} />
                    </dd>
                  </dl>
                  <dl className="kv">
                    <dt>{td('summaryLabel')}</dt>
                    <dd>
                      <BranchDeliverySummary branchId={branch.id} />
                    </dd>
                  </dl>
                  <div className="row gap8" style={{ flexWrap: 'wrap' }}>
                    <span className="sm muted" style={{ fontWeight: 700 }}>
                      {t('statsLabel')}
                    </span>
                    <SimulationBadge zone="bo" />
                  </div>
                  <div className="row gap8">
                    <Switch
                      zone="bo"
                      checked={branch.active}
                      label={t('switchLabel', { name: branch.name })}
                      disabled={!canEdit}
                      onCheckedChange={() => setModal({ kind: 'status', branch })}
                    />
                    <span className="sm" style={{ fontWeight: 700 }}>
                      {branch.active ? t('switchOn') : t('switchOff')}
                    </span>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={td('openLabel', { name: branch.name })}
                      onClick={() => setModal({ kind: 'delivery', branch })}
                    >
                      <IconBike size="sm" />
                      {td('open')}
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={ts('openLabel', { name: branch.name })}
                      onClick={() => setModal({ kind: 'schedule', branch })}
                    >
                      <IconClock size="sm" />
                      {ts('open')}
                    </button>
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn sm"
                        aria-label={t('editLabel', { name: branch.name })}
                        onClick={() => setModal({ kind: 'edit', branch })}
                      >
                        <IconPencil size="sm" />
                        {t('edit')}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="bstats">
                  <span>
                    <b>{statsPending || !statsAvailable ? '—' : stats.orders}</b>
                    {t('statOrders')}
                  </span>
                  <span>
                    <b>{statsPending || !statsAvailable ? '—' : stats.active}</b>
                    {t('statActive')}
                  </span>
                  <span>
                    <b>{statsPending || !statsAvailable ? '—' : formatMoneyCompact(stats.sales)}</b>
                    {t('statSales')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
        {t('stateNote')}
      </p>
      <p className="sm muted" style={{ fontWeight: 600 }}>
        {t('simNote')}
      </p>

      {modal?.kind === 'create' ? <BranchFormModal onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'edit' ? (
        <BranchFormModal branch={modal.branch} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'schedule' ? (
        <BranchScheduleModal branch={modal.branch} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'delivery' ? (
        <BranchDeliveryModal branch={modal.branch} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'allZones' ? <AllDeliveryZonesModal onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'status' ? (
        <BranchStatusModal branch={modal.branch} onClose={() => setModal(null)} />
      ) : null}
    </div>
  );
}
