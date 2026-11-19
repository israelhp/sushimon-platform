'use client';

import { useTranslations } from 'next-intl';
import { IconEye } from '@/components/icons/bo';
import { StatusPill } from '@/components/ui/Pill';
import { branchShortName, useShell } from '@/features/backoffice-shell/shell-context';
import { cn } from '@/lib/cn';
import type { AdminOrderSummary } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { localDate, localTime } from '@/lib/time';
import { useOrderDetail } from '../order-detail-context';
import { STATUS_TONE, useAdminOrderText } from '../use-admin-order-text';
import { PaymentBadge } from './PaymentBadge';
import { PrimaryActionButton } from './ActionButton';

/** Tabla de pedidos reales (`cols-orders`): el servidor ya los ordena y filtra; aquí no se reordena nada. */
export function OrdersTable({
  orders,
  today,
  fresh,
}: {
  orders: readonly AdminOrderSummary[];
  /** `YYYY-MM-DD` de hoy en America/Guatemala (según el servidor) para rotular «Hoy». */
  today: string | null;
  fresh: ReadonlySet<string>;
}) {
  const t = useTranslations('backoffice.orders.table');
  return (
    <div className="tscroll">
      <div className="min-orders" role="table" aria-label={t('label')}>
        <div className="thead cols-orders" role="row">
          <span role="columnheader">{t('order')}</span>
          <span role="columnheader">{t('client')}</span>
          <span role="columnheader">{t('date')}</span>
          <span role="columnheader">{t('branch')}</span>
          <span role="columnheader">{t('items')}</span>
          <span role="columnheader">{t('total')}</span>
          <span role="columnheader">{t('status')}</span>
          <span role="columnheader" style={{ textAlign: 'right' }}>
            {t('actions')}
          </span>
        </div>
        {orders.map((order) => (
          <OrderRow key={order.id} order={order} today={today} fresh={fresh.has(order.id)} />
        ))}
        {orders.length === 0 ? (
          <div className="empty">
            <div className="empty-t">{t('emptyTitle')}</div>
            <div className="sm">{t('emptyText')}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OrderRow({
  order,
  today,
  fresh,
}: {
  order: AdminOrderSummary;
  today: string | null;
  fresh: boolean;
}) {
  const t = useTranslations('backoffice.orders');
  const { branchById } = useShell();
  const detail = useOrderDetail();
  const text = useAdminOrderText();
  const code = `#${order.displayNumber}`;
  const placed = new Date(order.placedAt);
  const day = localDate(placed);

  return (
    <div
      role="row"
      className={cn('trow cols-orders', (order.status === 'pending' || fresh) && 'hl')}
    >
      <div role="cell">
        <button type="button" className="tid" onClick={() => detail.open(order.id)}>
          {code}
        </button>
      </div>
      <div role="cell">
        <div className="cell-main trunc">{order.customerName}</div>
        <div className="cell-sub">{text.typeLabel(order, true)}</div>
      </div>
      <div role="cell" className="hide-sm">
        <div className="cell-main">{day === today ? t('drawer.today') : day}</div>
        <div className="cell-sub num">{localTime(placed)}</div>
      </div>
      <div role="cell" className="hide-sm">
        <span className="btag">
          {branchShortName(branchById(order.branchId), order.branchName)}
        </span>
      </div>
      <div role="cell" className="num hide-sm" style={{ fontWeight: 700 }}>
        {order.itemCount}
      </div>
      <div role="cell" className="num strong">
        {formatMoney(Number(order.total))}
      </div>
      <div role="cell">
        <StatusPill zone="bo" tone={STATUS_TONE[order.status]}>
          {text.statusLabel(order.status)}
        </StatusPill>
        <div style={{ marginTop: 4 }}>
          <PaymentBadge status={order.paymentStatus} />
        </div>
      </div>
      <div role="cell" className="row-actions">
        <PrimaryActionButton order={order} short />
        <button
          type="button"
          className="icon-btn"
          aria-label={t('table.detail', { code })}
          onClick={() => detail.open(order.id)}
        >
          <IconEye />
        </button>
      </div>
    </div>
  );
}
