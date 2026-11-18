'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { IconAlert, IconArrowRight, IconBike, IconCheck, IconEye } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Kpi } from '@/components/ui/Kpi';
import { StatusPill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useDashboard } from '@/features/backoffice/hooks';
import { useBranchesAvailability } from '@/features/branch-schedule/hooks';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { screenHref } from '@/features/backoffice-shell/nav';
import { branchShortName, useShell } from '@/features/backoffice-shell/shell-context';
import { formatLongDate, greetingKey } from '@/features/backoffice-shell/staff-display';
import { useNow } from '@/features/backoffice-shell/use-now';
import { isForbidden } from '@/features/bo-orders/error-message';
import { useOrderDetail } from '@/features/bo-orders/order-detail-context';
import { nextAction, orderCode, orderTime } from '@/features/bo-orders/order-view';
import { useDispatchModal } from '@/features/bo-orders/use-dispatch-modal';
import { useOrderActions } from '@/features/bo-orders/use-order-actions';
import { ACTION_CLASS, COLUMN_TONE, useOrderText } from '@/features/bo-orders/use-order-text';
import { ORDERS_REFRESH_MS, useScopedOrders } from '@/features/bo-orders/use-scoped-orders';
import { useDemoSession } from '@/features/session/demo-session';
import { cn } from '@/lib/cn';
import type { DashboardAlert, DraftOrder } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { toBackofficeColumn } from '@/lib/order-status';
import type { BackofficeScreen } from '@/lib/permissions';
import { localMinutes } from '@/lib/time';
import { alertTone, latestOrders } from '../dashboard-view';

/** Panel: KPIs del día, resumen por sucursal, últimos pedidos y alertas. */
export function DashboardScreen() {
  const t = useTranslations('backoffice.panel');
  const router = useRouter();
  const shell = useShell();
  const { staff } = useDemoSession();
  const now = useNow();
  const dashboard = useDashboard(shell.branchId, { refetchInterval: ORDERS_REFRESH_MS });
  const orders = useScopedOrders();

  if (isForbidden(dashboard.error)) return <ForbiddenScreen reason="server" />;

  const branch = shell.branchId ? shell.branchById(shell.branchId) : undefined;
  const scopeLabel = !shell.branchId
    ? t('scopeAll')
    : branch
      ? `${branch.name} · ${branch.zoneLabel}`
      : '';
  const firstName = staff?.name.split(' ')[0] ?? '';
  const greeting = now
    ? t(greetingKey(Math.floor(localMinutes(now) / 60)), { name: firstName })
    : ' ';
  const go = (screen: BackofficeScreen) =>
    shell.canSee(screen) ? () => router.push(screenHref(screen)) : undefined;
  const data = dashboard.data;

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <h1>{greeting}</h1>
          <div className="page-sub">{now ? `${formatLongDate(now)} · ${scopeLabel}` : ' '}</div>
        </div>
        <Link className="btn btn-primary" href={screenHref('pedidos')}>
          {t('openBoard')}
          <IconArrowRight />
        </Link>
      </div>

      {dashboard.isError ? (
        <ErrorBanner message={t('error')} onRetry={() => void dashboard.refetch()} />
      ) : null}

      <div className="kpis" aria-busy={dashboard.isPending}>
        {data ? (
          <>
            <Kpi
              label={t('kpis.received')}
              value={data.received}
              foot={t('kpis.receivedFoot', { count: data.newPending })}
              tone="coral"
              onClick={go('pedidos')}
            />
            <Kpi
              label={t('kpis.preparing')}
              value={data.inPreparation}
              foot={t('kpis.preparingFoot', { count: data.readyForDispatch })}
              tone="amber"
              onClick={go('pedidos')}
            />
            <Kpi
              label={t('kpis.onTheWay')}
              value={data.onTheWay}
              foot={t('kpis.onTheWayFoot')}
              tone="blue"
              onClick={go('entregas')}
            />
            <Kpi
              label={t('kpis.delivered')}
              value={data.delivered}
              foot={t('kpis.deliveredFoot')}
              tone="green"
              onClick={go('pedidos')}
            />
            <Kpi
              label={t('kpis.cancelled')}
              value={data.cancelled}
              foot={t('kpis.cancelledFoot')}
              tone="neutral"
              onClick={go('pedidos')}
            />
            <Kpi
              highlight
              label={t('kpis.sales')}
              value={formatMoney(data.sales)}
              foot={t('kpis.salesFoot', {
                scope: shell.branchId
                  ? (branch?.name ?? '')
                  : t('kpis.scopeBranches', { count: shell.branches.length }),
              })}
              tone="coral"
              onClick={go('reportes')}
            />
          </>
        ) : (
          Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} zone="bo" style={{ height: 116, borderRadius: 16 }} />
          ))
        )}
      </div>

      <ByBranchCard data={data} />

      <div className="grid-main">
        <LatestOrders orders={orders.data} loading={orders.isPending} />
        <AlertsCard
          alerts={data?.alerts ?? []}
          orders={orders.data ?? []}
          loading={dashboard.isPending}
        />
      </div>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const tu = useTranslations('ui');
  return (
    <Banner zone="bo" tone="danger" role="alert">
      {message}{' '}
      <button type="button" className="link-btn" onClick={onRetry}>
        {tu('retry')}
      </button>
    </Banner>
  );
}

