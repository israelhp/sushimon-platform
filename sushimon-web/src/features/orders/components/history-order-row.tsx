'use client';

import { Activity, ChevronRight, FileText, RotateCcw, Store, Truck } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { moneyToCents } from '@/lib/checkout-quote';
import type { MyOrderSummary } from '@/lib/data-access/models';
import { formatDateTime, formatMoney } from '@/lib/format';
import { rowActions } from '../history/history-model';
import { PublicStatusChip } from './public-status-chip';

const ACTION =
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 px-3 text-[14px] font-extrabold no-underline';

/**
 * F23 — Fila del historial (`MyOrderSummary`): solo columnas mínimas (sin líneas, dirección, contacto ni notas). El estado va con
 * ícono y texto; la fecha en America/Guatemala; el total tal cual lo entrega el servidor (cadena de 2 decimales → `Q 165.00`).
 * Acciones: «Seguimiento» solo si no es terminal, detalle, recibo y «Volver a pedir». Jamás pinta un motivo interno.
 */
export function HistoryOrderRow({
  order,
  onReorder,
}: {
  order: MyOrderSummary;
  onReorder: (order: MyOrderSummary) => void;
}) {
  const t = useTranslations('orders');
  const th = useTranslations('orders.history');
  const locale = useLocale();
  const actions = rowActions(order);
  const delivery = order.fulfillmentType === 'DELIVERY';
  const Icon = delivery ? Truck : Store;
  const total = formatMoney((moneyToCents(order.total) ?? 0) / 100, locale);

  return (
    <article
      className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
      data-testid="history-row"
    >
      <div className="flex items-start gap-3 p-3.5 sm:p-4">
        <span
          className={cn(
            'flex h-11 w-11 flex-none items-center justify-center rounded-xl',
            order.terminal ? 'bg-subtle text-secondary' : 'bg-primary text-onprimary',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h3 className="m-0 text-[16px] font-extrabold" data-testid="history-number">
              {order.displayNumber}
            </h3>
            <p className="m-0 text-right">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">
                {th('total')}
              </span>
              <span className="font-display text-[17px]">{total}</span>
            </p>
          </div>
          <p className="m-0 text-[13px] text-muted">
            {formatDateTime(order.placedAt, locale)} · {order.branchName} ·{' '}
            {t('items', { a: order.itemCount })}
          </p>
          <p className="m-0 mt-0.5 text-[13px] text-muted">
            {delivery ? th('delivery') : th('pickup')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PublicStatusChip
              publicStatus={order.publicStatus}
              fulfillmentType={order.fulfillmentType}
              terminal={order.terminal}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap border-t border-line">
        {actions.tracking ? (
          <Link
            href={`/pedidos/${order.id}/seguimiento`}
            aria-label={`${th('tracking')}: ${order.displayNumber}`}
            className={cn(ACTION, 'text-primary hover:bg-primary-soft')}
          >
            <Activity className="h-4 w-4" aria-hidden="true" /> {th('tracking')}
          </Link>
        ) : null}
        <Link
          href={`/pedidos/${order.id}`}
          aria-label={`${t('view')}: ${order.displayNumber}`}
          className={cn(ACTION, 'text-fg hover:bg-subtle')}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" /> {t('view')}
        </Link>
        <Link
          href={`/pedidos/${order.id}/recibo`}
          aria-label={`${th('receipt')}: ${order.displayNumber}`}
          className={cn(ACTION, 'text-fg hover:bg-subtle')}
        >
          <FileText className="h-4 w-4" aria-hidden="true" /> {th('receipt')}
        </Link>
        <button
          type="button"
          onClick={() => onReorder(order)}
          aria-label={`${t('again')}: ${order.displayNumber}`}
          className={cn(ACTION, 'text-primary hover:bg-primary-soft')}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t('again')}
        </button>
      </div>
    </article>
  );
}
