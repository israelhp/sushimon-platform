'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { isApiError } from '@/lib/data-access/errors';
import { isForbidden } from '@/features/bo-orders/error-message';
import {
  useAdminDeliveryZones,
  useDepartments,
  useLocationOptions,
  useSetDeliveryZoneStatus,
} from '@/features/delivery-coverage/hooks';
import type { AdminBranch, AdminDeliveryZone } from '@/lib/data-access/models';
import { formatMoneyGtq } from '@/lib/delivery-zone';
import {
  DEFAULT_ZONE_LIST,
  hasZoneFilters,
  toZoneFilters,
  zonePageCount,
  zoneLabelText,
  zoneServerError,
  type ZoneListState,
  type ZoneSortKey,
  type ZoneStatusFilter,
} from '../delivery-view';
import { ConfirmModal } from './ConfirmModal';
import { DeliveryZoneFormModal } from './DeliveryZoneFormModal';

const SEARCH_DEBOUNCE_MS = 300;

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; zone: AdminDeliveryZone }
  | { kind: 'status'; zone: AdminDeliveryZone };

/**
 * Zonas propias de entrega (F09). Con `branch` es la lista de UNA sucursal; sin ella lista todas las sucursales del
 * alcance (columna «Sucursal» y filtro). Filtros (sucursal, departamento → municipio, estado, texto), orden y paginación
 * del servidor; alta, edición y activar/desactivar con confirmación (sin borrado físico). Los permisos solo ocultan
 * escrituras: el servidor decide y puede responder 403 o 404, que se muestran sin romper la pantalla.
 */
