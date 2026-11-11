'use client';

import { ChevronRight, PackageSearch, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoney } from '@/lib/format';
import { isOrderInProgress } from '@/lib/order-status';
import { useMyOrders } from '@/features/account/hooks';
import { useProducts } from '@/features/catalog/hooks';
import { productName } from '@/features/catalog/localized';
import { OrderStatusChip } from '@/features/orders/components/order-status-chip';
import { ReorderDialog } from '@/features/orders/components/reorder-dialog';
import { useLastOrder } from '@/features/orders/last-order';
import { useDemoSession } from '@/features/session/demo-session';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';

/** Pedido en curso de la cuenta (con sesión de demostración): enlace al seguimiento `/pedidos/[id]`. */
export function ActiveOrderBanner() {
  const t = useTranslations('orders');
  const { customer } = useDemoSession();
  const mine = useMyOrders();
  if (!customer) return null;
  if (mine.isError) return <ErrorNotice onRetry={() => void mine.refetch()} />;
  const active = (mine.data ?? []).find((o) => isOrderInProgress(o));
  if (!active) return null;
  return (
    <Link
      href={`/pedidos/${active.id}`}
      className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary-soft px-3.5 py-3 text-fg no-underline shadow-card transition hover:shadow-lift"
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary text-onprimary">
        <PackageSearch className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-muted">
          {t('order')} {active.id}
        </span>
        <OrderStatusChip order={active} />
      </span>
      <ChevronRight className="h-5 w-5 flex-none text-muted" aria-hidden="true" />
    </Link>
  );
}

/** "Tu último pedido" con "Pedir de nuevo" (abre la revisión de precios/disponibilidad). */
export function LastOrderCard() {
  const t = useTranslations('home');
  const tu = useTranslations('ui');
  const locale = useLocale();
  const last = useLastOrder();
  const products = useProducts();
  const [reordering, setReordering] = useState(false);

  if (last.isPending) {
    return (
      <div
        aria-busy="true"
        aria-label={tu('loading')}
        className="rounded-2xl border border-line bg-surface p-4 shadow-card"
      >
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-32" />
        <Skeleton className="mt-3 h-4 w-3/4" />
      </div>
    );
  }
  if (last.isError) return <ErrorNotice onRetry={last.refetch} />;
  const order = last.order;
  if (!order) return null;

  const summary = order.lines
    .map((line) => {
      const product = products.data?.find((p) => p.id === line.productId);
      return `${line.quantity}× ${product ? productName(product, locale) : line.name}`;
    })
    .join(' · ');

  return (
    <section
      aria-labelledby="last-title"
      className="rounded-2xl border border-line bg-surface p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="last-title" className="disp text-[20px] sm:text-[24px]">
            {t('lastOrder')}
          </h2>
          <p className="text-[13px] text-muted">
            {order.id} · {formatMoney(order.total, locale, { decimals: 'auto' })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReordering(true)}
          className="btn btn-primary !min-h-[44px] flex-none !px-4 text-sm"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t('reorder')}
        </button>
      </div>
      <p className="mt-2 truncate text-[14px]">{summary}</p>
      {reordering ? <ReorderDialog order={order} onClose={() => setReordering(false)} /> : null}
    </section>
  );
}
