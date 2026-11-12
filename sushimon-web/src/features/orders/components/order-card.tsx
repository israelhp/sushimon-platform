'use client';

import { ChevronRight, LifeBuoy, RotateCcw, Store, Truck } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { Order } from '@/lib/data-access/models';
import { cn } from '@/lib/cn';
import { formatDateTime, formatMoney } from '@/lib/format';
import { isOrderInProgress } from '@/lib/order-status';
import { OrderStatusChip } from './order-status-chip';

/** Incidencias abiertas (no resueltas) de un pedido. */
export const openIncidentCount = (order: Pick<Order, 'incidents'>) =>
  order.incidents.filter((i) => i.status !== 'resolved').length;

/**
 * Tarjeta de pedido (lista "Tus pedidos", "Tus pedidos en curso" de Consulta): número, total, fecha,
 * productos, estado, etiqueta NeoNet si es con tarjeta e incidencias abiertas. Todo el bloque enlaza al
 * seguimiento `/pedidos/[id]`; `onReorder` agrega el pie "Volver a pedir".
 */
export function OrderCard({ order, onReorder }: { order: Order; onReorder?: () => void }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const inProgress = isOrderInProgress(order);
  const units = order.lines.reduce((sum, l) => sum + l.quantity, 0);
  const open = openIncidentCount(order);
  const Icon = order.fulfillment === 'delivery' ? Truck : Store;

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:shadow-lift">
      <Link
        href={`/pedidos/${order.id}`}
        className="group flex items-start gap-3 p-3.5 text-fg no-underline sm:p-4"
        aria-label={`${t('order')} ${order.id}, ${t('view')}`}
      >
        <span
          className={cn(
            'flex h-11 w-11 flex-none items-center justify-center rounded-xl',
            inProgress ? 'bg-primary text-onprimary' : 'bg-subtle text-secondary',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="font-extrabold">{order.id}</span>
            <span className="text-right">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">
                {t('totalPaid')}
              </span>
              <span className="font-display text-[17px]">{formatMoney(order.total, locale)}</span>
            </span>
          </span>
          <span className="block text-[13px] text-muted">
            {formatDateTime(order.createdAt, locale)} · {t('items', { a: units })}
          </span>
          <span className="mt-1 block text-[13px] leading-snug">
            {order.lines.map((l) => `${l.quantity}× ${l.name}`).join(' · ')}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <OrderStatusChip order={order} />
            {order.payment.method === 'card' ? (
              <span className="rounded-full bg-subtle px-2.5 py-1 text-[12px] font-bold text-fg">
                NeoNet
              </span>
            ) : null}
            {open > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary-soft px-2.5 py-1 text-[12px] font-extrabold text-secondary">
                <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                {t('incidentsCount', { a: open })}
              </span>
            ) : null}
          </span>
        </span>
        <ChevronRight
          className="mt-3 h-5 w-5 flex-none text-muted transition group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
      {onReorder ? (
        <div className="flex border-t border-line">
          <button
            type="button"
            onClick={onReorder}
            aria-label={`${t('again')}: ${order.id}`}
            className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 text-[14px] font-extrabold text-primary hover:bg-primary-soft"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t('again')}
          </button>
        </div>
      ) : null}
    </article>
  );
}
