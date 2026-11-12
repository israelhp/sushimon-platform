'use client';

import { useTranslations } from 'next-intl';
import { IconEye } from '@/components/icons/bo';
import { StatusPill } from '@/components/ui/Pill';
import { branchShortName, useShell } from '@/features/backoffice-shell/shell-context';
import { formatTopbarDate } from '@/features/backoffice-shell/staff-display';
import { useOrderDetail } from '@/features/bo-orders/order-detail-context';
import { orderCode } from '@/features/bo-orders/order-view';
import { LOGISTICS_TONE, useOrderText } from '@/features/bo-orders/use-order-text';
import { formatMoney } from '@/lib/format';
import { fromLocal } from '@/lib/time';
import { isCancelledRow, type DeliveryRow } from '../deliveries-view';
import { useDeliveryText } from '../use-delivery-text';

const MONO = 'ui-monospace, Menlo, Consolas, monospace';

/** Tabla de envíos (`cols-del`): una fila por pedido a domicilio con su seguimiento logístico simulado. */
export function DeliveriesTable({ rows, today }: { rows: readonly DeliveryRow[]; today: string }) {
  const t = useTranslations('backoffice.deliveries.table');
  return (
    <div className="tscroll">
      <div className="min-del">
        <div className="thead cols-del">
          <span>{t('order')}</span>
          <span>{t('date')}</span>
          <span>{t('client')}</span>
          <span>{t('branch')}</span>
          <span>{t('status')}</span>
          <span>{t('rider')}</span>
          <span>{t('time')}</span>
          <span>{t('money')}</span>
          <span />
        </div>
        {rows.map((row) => (
          <DeliveryRowView key={row.id} row={row} today={today} />
        ))}
        {rows.length === 0 ? (
          <div className="empty">
            <div className="empty-t">{t('emptyTitle')}</div>
            <div className="sm">{t('emptyText')}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeliveryRowView({ row, today }: { row: DeliveryRow; today: string }) {
  const t = useTranslations('backoffice.deliveries.table');
  const { branchById } = useShell();
  const detail = useOrderDetail();
  const text = useDeliveryText();
  const orderText = useOrderText();
  const { order } = row;
  const cancelled = isCancelledRow(row);
  const code = orderCode(order);
  const open = () =>
    detail.open(order.id, row.dateISO === today ? undefined : { day: row.dateISO });

  const riderSub = row.provider === 'own' ? t('ownRider') : (order.delivery?.reference ?? '');
  const money =
    row.cost != null ? formatMoney(row.cost) : row.provider === 'own' ? t('noExtraCost') : '—';
  const durationLabel =
    row.duration != null
      ? t('minutes', { minutes: row.duration })
      : row.live
        ? t('live', { minutes: row.elapsed })
        : '—';

  return (
    <div className="trow cols-del">
      <button type="button" className="tid" onClick={open}>
        {code}
      </button>
      <div>
        <div className="cell-main">
          {row.dateISO === today ? t('today') : formatTopbarDate(fromLocal(row.dateISO, '12:00'))}
        </div>
        <div className="cell-sub num">{row.time}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="cell-main trunc">{order.customer.name}</div>
        <div className="cell-sub trunc">
          {text.zoneLabel(row.zoneNumber, row.municipality)} · {order.address?.line ?? '—'}
        </div>
      </div>
      <div className="hide-sm">
        <span className="btag">{branchShortName(branchById(order.branchId), order.branchId)}</span>
      </div>
      <div>
        <StatusPill zone="bo" tone={cancelled ? 'muted' : LOGISTICS_TONE[row.logistics]}>
          {cancelled ? t('cancelled') : orderText.logisticsLabel(order)}
        </StatusPill>
      </div>
      <div className="hide-sm">
        <div className="cell-main sm">{row.riderName ?? (cancelled ? '—' : t('noRider'))}</div>
        <div className="cell-sub" style={{ fontFamily: MONO }}>
          {riderSub}
        </div>
      </div>
      <div className="num sm hide-sm" style={{ fontWeight: 700 }}>
        {durationLabel}
      </div>
      <div className="hide-sm">
        <div className="num cell-main sm">
          {formatMoney(order.deliveryFee)} / {money}
        </div>
        {row.diff ? (
          <span className="wait">
            {row.diff > 0 ? '+' : ''}
            {formatMoney(row.diff)}
          </span>
        ) : null}
      </div>
      <div className="row-actions">
        <button type="button" className="icon-btn" aria-label={t('view', { code })} onClick={open}>
          <IconEye size="sm" />
        </button>
      </div>
    </div>
  );
}
