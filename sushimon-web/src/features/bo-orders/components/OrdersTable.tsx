'use client';

import { useTranslations } from 'next-intl';
import { IconEye } from '@/components/icons/bo';
import { StatusPill } from '@/components/ui/Pill';
import { branchShortName, useShell } from '@/features/backoffice-shell/shell-context';
import { cn } from '@/lib/cn';
import type { DraftOrder } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { toBackofficeColumn } from '@/lib/order-status';
import { useOrderDetail } from '../order-detail-context';
import { itemCount, nextAction, orderCode, orderTime } from '../order-view';
import { useOrderActions } from '../use-order-actions';
import { ACTION_CLASS, COLUMN_TONE, useOrderText } from '../use-order-text';

/** Tabla de pedidos (`cols-orders`): una fila por pedido con su siguiente acción y el botón de detalle. */
export function OrdersTable({ orders }: { orders: readonly DraftOrder[] }) {
  const t = useTranslations('backoffice.orders.table');
  return (
    <div className="tscroll">
      <div className="min-orders">
        <div className="thead cols-orders">
          <span>{t('order')}</span>
          <span>{t('client')}</span>
          <span>{t('date')}</span>
          <span>{t('branch')}</span>
          <span>{t('items')}</span>
          <span>{t('total')}</span>
          <span>{t('status')}</span>
          <span style={{ textAlign: 'right' }}>{t('actions')}</span>
        </div>
        {orders.map((order) => (
          <OrderRow key={order.id} order={order} />
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

function OrderRow({ order }: { order: DraftOrder }) {
  const t = useTranslations('backoffice.orders');
  const { grants, branchById } = useShell();
  const detail = useOrderDetail();
  const text = useOrderText();
  const actions = useOrderActions();
  const action = nextAction(order, grants);
  const column = toBackofficeColumn(order);

  return (
    <div className={cn('trow cols-orders', order.status === 'received' && 'hl')}>
      <button type="button" className="tid" onClick={() => detail.open(order.id)}>
        {orderCode(order)}
      </button>
      <div>
        <div className="cell-main trunc">{order.customer.name}</div>
        <div className="cell-sub">{text.typeLong(order)}</div>
      </div>
      <div className="hide-sm">
        <div className="cell-main">{t('drawer.today')}</div>
        <div className="cell-sub num">{orderTime(order)}</div>
      </div>
      <div className="hide-sm">
        <span className="btag">{branchShortName(branchById(order.branchId), order.branchId)}</span>
      </div>
      <div className="num hide-sm" style={{ fontWeight: 700 }}>
        {itemCount(order)}
      </div>
      <div className="num strong">{formatMoney(order.total)}</div>
      <div>
        <StatusPill zone="bo" tone={COLUMN_TONE[column]}>
          {text.statusLabel(order)}
        </StatusPill>
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
          aria-label={t('table.detail', { code: orderCode(order) })}
          onClick={() => detail.open(order.id)}
        >
          <IconEye />
        </button>
      </div>
    </div>
  );
}
