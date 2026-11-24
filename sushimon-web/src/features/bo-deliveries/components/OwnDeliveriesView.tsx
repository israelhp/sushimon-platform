'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { isForbidden } from '@/features/bo-orders/error-message';
import { useAdminRiders, useRiderBranches } from '@/features/bo-riders/hooks';
import { formatDateTime } from '@/lib/format';
import {
  DEFAULT_DELIVERY_LIST,
  STATUS_FILTER_OPTIONS,
  classifyDeliveryError,
  hasDeliveryFilters,
  isOrderStatus,
  toDeliveryFilters,
  type DeliveryListState,
  type DeliveryStatusFilter,
} from '../delivery-model';
import { useAdminDeliveryList } from '../hooks';
import { useDeliveryErrorText } from '../use-delivery-actions';
import { DeliveryDrawer } from './DeliveryDrawer';
import { DeliveryStatusPill } from './DeliveryStatusPill';

/** Parámetro de la URL con el id de la entrega a abrir (lo usa Pedidos tras crear la entrega). Es un id, NUNCA PII. */
export const DELIVERY_PARAM = 'entrega';

/**
 * Reparto propio REAL (F28, spec 029 §13): lista por cursor con filtros de sucursal, estado (por defecto los abiertos) y motorista,
 * indicador «Esperando retorno», refresco dirigido (primera página con pausa en pestaña oculta) y detalle en panel lateral. La UI solo
 * muestra u oculta lo que el servidor informa (`availableActions`, `contactVisible`); el listado jamás trae PII del cliente.
 */
