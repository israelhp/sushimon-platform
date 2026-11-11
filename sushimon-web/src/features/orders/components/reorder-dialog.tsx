'use client';

import { Info, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { mergeIntoCart, planReorder } from '@/features/account/reorder';
import { useCart } from '@/features/cart/cart-context';
import { estimateSubtotal } from '@/features/cart/cart';
import { useProducts } from '@/features/catalog/hooks';
import { productName } from '@/features/catalog/localized';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { useCartDrawer } from '@/features/store-shell/store-shell-context';
import type { LastOrderSummary } from '../last-order';

const money = (value: number) => formatMoney(value, 'es', { decimals: 'auto' });

/**
 * "Pedir de nuevo": revisa el pedido anterior contra el menú de hoy (productos no disponibles y cambios
 * de precio), deja elegir reemplazar o agregar al carrito y abre el carrito para revisar. No crea ningún
 * pedido ni cobra nada: eso ocurre solo al confirmar en el checkout.
 */
export function ReorderDialog({
  order,
  onClose,
}: {
  order: LastOrderSummary;
  onClose: () => void;
}) {
  const t = useTranslations('reorder');
  const locale = useLocale();
  const { notify } = useToast();
  const cart = useCart();
  const cartDrawer = useCartDrawer();
  const products = useProducts();
  const [merge, setMerge] = useState<'replace' | 'append'>('replace');

  const plan = products.data ? planReorder(order, products.data) : null;
  const prices = Object.fromEntries((products.data ?? []).map((p) => [p.id, p.price]));
  const nameOf = (productId: string, fallback: string) => {
    const product = products.data?.find((p) => p.id === productId);
    return product ? productName(product, locale) : fallback;
  };
  const newSubtotal = plan ? estimateSubtotal(plan.lines, prices) : 0;

  const confirm = () => {
    if (!plan || plan.lines.length === 0) return;
    cart.replace(
      merge === 'append' && cart.lines.length > 0
        ? mergeIntoCart(cart.lines, plan.lines)
        : plan.lines,
    );
    notify(t('added'));
    onClose();
    cartDrawer.open();
  };

  return (
    <Modal
      open
      onClose={onClose}
      layer="top"
      title={t('title')}
      footer={
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={!plan || plan.lines.length === 0}
          onClick={confirm}
        >
          {t('confirm')}
        </button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <p className="m-0 text-[14px] font-bold text-muted">{t('from', { a: order.id })}</p>

        {products.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <p className="m-0 text-sm text-muted">{t('checking')}</p>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : products.isError || !plan ? (
          <ErrorNotice message={t('error')} onRetry={() => void products.refetch()} />
        ) : (
          <>
            {plan.lines.length === 0 ? (
              <div className="notice notice-warn" role="status">
                <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
                <div>{t('noneAvailable')}</div>
              </div>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0">
                {plan.lines.map((line) => (
                  <li
                    key={`${line.productId}|${line.note}`}
                    className="flex items-baseline justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5"
                  >
                    <span className="min-w-0 font-bold">
                      {line.quantity}× {nameOf(line.productId, line.productId)}
                      {line.note ? (
                        <span className="block truncate text-[12px] font-normal text-muted">
                          {line.note}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex-none text-sm text-muted">
                      {money((prices[line.productId] ?? 0) * line.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {plan.skippedCount > 0 ? (
              <div className="notice notice-warn" role="status">
                <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
                <div>
                  <p className="m-0 font-bold">{t('unavailable')}</p>
                  <p className="m-0">{t('unavailableNote', { a: plan.skippedCount })}</p>
                </div>
              </div>
            ) : null}

            {plan.priceChanges.map((c) => (
              <p key={c.productId} className="m-0 text-[13px] text-muted">
                {nameOf(c.productId, c.name)}:{' '}
                {t('priceChanged', { a: money(c.before), b: money(c.now) })}
              </p>
            ))}

            {plan.lines.length > 0 ? (
              <div className="rounded-2xl border border-line bg-surface p-3.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted">{t('originalTotal')}</span>
                  <span className="font-bold">{money(order.total)}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="font-bold">{t('currentSubtotal')}</span>
                  <strong className="font-display text-[22px]">{money(newSubtotal)}</strong>
                </div>
                <p className="m-0 mt-1 text-[12px] text-muted">{t('shippingNote')}</p>
              </div>
            ) : null}

            {cart.count > 0 && plan.lines.length > 0 ? (
              <fieldset>
                <legend className="lbl">{t('cartHasItems')}</legend>
                <div className="grid gap-2">
                  {(['replace', 'append'] as const).map((value) => (
                    <label
                      key={value}
                      className={cn(
                        'flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-3.5',
                        merge === value
                          ? 'border-secondary bg-secondary-soft'
                          : 'border-line bg-surface',
                      )}
                    >
                      <input
                        type="radio"
                        name="reorder-merge"
                        className="h-5 w-5 accent-[rgb(var(--secondary))]"
                        checked={merge === value}
                        onChange={() => setMerge(value)}
                      />
                      <span className="font-bold">{t(value)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </>
        )}

        <p className="m-0 flex items-start gap-2 text-[12px] text-muted">
          <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> {t('noCharge')}
        </p>
      </div>
    </Modal>
  );
}
