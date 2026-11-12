'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { IconDownload, IconInfo } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Kpi } from '@/components/ui/Kpi';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useDeliveries, useRiders } from '@/features/backoffice/hooks';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { formatLongDate, formatTopbarDate } from '@/features/backoffice-shell/staff-display';
import { useNow } from '@/features/backoffice-shell/use-now';
import { isForbidden } from '@/features/bo-orders/error-message';
import { useScopedOrders } from '@/features/bo-orders/use-scoped-orders';
import { formatMoney } from '@/lib/format';
import { fromLocal, localDate } from '@/lib/time';
import {
  DEFAULT_DELIVERY_FILTERS,
  DELIVERY_PAGE_SIZE,
  activeFilterCount,
  clampPeriod,
  deliveryStats,
  filterBase,
  filterRows,
  quickRange,
  ridersOfPeriod,
  riderOptions,
  sortRows,
  toDeliveryRows,
  zoneOptions,
  type DeliveryFilters,
  type QuickRange,
} from '../deliveries-view';
import { DeliveriesFilters } from './DeliveriesFilters';
import { DeliveriesTable } from './DeliveriesTable';
import { OwnRiderCards, PeriodRiders } from './DeliveryRiders';

/** Refresco de los envíos (el estado logístico simulado avanza desde el detalle del pedido). */
export const DELIVERIES_REFRESH_MS = 30_000;

/** Pantalla Entregas: periodo, filtros, indicadores, repartidores y tabla de envíos (PedidosYa SIMULADO). */
export function DeliveriesScreen() {
  const now = useNow();
  if (!now) return <DeliveriesSkeleton />;
  return <DeliveriesView now={now} />;
}

function DeliveriesSkeleton() {
  return (
    <div className="page" style={{ animation: 'none' }} aria-busy="true">
      <Skeleton zone="bo" style={{ height: 60, borderRadius: 16 }} />
      <Skeleton zone="bo" style={{ height: 160, borderRadius: 16 }} />
      <Skeleton zone="bo" style={{ height: 320, borderRadius: 16 }} />
    </div>
  );
}

