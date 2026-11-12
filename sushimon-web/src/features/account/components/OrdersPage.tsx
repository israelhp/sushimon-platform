'use client';

import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import type { Order } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { isOrderInProgress } from '@/lib/order-status';
import { OrderCard } from '@/features/orders/components/order-card';
import { ReorderDialog } from '@/features/orders/components/reorder-dialog';
import { useDemoSession } from '@/features/session/demo-session';
import { useOrderSheet } from '@/features/store-shell/store-shell-context';
import { DEMO_CUSTOMER } from '@/mocks/fixtures/orders';
import { useMyOrders } from '../hooks';
import { AccountSection } from './AccountSection';

const money = (value: number) => formatMoney(value, 'es');

type Tab = 'active' | 'history';
const TABS: readonly Tab[] = ['active', 'history'];

/** Pedidos de la cuenta: resumen, pestañas "en curso / historial", detalle y "Pedir de nuevo". */
export function OrdersPage() {
  const t = useTranslations('account');
  const tHub = useTranslations('hub');
  const { customer } = useDemoSession();
  const sheet = useOrderSheet();
  const orders = useMyOrders();
  const [tab, setTab] = useState<Tab>('active');
  const [reorder, setReorder] = useState<Order | null>(null);

  const all = orders.data ?? [];
  const sorted = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = sorted.filter(isOrderInProgress);
  const history = sorted.filter((o) => !isOrderInProgress(o));
  const shown = tab === 'active' ? active : history;
  const spent = all.reduce((sum, o) => sum + o.total, 0);
  const counts: Record<Tab, number> = { active: active.length, history: history.length };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length]!;
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  };

  return (
    <AccountSection title={tHub('orders')} query={orders}>
      <dl className="m-0 grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-4 text-[13px] shadow-card">
        <div>
          <dt className="text-muted">{t('myOrders')}</dt>
          <dd className="m-0 font-display text-[20px]">{all.length}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('spent')}</dt>
          <dd className="m-0 font-display text-[20px]">{money(spent)}</dd>
        </div>
      </dl>

      <div
        role="tablist"
        aria-label={t('myOrders')}
        className="mt-4 grid grid-cols-2 rounded-full border border-line bg-surface p-1"
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls="orders-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={onKeyDown}
            className={cn(
              'inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full text-[14px] font-extrabold',
              tab === id ? 'bg-secondary text-onsecondary' : 'text-muted hover:text-fg',
            )}
          >
            {t(id)}
            <span
              className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px]',
                tab === id ? 'bg-white/20' : 'bg-subtle',
              )}
            >
              {counts[id]}
            </span>
          </button>
        ))}
      </div>

      <div
        id="orders-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="mt-3 flex flex-col gap-2.5"
      >
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-5 py-8 text-center">
            <p className="m-0 font-bold text-muted">
              {tab === 'active' ? t('noActive') : t('noHistory')}
            </p>
            <button
              type="button"
              onClick={() => sheet.open('now')}
              className="btn btn-primary !min-h-[44px]"
            >
              {t('startOrder')}
            </button>
          </div>
        ) : (
          shown.map((order) => (
            <OrderCard key={order.id} order={order} onReorder={() => setReorder(order)} />
          ))
        )}
      </div>

      {customer?.email === DEMO_CUSTOMER.email ? (
        <p className="m-0 mt-4 text-center text-[12px] text-muted">{t('demoData')}</p>
      ) : null}

      {reorder ? (
        <ReorderDialog
          order={{ id: reorder.id, total: reorder.total, lines: reorder.lines }}
          onClose={() => setReorder(null)}
        />
      ) : null}
    </AccountSection>
  );
}
