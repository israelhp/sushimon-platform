'use client';

import { useTranslations } from 'next-intl';
import { StatusPill } from '@/components/ui/Pill';
import { Drawer } from '@/components/ui/Drawer';
import { initials, orderCode } from '@/features/bo-orders/order-view';
import { COLUMN_TONE, useOrderText } from '@/features/bo-orders/use-order-text';
import { branchShortName, useShell } from '@/features/backoffice-shell/shell-context';
import type { Order } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { toBackofficeColumn } from '@/lib/order-status';
import { dayLong } from '../format';
import { orderClock, orderDay } from '../reports-view';

/**
 * Detalle SOLO LECTURA de un pedido del historial. El drawer operativo (`OrderDrawer`) trabaja con los pedidos de hoy
 * y sus acciones; el historial incluye días anteriores, que no se pueden operar.
 */
export function HistoryOrderDrawer({ order, onClose }: { order: Order; onClose: () => void }) {
  const t = useTranslations('backoffice.reports.history');
  const td = useTranslations('backoffice.orders.drawer');
  const text = useOrderText();
  const { branchById } = useShell();
  const branch = branchById(order.branchId);
  const isDelivery = order.fulfillment === 'delivery';

  return (
    <Drawer
      open
      zone="bo"
      title={orderCode(order)}
      eyebrow={`${dayLong(orderDay(order))} · ${orderClock(order)}`}
      headerExtra={
        <div className="row gap8 wrap">
          <StatusPill zone="bo" tone={COLUMN_TONE[toBackofficeColumn(order)]}>
            {text.statusLabel(order)}
          </StatusPill>
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('drawerNote')}
          </span>
        </div>
      }
      onClose={onClose}
    >
      <section>
        <div className="sect-t">{td('customer')}</div>
        <div className="info-card">
          <div
            className="avatar"
            style={{ background: 'var(--bo-muted)', color: 'var(--bo-on-primary)' }}
          >
            {initials(order.customer.name)}
          </div>
          <div className="grow">
            <div className="strong">{order.customer.name}</div>
            <div className="muted sm num" style={{ fontWeight: 600 }}>
              {order.customer.phone}
            </div>
          </div>
        </div>
      </section>
      <section>
        <div className="info-list">
          <div className="info-row">
            <div className="grow">
              <div className="strong">{t('drawerBranch')}</div>
              <div className="muted sm" style={{ fontWeight: 600 }}>
                {branch ? `${branch.name} · ${branchShortName(branch)}` : order.branchId}
              </div>
            </div>
            <span className="zone-tag">{text.typeShort(order)}</span>
          </div>
          {order.status === 'rejected' || order.status === 'cancelled' ? (
            <div className="info-row">
              <div className="grow">
                <div className="strong">{t('drawerReason')}</div>
                <div className="muted sm" style={{ fontWeight: 600 }}>
                  {order.rejectionReason ?? '—'}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
      <section>
        <div className="sect-t">{td('products')}</div>
        <div className="items">
          {order.lines.map((line, i) => (
            <div key={`${line.productId}-${i}`} className="item">
              <span className="qty">{line.quantity}×</span>
              <span className="grow">{line.name}</span>
              <span className="num">{formatMoney(line.subtotal)}</span>
            </div>
          ))}
        </div>
        <div className="totals">
          <div className="tline">
            <span>{td('subtotal')}</span>
            <span className="num">{formatMoney(order.subtotal)}</span>
          </div>
          {order.discount > 0 ? (
            <div className="tline">
              <span>{td('discount')}</span>
              <span className="num">-{formatMoney(order.discount)}</span>
            </div>
          ) : null}
          {isDelivery ? (
            <div className="tline">
              <span>{td('shipping')}</span>
              <span className="num">{formatMoney(order.deliveryFee)}</span>
            </div>
          ) : null}
          <div className="tline total">
            <span>{td('total')}</span>
            <span className="num">{formatMoney(order.total)}</span>
          </div>
        </div>
      </section>
    </Drawer>
  );
}