function DeliveriesView({ now }: { now: Date }) {
  const t = useTranslations('backoffice.deliveries');
  const tu = useTranslations('ui');
  const toast = useToast();
  const shell = useShell();
  const today = localDate(now);

  const [range, setRange] = useState<QuickRange>('hoy');
  const [custom, setCustom] = useState({ from: today, to: today });
  const [filters, setFilters] = useState<DeliveryFilters>(DEFAULT_DELIVERY_FILTERS);
  const [limit, setLimit] = useState(DELIVERY_PAGE_SIZE);

  const requested = range === 'custom' ? custom : quickRange(range, today);
  const period = clampPeriod(requested.from, requested.to, today);

  const deliveries = useDeliveries(
    { from: period.from, to: period.to, branchId: shell.branchId },
    { refetchInterval: DELIVERIES_REFRESH_MS },
  );
  const todayOrders = useScopedOrders();
  const riders = useRiders(shell.branchId);

  const rows = toDeliveryRows(deliveries.data ?? [], today, now);
  const base = filterBase(rows, filters);
  const filtered = sortRows(filterRows(rows, filters), filters.sort);
  const shown = filtered.slice(0, limit);
  const stats = deliveryStats(filtered);
  const periodRiders = ridersOfPeriod(base);
  const zones = zoneOptions(rows);
  const riderChoices = riderOptions(rows);
  const ownRiders = (riders.data ?? []).filter(
    (r) => !shell.branchId || r.branchId === shell.branchId,
  );

  const patchFilters = (patch: Partial<DeliveryFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setLimit(DELIVERY_PAGE_SIZE);
  };
  const pickRange = (r: Exclude<QuickRange, 'custom'>) => {
    setRange(r);
    setLimit(DELIVERY_PAGE_SIZE);
  };
  const pickCustom = (patch: Partial<{ from: string; to: string }>) => {
    setCustom({ from: period.from, to: period.to, ...patch });
    setRange('custom');
    setLimit(DELIVERY_PAGE_SIZE);
  };

  if (isForbidden(deliveries.error)) return <ForbiddenScreen reason="server" />;

  const day = (iso: string) => formatTopbarDate(fromLocal(iso, '12:00'));
  const periodLabel = period.days
    ? period.days === 1
      ? formatLongDate(fromLocal(period.from, '12:00'))
      : t('period.range', { from: day(period.from), to: day(period.to), days: period.days })
    : t('period.none');
  const branchLabel = shell.branchId
    ? (shell.branchById(shell.branchId)?.name ?? shell.branchId)
    : t('branchAll');
  const filtersOn = activeFilterCount(filters) > 0;
  const signed = (n: number) => `${n > 0 ? '+' : ''}${formatMoney(n)}`;
  const big = (value: string) => <span style={{ fontSize: 26 }}>{value}</span>;
  const remaining = filtered.length - shown.length;

  return (
    <div className="page" style={{ animation: 'none' }}>
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">
            {t('subtitle', { period: periodLabel, branch: branchLabel })}{' '}
            <SimulationBadge kind="simulation" zone="bo" />
          </div>
        </div>
        <button
          type="button"
          className="btn sm"
          onClick={() => toast.notify(t('exportToast', { count: filtered.length }))}
        >
          <IconDownload size="sm" />
          {t('exportCsv')}
        </button>
      </div>

      <DeliveriesFilters
        period={period}
        periodLabel={periodLabel}
        range={range}
        onRange={pickRange}
        onFrom={(from) => pickCustom({ from })}
        onTo={(to) => pickCustom({ to })}
        filters={filters}
        onFilters={patchFilters}
        onClear={() => patchFilters({ ...DEFAULT_DELIVERY_FILTERS, sort: filters.sort })}
        zones={zones}
        riders={riderChoices}
        total={rows.length}
      />

      {deliveries.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void deliveries.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {deliveries.isPending ? (
        <div aria-busy="true" role="status" aria-label={t('table.loading')}>
          <Skeleton zone="bo" style={{ height: 120, borderRadius: 16 }} />
          <div className="mt8" />
          <Skeleton zone="bo" style={{ height: 280, borderRadius: 16 }} />
        </div>
      ) : (
        <>
          <div className="kpis">
            <Kpi
              tone="neutral"
              label={t('kpi.shipments')}
              value={big(String(stats.total))}
              foot={filtersOn ? t('kpi.shipmentsFiltered') : t('kpi.shipmentsPeriod')}
            />
            <Kpi
              tone="violet"
              label={t('kpi.own')}
              value={big(String(stats.own))}
              foot={t('kpi.ownFoot', { count: stats.pedidosya })}
            />
            <Kpi
              tone="green"
              label={t('kpi.delivered')}
              value={big(String(stats.delivered))}
              foot={t('kpi.deliveredFoot', {
                none: stats.withoutRider,
                progress: stats.inProgress,
              })}
            />
            <Kpi
              tone="amber"
              label={t('kpi.avg')}
              value={big(stats.avgMinutes ? t('kpi.avgValue', { minutes: stats.avgMinutes }) : '—')}
              foot={t('kpi.avgFoot')}
            />
            <Kpi
              tone="blue"
              label={t('kpi.cost')}
              value={big(formatMoney(stats.cost))}
              foot={t('kpi.costFoot', { charged: formatMoney(stats.charged) })}
            />
            <Kpi
              tone="red"
              label={t('kpi.diff')}
              value={big(signed(stats.difference))}
              foot={t('kpi.diffFoot', { count: stats.withDifference })}
            />
          </div>

          <PeriodRiders
            riders={periodRiders}
            selected={filters.rider}
            onPick={(name) => patchFilters({ rider: filters.rider === name ? 'all' : name })}
          />
          <OwnRiderCards riders={ownRiders} todayOrders={todayOrders.data ?? []} />

          <section className="card">
            <div className="card-h">
              <div className="grow">
                <h2>{t('table.title')}</h2>
                <div className="muted sm" style={{ fontWeight: 600 }}>
                  {t('table.sub', { shown: shown.length, total: filtered.length })}
                </div>
              </div>
            </div>
            <DeliveriesTable rows={shown} today={today} />
            {remaining > 0 ? (
              <div className="card-foot">
                <span className="sm" style={{ fontWeight: 700 }}>
                  {t('table.showing', { shown: shown.length, total: filtered.length })}
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setLimit((l) => l + DELIVERY_PAGE_SIZE)}
                >
                  {t('table.more', { count: Math.min(DELIVERY_PAGE_SIZE, remaining) })}
                </button>
              </div>
            ) : null}
          </section>
        </>
      )}

      <Banner zone="bo" tone="info" icon={<IconInfo size="sm" />}>
        {t('note')}
      </Banner>
    </div>
  );
}