function ByBranchCard({ data }: { data: ReturnType<typeof useDashboard>['data'] }) {
  const t = useTranslations('backoffice.panel.byBranch');
  const shell = useShell();
  const max = Math.max(1, ...(data?.byBranch.map((b) => b.orders) ?? [1]));
  // F08: estado «abierta/cerrada» calculado por el servidor, no un booleano local.
  const availability = useBranchesAvailability((data?.byBranch ?? []).map((b) => b.branchId));
  return (
    <section className="card">
      <div className="card-h">
        <h2>{t('title')}</h2>
        <span className="spacer" />
        <span className="xs muted" style={{ fontWeight: 700 }}>
          {t('hint')}
        </span>
      </div>
      <div className="card-b">
        {(data?.byBranch ?? []).map((row) => {
          const branch = shell.branchById(row.branchId);
          return (
            <button
              key={row.branchId}
              type="button"
              className="byb"
              disabled={shell.branchLocked}
              onClick={() => shell.setBranchId(row.branchId)}
            >
              <span>
                <span className="strong trunc" style={{ display: 'block' }}>
                  {branch?.name ?? row.branchId}
                </span>
                <span className="xs muted" style={{ fontWeight: 700 }}>
                  {branch?.zoneLabel ?? ''}
                </span>
              </span>
              <span className="hbar-track hide-sm">
                <span
                  className="hbar-fill"
                  style={{ width: `${Math.round((row.orders / max) * 100)}%` }}
                />
              </span>
              <span className="num strong">{row.orders}</span>
              <span className="num sm hide-sm" style={{ fontWeight: 700 }}>
                {formatMoney(row.sales)}
              </span>
              <span className="hide-sm">
                {availability.byId[row.branchId] ? (
                  <StatusPill
                    zone="bo"
                    tone={availability.byId[row.branchId]?.isOpenNow ? 'success' : 'muted'}
                  >
                    {availability.byId[row.branchId]?.isOpenNow ? t('open') : t('closed')}
                  </StatusPill>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LatestOrders({
  orders,
  loading,
}: {
  orders: readonly DraftOrder[] | undefined;
  loading: boolean;
}) {
  const t = useTranslations('backoffice.panel.latest');
  const tp = useTranslations('backoffice.panel');
  const shell = useShell();
  const detail = useOrderDetail();
  const text = useOrderText();
  const actions = useOrderActions();
  const latest = latestOrders(orders ?? [], 6);

  return (
    <section className="card">
      <div className="card-h">
        <h2>{t('title')}</h2>
        <span className="spacer" />
        <Link className="btn sm" href={screenHref('pedidos')}>
          {t('viewAll')}
          <IconArrowRight />
        </Link>
      </div>
      <div className="tscroll">
        <div className="min-recent">
          <div className="thead cols-recent">
            <span>{t('order')}</span>
            <span>{t('client')}</span>
            <span>{t('type')}</span>
            <span>{t('total')}</span>
            <span>{t('status')}</span>
            <span>{t('time')}</span>
            <span style={{ textAlign: 'right' }}>{t('action')}</span>
          </div>
          {latest.map((order) => {
            const action = nextAction(order, shell.grants);
            return (
              <div
                key={order.id}
                className={cn('trow cols-recent', order.status === 'received' && 'hl')}
              >
                <button type="button" className="tid" onClick={() => detail.open(order.id)}>
                  {orderCode(order)}
                </button>
                <div>
                  <div className="cell-main trunc">{order.customer.name}</div>
                  <div className="cell-sub">
                    {branchShortName(shell.branchById(order.branchId), order.branchId)}
                  </div>
                </div>
                <div className="hide-sm">
                  <span className="zone-tag">{text.typeShort(order)}</span>
                </div>
                <div className="num strong">{formatMoney(order.total)}</div>
                <div>
                  <StatusPill zone="bo" tone={COLUMN_TONE[toBackofficeColumn(order)]}>
                    {text.statusLabel(order)}
                  </StatusPill>
                </div>
                <div className="num sm hide-sm" style={{ fontWeight: 600 }}>
                  {orderTime(order)}
                </div>
                <div className="row-actions">
                  {action ? (
                    <button
                      type="button"
                      className={cn('btn sm', ACTION_CLASS[action])}
                      disabled={actions.pending}
                      onClick={() => actions.run(order, action)}
                    >
                      {text.actionLabel(action, true)}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('detail', { code: orderCode(order) })}
                    onClick={() => detail.open(order.id)}
                  >
                    <IconEye />
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && latest.length === 0 ? (
            <div className="empty">
              <div className="sm">{tp('empty')}</div>
            </div>
          ) : null}
          {loading ? <Skeleton zone="bo" style={{ height: 120, margin: 16 }} /> : null}
        </div>
      </div>
    </section>
  );
}

function AlertsCard({
  alerts,
  orders,
  loading,
}: {
  alerts: readonly DashboardAlert[];
  orders: readonly DraftOrder[];
  loading: boolean;
}) {
  const t = useTranslations('backoffice.panel.alerts');
  const shell = useShell();
  const detail = useOrderDetail();
  const dispatchModal = useDispatchModal();
  const canDispatch = shell.can('deliveries.assign');

  return (
    <section className="card">
      <div className="card-h">
        <h2>{t('title')}</h2>
        <span className="count-chip">{alerts.length}</span>
      </div>
      <div className="card-b">
        <div className="alerts">
          {alerts.map((alert, i) => {
            const order = orders.find((o) => o.id === alert.orderId);
            const code = `#${alert.orderId}`;
            const client = order?.customer.name ?? '';
            const branch = branchShortName(
              shell.branchById(order?.branchId ?? ''),
              order?.branchId ?? '',
            );
            const tone = alertTone(alert.type);
            const dispatchable = alert.type === 'no_rider' && canDispatch;
            return (
              <div key={`${alert.type}-${alert.orderId}-${i}`} className="alert">
                <span className={cn('al-ic', tone)}>
                  {alert.type === 'searching_rider' ? <IconBike /> : <IconAlert />}
                </span>
                <div className="grow">
                  <div className="strong" style={{ fontSize: 13.5 }}>
                    {alert.type === 'unaccepted'
                      ? t('unaccepted', { code })
                      : alert.type === 'no_rider'
                        ? t('noRider', { code })
                        : t('searching')}
                  </div>
                  <div className="muted sm">
                    {alert.type === 'unaccepted'
                      ? t('unacceptedText', { client, branch, minutes: alert.minutes })
                      : alert.type === 'no_rider'
                        ? t('noRiderText', { client, branch })
                        : t('searchingText', { code })}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    dispatchable ? dispatchModal.open(alert.orderId) : detail.open(alert.orderId)
                  }
                >
                  {dispatchable ? t('dispatch') : t('view')}
                </button>
              </div>
            );
          })}
          {!loading && alerts.length === 0 ? (
            <div className="alert">
              <span className="al-ic a-green">
                <IconCheck />
              </span>
              <div className="grow">
                <div className="strong">{t('allGood')}</div>
                <div className="muted sm">{t('allGoodText')}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
