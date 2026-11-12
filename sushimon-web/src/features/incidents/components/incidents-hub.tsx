'use client';

import { LifeBuoy, PackageSearch, Store, Truck } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDateTime, formatMoney } from '@/lib/format';
import { OrderStatusChip } from '@/features/orders/components/order-status-chip';
import { useDemoSession } from '@/features/session/demo-session';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { GoogleLogo } from '@/features/store-shell/components/GoogleLogo';
import { useAuthModal } from '@/features/store-shell/store-shell-context';
import { useIncidentOrders } from '@/features/tracking/hooks';
import { arrangeIncidentOrders, openIncidents } from '../orders';
import { WhatsappReportButton } from './whatsapp-report-button';

/**
 * "Hacer un reclamo" (como el prototipo): elige uno de tus últimos pedidos y te lleva a WhatsApp con sus
 * datos ya escritos; si no aparece, inicia sesión, búscalo con número + teléfono o escribe por WhatsApp.
 * `highlightId` (`?pedido=`) destaca el pedido recién consultado.
 */
export function IncidentsHub({ highlightId = null }: { highlightId?: string | null }) {
  const t = useTranslations('incidents');
  const to = useTranslations('orders');
  const tu = useTranslations('ui');
  const locale = useLocale();
  const { customer } = useDemoSession();
  const auth = useAuthModal();
  const source = useIncidentOrders();
  const orders = arrangeIncidentOrders(source.orders, highlightId);

  return (
    <div className="wrap max-w-[720px] pb-12 pt-5 sm:pt-8">
      <h1 className="disp mb-1 text-[clamp(30px,6vw,48px)]">
        {t('waTitle')}{' '}
        <span
          className="ml-1 align-middle font-jp text-[0.4em] tracking-[0.2em] text-primary"
          lang="ja"
        >
          {t('jp')}
        </span>
      </h1>
      <p className="m-0 mb-5 text-muted">{t('waIntro')}</p>

      {source.isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={tu('loading')}
          className="flex flex-col gap-2.5"
        >
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-36 w-full rounded-2xl" />
        </div>
      ) : source.isError ? (
        <ErrorNotice onRetry={source.refetch} />
      ) : orders.length > 0 ? (
        <section aria-labelledby="inc-recent">
          <h2 id="inc-recent" className="eyebrow mb-2 text-secondary">
            {t('waRecent')}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {orders.map((order) => {
              const open = openIncidents(order).length;
              const Icon = order.fulfillment === 'delivery' ? Truck : Store;
              return (
                <li
                  key={order.id}
                  className={cn(
                    'overflow-hidden rounded-2xl border bg-surface shadow-card',
                    order.id === highlightId
                      ? 'border-secondary/50 ring-1 ring-secondary/30'
                      : 'border-line',
                  )}
                >
                  <Link
                    href={`/pedidos/${order.id}`}
                    className="flex items-start gap-3 p-3.5 text-fg no-underline hover:bg-subtle sm:p-4"
                  >
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-subtle text-secondary">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-extrabold">{order.id}</span>
                        <span className="font-display text-[17px]">
                          {formatMoney(order.total, locale)}
                        </span>
                      </span>
                      <span className="block text-[13px] text-muted">
                        {formatDateTime(order.createdAt, locale)}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-snug">
                        {order.lines.map((l) => `${l.quantity}× ${l.name}`).join(' · ')}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-1.5">
                        <OrderStatusChip order={order} />
                        {open > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-secondary-soft px-2.5 py-1 text-[12px] font-extrabold text-secondary">
                            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />{' '}
                            {to('incidentsCount', { a: open })}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Link>
                  <div className="border-t border-line p-2.5">
                    <WhatsappReportButton order={order} className="w-full !min-h-[46px]" />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="m-0 mt-2 text-center text-[12px] text-muted">{t('waOpens')}</p>
        </section>
      ) : (
        <p className="m-0 rounded-2xl border border-dashed border-line px-4 py-6 text-center font-bold text-muted">
          {t('waEmpty')}
        </p>
      )}

      <section
        aria-labelledby="inc-other"
        className="mt-6 rounded-2xl border border-line bg-surface p-4 shadow-card"
      >
        <h2 id="inc-other" className="m-0 mb-3 font-extrabold">
          {t('waNotListed')}
        </h2>
        <div className="flex flex-col gap-2">
          {!customer ? (
            <button type="button" onClick={auth.open} className="btn w-full !justify-start">
              <GoogleLogo /> {t('waSignIn')}
            </button>
          ) : null}
          <Link
            href="/consultar?next=incidencia"
            className="btn w-full !justify-start no-underline"
          >
            <PackageSearch className="h-5 w-5" aria-hidden="true" /> {t('waTrack')}
          </Link>
          <WhatsappReportButton
            order={null}
            label={t('waGeneric')}
            variant="outline"
            className="w-full !justify-start"
          />
        </div>
      </section>
    </div>
  );
}