export function OwnDeliveriesView() {
  const t = useTranslations('backoffice.deliveries.fleet');
  const tu = useTranslations('ui');
  const to = useTranslations('backoffice.orders.live.status');
  const locale = useLocale();
  const { can } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const errorText = useDeliveryErrorText();
  const allBranches = useRiderBranches();
  const branches = useMemo(
    () => allBranches.filter((b) => can('deliveries.read', b.id)),
    [allBranches, can],
  );
  const [list, setList] = useState<DeliveryListState>(DEFAULT_DELIVERY_LIST);
  const [detail, setDetail] = useState<{ id: string; code?: string } | null>(() => {
    const id = params.get(DELIVERY_PARAM);
    return id ? { id } : null;
  });

  const filters = useMemo(() => toDeliveryFilters(list), [list]);
  const deliveries = useAdminDeliveryList(filters);
  const canSeeRiders = can('riders.read');
  const riders = useAdminRiders(
    {
      branchId: list.branchId || undefined,
      sort: 'fullName',
      order: 'asc',
      page: 1,
      pageSize: 100,
    },
    { enabled: canSeeRiders },
  );

  // Si se llega con `?entrega=<id>` (desde Pedidos), se limpia el parámetro ya leído; el id queda en el estado, no en la URL.
  useEffect(() => {
    if (params.get(DELIVERY_PARAM)) router.replace(pathname);
  }, [params, router, pathname]);

  if (isForbidden(deliveries.error)) return <ForbiddenScreen reason="server" />;

  const items = deliveries.items;
  const setFilter = (patch: Partial<DeliveryListState>) => setList((s) => ({ ...s, ...patch }));
  const clearFilters = () => setList(DEFAULT_DELIVERY_LIST);
  const error = deliveries.error ? classifyDeliveryError(deliveries.error) : null;
  const awaiting = items.filter((d) => d.awaitingReturn).length;

  return (
    <section aria-labelledby="own-deliveries-title" data-testid="own-deliveries">
      <div className="row gap8 wrap" style={{ marginBottom: 10, alignItems: 'center' }}>
        <h2 id="own-deliveries-title" className="sim-title">
          {t('title')}
        </h2>
        <span className="demo-badge own-badge">{t('badge')}</span>
      </div>

      <div className="toolbar toolbar-mb" role="group" aria-label={t('filters.label')}>
        <label className="toolbar-field">
          <span className="toolbar-label">{t('filters.branch')}</span>
          <select
            className="inp"
            value={list.branchId}
            onChange={(e) => setFilter({ branchId: e.target.value, riderId: '' })}
          >
            <option value="">{t('filters.branchAll')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar-field">
          <span className="toolbar-label">{t('filters.status')}</span>
          <select
            className="inp"
            value={list.status}
            onChange={(e) => setFilter({ status: e.target.value as DeliveryStatusFilter })}
          >
            {STATUS_FILTER_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'open' ? t('filters.statusOpen') : t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {canSeeRiders ? (
          <label className="toolbar-field">
            <span className="toolbar-label">{t('filters.rider')}</span>
            <select
              className="inp"
              value={list.riderId}
              onChange={(e) => setFilter({ riderId: e.target.value })}
            >
              <option value="">{t('filters.riderAll')}</option>
              {(riders.data?.items ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {hasDeliveryFilters(list) ? (
          <button type="button" className="btn" onClick={clearFilters}>
            {t('filters.clear')}
          </button>
        ) : null}
      </div>

      {error ? (
        <Banner zone="bo" tone="danger" role="alert">
          {errorText(error)}{' '}
          <button type="button" className="link-btn" onClick={() => deliveries.retry()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {awaiting > 0 ? (
        <p className="sm" style={{ fontWeight: 700 }} data-testid="awaiting-return-count">
          {t('awaitingReturnCount', { count: awaiting })}
        </p>
      ) : null}

      <div className="card">
        <div className="tscroll" style={{ paddingTop: 14 }}>
          <div
            className="min-odel"
            role="table"
            aria-label={t('table.label')}
            aria-busy={deliveries.isLoading || deliveries.isFetching}
          >
            <div role="rowgroup">
              <div className="thead cols-odel" role="row">
                <span role="columnheader">{t('table.order')}</span>
                <span role="columnheader">{t('table.branch')}</span>
                <span role="columnheader">{t('table.rider')}</span>
                <span role="columnheader">{t('table.status')}</span>
                <span role="columnheader">{t('table.updated')}</span>
                <span role="columnheader">
                  <span className="sr-only">{t('table.actions')}</span>
                </span>
              </div>
            </div>
            <div role="rowgroup">
              {deliveries.isLoading
                ? [0, 1, 2, 3].map((i) => (
                    <div key={i} className="trow cols-odel" role="row">
                      <div role="cell" style={{ gridColumn: '1 / -1' }}>
                        <Skeleton zone="bo" style={{ height: 34, borderRadius: 10 }} />
                      </div>
                    </div>
                  ))
                : items.map((d) => (
                    <div
                      key={d.id}
                      className="trow cols-odel"
                      role="row"
                      data-testid="delivery-row"
                    >
                      <div role="cell" style={{ minWidth: 0 }}>
                        <button
                          type="button"
                          className="link-btn cell-main trunc"
                          aria-label={t('table.view', { code: d.displayNumber })}
                          onClick={() => setDetail({ id: d.id, code: d.displayNumber })}
                        >
                          #{d.displayNumber}
                        </button>
                        <div className="xs muted trunc" style={{ fontWeight: 600 }}>
                          {[d.municipalityName, d.zone ? t('zoneName', { zone: d.zone }) : null]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </div>
                      </div>
                      <div className="sm o-branch" style={{ fontWeight: 600 }} role="cell">
                        {d.branchName}
                      </div>
                      <div className="o-rider" role="cell" style={{ minWidth: 0 }}>
                        {d.rider ? (
                          <>
                            <div className="sm trunc" style={{ fontWeight: 700 }}>
                              {d.rider.fullName}
                            </div>
                            <div className="xs muted num" style={{ fontWeight: 600 }}>
                              {d.rider.phoneMasked}
                            </div>
                          </>
                        ) : (
                          <span className="sm muted" style={{ fontWeight: 600 }}>
                            {t('table.noRider')}
                          </span>
                        )}
                      </div>
                      <div className="o-status" role="cell">
                        <div className="row gap8 wrap">
                          <DeliveryStatusPill status={d.status} />
                          {d.awaitingReturn ? (
                            <span className="late">{t('awaitingReturn')}</span>
                          ) : null}
                        </div>
                        <div className="xs muted" style={{ fontWeight: 600 }}>
                          {isOrderStatus(d.orderStatus) ? to(d.orderStatus) : d.orderStatus}
                        </div>
                      </div>
                      <div className="sm muted o-updated hide-sm" role="cell">
                        {formatDateTime(d.updatedAt, locale)}
                      </div>
                      <div className="row-actions o-act" role="cell">
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={t('table.openLabel', { code: d.displayNumber })}
                          onClick={() => setDetail({ id: d.id, code: d.displayNumber })}
                        >
                          {t('table.open')}
                        </button>
                      </div>
                    </div>
                  ))}
            </div>
          </div>
          {!deliveries.isLoading && !error && items.length === 0 ? (
            hasDeliveryFilters(list) ? (
              <EmptyState
                zone="bo"
                title={t('noResultsTitle')}
                description={t('noResultsText')}
                action={
                  <button type="button" className="btn mt8" onClick={clearFilters}>
                    {t('filters.clear')}
                  </button>
                }
              />
            ) : (
              <EmptyState zone="bo" title={t('emptyTitle')} description={t('emptyText')} />
            )
          ) : null}
        </div>
        {deliveries.nextCursor || deliveries.moreError ? (
          <div className="card-foot">
            <span className="sm" style={{ fontWeight: 700 }} aria-live="polite">
              {deliveries.moreError ? t('moreError') : t('showing', { count: items.length })}
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="btn sm"
              disabled={deliveries.loadingMore}
              aria-busy={deliveries.loadingMore}
              onClick={() => void deliveries.loadMore()}
            >
              {deliveries.loadingMore ? t('loadingMore') : t('loadMore')}
            </button>
          </div>
        ) : null}
      </div>

      <p className="sm muted" style={{ fontWeight: 600 }}>
        {t('note')}
      </p>

      {detail ? (
        <DeliveryDrawer
          deliveryId={detail.id}
          code={detail.code}
          onClose={() => setDetail(null)}
          onChanged={deliveries.reset}
        />
      ) : null}
    </section>
  );
}