export function DeliveryZonesPanel({
  branch,
  branches,
}: {
  branch?: AdminBranch;
  branches: readonly AdminBranch[];
}) {
  const t = useTranslations('backoffice.branchDelivery.zones');
  const tu = useTranslations('ui');
  const toast = useToast();
  const { can } = useShell();
  const [list, setList] = useState<ZoneListState>(DEFAULT_ZONE_LIST);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [actionError, setActionError] = useState('');
  const status = useSetDeliveryZoneStatus();

  // La búsqueda se envía con un pequeño retardo y reinicia la página.
  useEffect(() => {
    const id = setTimeout(
      () => setList((s) => (s.q === search ? s : { ...s, q: search, page: 1 })),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [search]);

  const filters = useMemo(() => toZoneFilters(list, branch?.id), [list, branch?.id]);
  const zones = useAdminDeliveryZones(filters);
  const departments = useDepartments();
  const department = departments.data?.find((d) => d.id === list.departmentId);
  const municipalities = useLocationOptions(department?.name ?? '');

  const items = zones.data?.items ?? [];
  const total = zones.data?.total ?? 0;
  const pages = zonePageCount(total, zones.data?.pageSize);

  // Si la página pedida quedó vacía (p. ej., se desactivó la última fila de un filtro), retrocede una página.
  if (zones.data && !zones.isPlaceholderData && items.length === 0 && list.page > 1) {
    setList((s) => ({ ...s, page: Math.max(1, Math.min(s.page - 1, pages)) }));
  }

  const canCreate = branch
    ? can('branches.manage_delivery_zones', branch.id)
    : can('branches.manage_delivery_zones');
  const canManageRow = (z: AdminDeliveryZone) => can('branches.manage_delivery_zones', z.branchId);
  const branchName = (id: string) =>
    branch?.id === id ? branch.name : (branches.find((b) => b.id === id)?.name ?? id);
  const setFilter = (patch: Partial<ZoneListState>) =>
    setList((s) => ({ ...s, ...patch, page: 1 }));
  const clearFilters = () => {
    setSearch('');
    setList(DEFAULT_ZONE_LIST);
  };
  const close = () => {
    setDialog(null);
    setActionError('');
  };

  const forbidden = isForbidden(zones.error);
  const notFound = isApiError(zones.error) && zones.error.status === 404;

  const toggle = (zone: AdminDeliveryZone) =>
    status.mutate(
      { id: zone.id, input: { active: !zone.active } },
      {
        onSuccess: () => {
          toast.notify(t(zone.active ? 'status.toastDeactivated' : 'status.toastActivated'));
          close();
        },
        onError: (e) => setActionError(zoneServerError(e).message),
      },
    );

  const statusOptions: { value: ZoneStatusFilter; label: string }[] = [
    { value: 'all', label: t('filterAll') },
    { value: 'active', label: t('filterActive') },
    { value: 'inactive', label: t('filterInactive') },
  ];
  const sortLabels: Record<ZoneSortKey, string> = {
    municipality: t('sortMunicipality'),
    baseFee: t('sortFee'),
    createdAt: t('sortCreated'),
  };
  const orderText = list.order === 'asc' ? t('orderAsc') : t('orderDesc');
  const cols = branch ? 'cols-zones one' : 'cols-zones';

  if (forbidden || notFound) {
    return (
      <Banner zone="bo" tone="warning" role="alert">
        {forbidden ? t('forbidden') : zoneServerError(zones.error).message}
      </Banner>
    );
  }

  return (
    <div className="hrs">
      {!canCreate ? (
        <Banner zone="bo" tone="info">
          {t('readOnly', { permission: 'branches.manage_delivery_zones' })}
        </Banner>
      ) : null}
      <p className="xs muted" style={{ fontWeight: 600, margin: 0 }}>
        {t('note')}
      </p>

      <div className="row gap10" style={{ flexWrap: 'wrap' }}>
        <SearchInput
          zone="bo"
          inline
          clearable
          value={search}
          onValueChange={setSearch}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
        />
        {!branch ? (
          <label className="row gap8">
            <span className="sm muted" style={{ fontWeight: 700 }}>
              {t('filterBranch')}
            </span>
            <select
              className="inp"
              style={{ width: 'auto' }}
              value={list.branchId}
              onChange={(e) => setFilter({ branchId: e.target.value })}
            >
              <option value="">{t('filterAll')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="row gap8">
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('filterDepartment')}
          </span>
          <select
            className="inp"
            style={{ width: 'auto' }}
            value={list.departmentId}
            onChange={(e) => setFilter({ departmentId: e.target.value, municipalityId: '' })}
          >
            <option value="">{t('filterAllM')}</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="row gap8">
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('filterMunicipality')}
          </span>
          <select
            className="inp"
            style={{ width: 'auto' }}
            value={list.municipalityId}
            disabled={!list.departmentId}
            onChange={(e) => setFilter({ municipalityId: e.target.value })}
          >
            <option value="">{t('filterAllM')}</option>
            {municipalities.municipalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <SegmentedControl
          zone="bo"
          label={t('filterStatus')}
          value={list.status}
          options={statusOptions}
          onChange={(value) => setFilter({ status: value })}
        />
        <label className="row gap8">
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('sortLabel')}
          </span>
          <select
            className="inp"
            style={{ width: 'auto' }}
            value={list.sort}
            onChange={(e) => setFilter({ sort: e.target.value as ZoneSortKey })}
          >
            {(Object.keys(sortLabels) as ZoneSortKey[]).map((key) => (
              <option key={key} value={key}>
                {sortLabels[key]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn sm"
          aria-label={t('orderToggle', { order: orderText })}
          onClick={() => setFilter({ order: list.order === 'asc' ? 'desc' : 'asc' })}
        >
          <span aria-hidden="true">{list.order === 'asc' ? '↑' : '↓'}</span> {orderText}
        </button>
        <span className="spacer" />
        {canCreate ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setDialog({ kind: 'create' })}
          >
            <IconPlus size="sm" />
            {t('new')}
          </button>
        ) : null}
      </div>
      <div className="sm muted" style={{ fontWeight: 700 }} aria-live="polite">
        {zones.data ? t('total', { total }) : ' '}
      </div>

      {zones.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('loadError')}{' '}
          <button type="button" className="link-btn" onClick={() => void zones.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {zones.isPending ? (
        <div aria-busy="true" aria-label={tu('loading')} className="hrs">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} zone="bo" style={{ height: 48, borderRadius: 12 }} />
          ))}
        </div>
      ) : !zones.isError && items.length === 0 ? (
        hasZoneFilters(list, branch?.id) ? (
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
      ) : !zones.isError ? (
        <div className="card">
          <div className="tscroll">
            <div
              className="min-zones"
              role="table"
              aria-label={t('tableLabel')}
              aria-busy={zones.isFetching}
            >
              <div className={`thead ${cols}`} role="row">
                {!branch ? <span role="columnheader">{t('colBranch')}</span> : null}
                <span role="columnheader">{t('colMunicipality')}</span>
                <span role="columnheader">{t('colZone')}</span>
                <span role="columnheader">{t('colFee')}</span>
                <span role="columnheader">{t('colStatus')}</span>
                <span role="columnheader">
                  <span className="sr-only">{t('edit')}</span>
                </span>
              </div>
              {items.map((z) => (
                <div key={z.id} className={`trow ${cols}`} role="row">
                  {!branch ? (
                    <div className="cell-main trunc" role="cell">
                      {branchName(z.branchId)}
                    </div>
                  ) : null}
                  <div role="cell">
                    <div className="cell-main trunc">{z.municipalityName}</div>
                    <div className="xs muted" style={{ fontWeight: 600 }}>
                      {z.departmentName}
                    </div>
                  </div>
                  <div role="cell" style={{ fontWeight: 700 }}>
                    {zoneLabelText(z)}
                  </div>
                  <div role="cell" className="num" style={{ fontWeight: 700 }}>
                    {formatMoneyGtq(z.baseFee)}
                  </div>
                  <div role="cell">
                    <Pill zone="bo" tone={z.active ? 'success' : 'muted'}>
                      {z.active ? t('statusActive') : t('statusInactive')}
                    </Pill>
                  </div>
                  <div className="row-actions z-act" role="cell">
                    {canManageRow(z) ? (
                      <>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={t('editLabel', {
                            zone: zoneLabelText(z),
                            municipality: z.municipalityName,
                          })}
                          onClick={() => setDialog({ kind: 'edit', zone: z })}
                        >
                          <IconPencil size="sm" />
                          {t('edit')}
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={t(z.active ? 'deactivateLabel' : 'activateLabel', {
                            zone: zoneLabelText(z),
                            municipality: z.municipalityName,
                          })}
                          onClick={() => setDialog({ kind: 'status', zone: z })}
                        >
                          {z.active ? t('deactivate') : t('activate')}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {pages > 1 ? (
        <nav className="row gap10" aria-label={t('pagerLabel')}>
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

      {dialog?.kind === 'create' ? (
        <DeliveryZoneFormModal branch={branch} branches={branches} onClose={close} />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <DeliveryZoneFormModal
          zone={dialog.zone}
          branch={branch}
          branches={branches}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'status' ? (
        <ConfirmModal
          title={t(dialog.zone.active ? 'status.deactivateTitle' : 'status.activateTitle')}
          description={branchName(dialog.zone.branchId)}
          danger={dialog.zone.active}
          confirmLabel={t('status.action')}
          cancelLabel={t('status.back')}
          pendingLabel={t('status.working')}
          pending={status.isPending}
          error={actionError}
          onConfirm={() => toggle(dialog.zone)}
          onClose={close}
        >
          {t(dialog.zone.active ? 'status.deactivateText' : 'status.activateText', {
            zone: zoneLabelText(dialog.zone),
            municipality: dialog.zone.municipalityName,
          })}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
