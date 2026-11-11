'use client';

import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Kpi } from '@/components/ui/Kpi';
import { Skeleton } from '@/components/ui/Skeleton';
import { useShell } from '@/features/backoffice-shell/shell-context';
import type { ReportSummary } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { dayLong, formatMoneyCompact } from '../format';
import { buildReportCharts, summaryKpis } from '../reports-view';
import { OrdersChart, SalesChart } from './ReportCharts';

export interface ReportSummaryTabProps {
  summary: ReportSummary | undefined;
  pending: boolean;
  error: boolean;
  onRetry: () => void;
  today: string;
  /** Etiqueta del periodo ("Jue 5 nov – Mié 11 nov · 7 días"). */
  rangeLabel: string;
}

/** Pestaña "Resumen y gráficos": KPIs, pedidos y ventas por periodo, ventas por sucursal y productos más vendidos. */
export function ReportSummaryTab({
  summary,
  pending,
  error,
  onRetry,
  today,
  rangeLabel,
}: ReportSummaryTabProps) {
  const t = useTranslations('backoffice.reports');
  const tu = useTranslations('ui');
  const { branches } = useShell();

  if (error && !summary) {
    return (
      <Banner zone="bo" tone="danger" role="alert">
        {t('error')}{' '}
        <button type="button" className="link-btn" onClick={onRetry}>
          {tu('retry')}
        </button>
      </Banner>
    );
  }
  if (pending || !summary) {
    return (
      <div aria-busy="true" aria-label={t('loading')} style={{ display: 'grid', gap: 16 }}>
        <div className="rk">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} zone="bo" style={{ height: 114, borderRadius: 16 }} />
          ))}
        </div>
        <Skeleton zone="bo" style={{ height: 300, borderRadius: 16 }} />
      </div>
    );
  }

  const kpis = summaryKpis(summary);
  const charts = buildReportCharts(summary, branches, today);
  const unit = t(charts.unit === 'hour' ? 'unitHour' : 'unitDay');

  return (
    <>
      {summary.clipped ? (
        <Banner zone="bo" tone="warning">
          {t('clipped', { min: dayLong(summary.minDate) })}
        </Banner>
      ) : null}

      <div className="rk">
        <Kpi
          label={t('kpiOrders')}
          value={kpis.orders.toLocaleString('en-US')}
          foot={t('kpiOrdersFoot', { count: kpis.cancelled })}
          tone="neutral"
        />
        <Kpi
          label={t('kpiSales')}
          value={formatMoneyCompact(kpis.sales)}
          foot={formatMoney(kpis.sales)}
          tone="coral"
        />
        <Kpi
          label={t('kpiTicket')}
          value={formatMoney(kpis.averageTicket)}
          foot={t('kpiTicketFoot')}
          tone="amber"
        />
        <Kpi
          label={t('kpiDelivery')}
          value={`${kpis.deliveryPct} %`}
          foot={t('kpiDeliveryFoot', { count: kpis.deliveryOrders })}
          tone="blue"
        />
      </div>

      {kpis.orders === 0 ? (
        <EmptyState zone="bo" title={t('emptyTitle')} description={t('emptyText')} />
      ) : (
        <>
          <section className="card">
            <div className="card-h">
              <div className="grow">
                <h2>{t('ordersChartTitle', { unit })}</h2>
                <div className="muted sm" style={{ fontWeight: 600 }}>
                  {rangeLabel}
                </div>
              </div>
              <div className="legend">
                {charts.legend.map((l) => (
                  <span key={l.branchId}>
                    <i style={{ background: l.color }} />
                    {l.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="card-b tscroll">
              <OrdersChart
                charts={charts}
                rangeText={rangeLabel}
                totalOrders={kpis.orders}
                totalSales={kpis.sales}
              />
            </div>
          </section>

          <div className="grid-2">
            <section className="card">
              <div className="card-h">
                <div className="grow">
                  <h2>{t('salesChartTitle', { unit })}</h2>
                  <div className="muted sm" style={{ fontWeight: 600 }}>
                    {t('salesChartSub')}
                  </div>
                </div>
              </div>
              <div className="card-b tscroll">
                <SalesChart
                  charts={charts}
                  rangeText={rangeLabel}
                  totalOrders={kpis.orders}
                  totalSales={kpis.sales}
                />
              </div>
            </section>
            <section className="card">
              <div className="card-h">
                <div className="grow">
                  <h2>{t('branchSalesTitle')}</h2>
                  <div className="muted sm" style={{ fontWeight: 600 }}>
                    {rangeLabel}
                  </div>
                </div>
              </div>
              <div className="card-b">
                <div className="hbars">
                  {charts.byBranch.map((b) => (
                    <div key={b.branchId} className="hbar-row">
                      <span className="strong sm">{b.name}</span>
                      <span className="hbar-track">
                        <span
                          className="hbar-fill"
                          style={{ width: `${b.pct}%`, background: b.color }}
                        />
                      </span>
                      <span className="num sm strong" style={{ textAlign: 'right' }}>
                        {b.salesLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-h">
              <div className="grow">
                <h2>{t('topTitle')}</h2>
                <div className="muted sm" style={{ fontWeight: 600 }}>
                  {t('topSub')}
                </div>
              </div>
            </div>
            <div className="card-b">
              <div className="hbars">
                {charts.top.map((p) => (
                  <div key={p.pos} className="hbar-row">
                    <span className="strong sm trunc">
                      {p.pos}. {p.name}
                    </span>
                    <span className="hbar-track">
                      <span className="hbar-fill" style={{ width: `${p.pct}%` }} />
                    </span>
                    <span className="num sm strong" style={{ textAlign: 'right' }}>
                      {t('topUnits', { count: p.quantity })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
