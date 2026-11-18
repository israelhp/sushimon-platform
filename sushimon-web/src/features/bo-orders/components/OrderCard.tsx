'use client';

import { useTranslations } from 'next-intl';
import { branchShortName, useShell } from '@/features/backoffice-shell/shell-context';
import { cn } from '@/lib/cn';
import type { DraftOrder } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { useOrderDetail } from '../order-detail-context';
import { isLate, nextAction, orderCode, orderTime } from '../order-view';
import { useOrderActions } from '../use-order-actions';
import { ACTION_CLASS, useOrderText } from '../use-order-text';

/** Tarjeta del tablero (`kcard`): abre el detalle y ofrece la siguiente acción del rol. */
export function OrderCard({ order, now }: { order: DraftOrder; now: Date | null }) {
  const t = useTranslations('backoffice.orders');
  const { grants, branchById } = useShell();
  const detail = useOrderDetail();
  const text = useOrderText();
  const actions = useOrderActions();
  const action = nextAction(order, grants);
  const late = isLate(order, now);
  const logistics = order.delivery !== null;

  return (
    <div className={cn('kcard', order.status === 'received' && 'new')}>
      <button
        type="button"
        className="kcard-main"
        title={t('table.detail', { code: orderCode(order) })}
        onClick={() => detail.open(order.id)}
      >
        <span className="row gap8" style={{ width: '100%' }}>
          <b className="num" style={{ fontSize: 15 }}>
            {orderCode(order)}
          </b>
          <span className="xs muted" style={{ fontWeight: 700 }}>
            {orderTime(order)}
          </span>
          <span className="spacer" />
          <span className={late ? 'late' : 'wait'}>{text.waitText(order, now)}</span>
        </span>
        <span className="strong trunc" style={{ display: 'block', maxWidth: '100%', fontSize: 15 }}>
          {order.customer.name}
        </span>
        <span className="row gap6 wrap" style={{ width: '100%' }}>
          <span className="zone-tag">{text.typeShort(order)}</span>
          <span className="btag">
            {branchShortName(branchById(order.branchId), order.branchId)}
          </span>
          <span className="sm" style={{ fontWeight: 600 }}>
            {text.itemsLabel(order)}
          </span>
          <span className="spacer" />
          <b className="num">{formatMoney(order.total)}</b>
        </span>
        {logistics ? (
          <span className="sm" style={{ fontWeight: 700, color: 'var(--bo-blue-text)' }}>
            {order.delivery?.provider === 'pedidosya'
              ? t('logistics', { label: text.logisticsLabel(order) })
              : text.logisticsLabel(order)}
          </span>
        ) : null}
      </button>
      {action ? (
        <button
          type="button"
          className={cn('btn sm block', ACTION_CLASS[action])}
          disabled={actions.pending}
          onClick={() => actions.run(order, action)}
        >
          {text.actionLabel(action)}
        </button>
      ) : null}
    </div>
  );
}
