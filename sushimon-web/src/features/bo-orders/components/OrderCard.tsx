'use client';

import { branchShortName, useShell } from '@/features/backoffice-shell/shell-context';
import { cn } from '@/lib/cn';
import type { AdminOrderSummary } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { localTime } from '@/lib/time';
import { useTranslations } from 'next-intl';
import { LATE_MINUTES, isLatePending } from '../admin-orders-model';
import { useOrderDetail } from '../order-detail-context';
import { useAdminOrderText } from '../use-admin-order-text';
import { DispatchNotice, PrimaryActionButton } from './ActionButton';
import { PaymentBadge } from './PaymentBadge';

/** Tarjeta del tablero (`kcard`): abre el detalle y ofrece la acción de avance que el servidor permite a esta persona. */
export function OrderCard({
  order,
  serverNow,
  fresh,
  oldest,
}: {
  order: AdminOrderSummary;
  serverNow: number | null;
  /** Llegó en el último sondeo y la persona aún no interactúa. */
  fresh: boolean;
  /** Es el `pending` más antiguo (espera mayor). */
  oldest: boolean;
}) {
  const t = useTranslations('backoffice.orders');
  const tl = useTranslations('backoffice.orders.live');
  const { branchById } = useShell();
  const detail = useOrderDetail();
  const text = useAdminOrderText();
  const late = serverNow !== null && isLatePending(order, serverNow);
  const code = `#${order.displayNumber}`;

  return (
    <div
      className={cn(
        'kcard',
        order.status === 'pending' && 'new',
        fresh && 'fresh',
        oldest && 'oldest',
      )}
      data-fresh={fresh || undefined}
    >
      <button
        type="button"
        className="kcard-main"
        title={t('table.detail', { code })}
        onClick={() => detail.open(order.id)}
      >
        <span className="row gap8" style={{ width: '100%' }}>
          <b className="num" style={{ fontSize: 15 }}>
            {code}
          </b>
          <span className="xs muted" style={{ fontWeight: 700 }}>
            {localTime(new Date(order.placedAt))}
          </span>
          <span className="spacer" />
          <span className={late ? 'late' : 'wait'}>{text.waitText(order.placedAt, serverNow)}</span>
        </span>
        {fresh || oldest || late ? (
          <span className="row gap6 wrap">
            {fresh ? <span className="zone-tag">{tl('card.fresh')}</span> : null}
            {oldest ? <span className="zone-tag">{tl('card.oldest')}</span> : null}
            {late ? (
              <span className="late">{tl('drawer.late', { minutes: LATE_MINUTES })}</span>
            ) : null}
          </span>
        ) : null}
        <span className="strong trunc" style={{ display: 'block', maxWidth: '100%', fontSize: 15 }}>
          {order.customerName}
        </span>
        <span className="row gap6 wrap" style={{ width: '100%' }}>
          <span className="zone-tag">{text.typeLabel(order)}</span>
          <span className="btag">
            {branchShortName(branchById(order.branchId), order.branchName)}
          </span>
          <span className="sm" style={{ fontWeight: 600 }}>
            {text.itemsLabel(order.itemCount)}
          </span>
          <PaymentBadge status={order.paymentStatus} />
          <span className="spacer" />
          <b className="num">{formatMoney(Number(order.total))}</b>
        </span>
      </button>
      <PrimaryActionButton order={order} block />
      <DispatchNotice order={order} compact />
    </div>
  );
}
