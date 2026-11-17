'use client';

import { Info, RotateCcw, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { planReorder } from '@/features/account/reorder';
import { buildAddInput } from '@/features/cart/add-input';
import { useCart } from '@/features/cart/cart-context';
import { REJECTION_KEY } from '@/features/cart/use-add-to-cart';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { amountToCents } from '@/lib/cart-rules';
import { useProducts } from '@/features/catalog/hooks';
import { productName } from '@/features/catalog/localized';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { useCartDrawer, useOrderSheet } from '@/features/store-shell/store-shell-context';
import type { LastOrderSummary } from '../last-order';

const money = (value: number) => formatMoney(value, 'es');

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
  const tCart = useTranslations();
  const locale = useLocale();
  const { notify } = useToast();
  const cart = useCart();
  const cartDrawer = useCartDrawer();
  const products = useProducts();
  const { mode } = useOrderMode();
  const orderSheet = useOrderSheet();
  const [merge, setMerge] = useState<'replace' | 'append'>('replace');

  const plan = products.data ? planReorder(order, products.data) : null;
  const priceCents = (productId: string): number => {
    const product = products.data?.find((p) => p.id === productId);
    return product ? (amountToCents(product.effectivePrice) ?? 0) : 0;
  };
  const nameOf = (productId: string, fallback: string) => {
    const product = products.data?.find((p) => p.id === productId);
    return product ? productName(product, locale) : fallback;
  };
  const newSubtotal =
    (plan ? plan.lines.reduce((sum, l) => sum + priceCents(l.productId) * l.quantity, 0) : 0) / 100;
  const skippedIds = new Set(plan?.skipped.map((x) => x.productId));
  const priceChanges = new Map((plan?.priceChanges ?? []).map((c) => [c.productId, c]));

  const confirm = () => {
    if (!plan || plan.lines.length === 0) return;
    // F18: el pedido anterior no guarda extras; cada línea entra con la sucursal ELEGIDA y el precio vigente del menú.
    if (!mode.branchId) {
      orderSheet.open('now');
      notify(t('needBranch'));
      return;
    }
    const inputs = plan.lines.flatMap((l) => {
      const product = products.data?.find((p) => p.id === l.productId);
      const input = product
        ? buildAddInput({
            product,
            branchId: mode.branchId as string,
            quantity: l.quantity,
            note: l.note,
          })
        : null;
      return input ? [input] : [];
    });
    const result = cart.add(inputs, { replace: merge === 'replace' || cart.count === 0 });
    if (!result.ok) {
      notify(tCart(REJECTION_KEY[result.reason]));
      return;
    }
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
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t('confirm')}
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
            {plan.skippedCount > 0 ? (
              <p
                role="status"
                className="m-0 flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] font-bold"
              >
                <TriangleAlert
                  className="mt-0.5 h-4 w-4 flex-none text-danger"
                  aria-hidden="true"
                />
                {plan.lines.length > 0
                  ? t('unavailableNote', { a: plan.skippedCount })
                  : t('noneAvailable')}
              </p>
            ) : null}

            <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface p-0">
              {order.lines.map((line, index) => {
                const unavailable = skippedIds.has(line.productId);
                const change = priceChanges.get(line.productId);
                return (
                  <li
                    key={`${line.productId}|${line.note}|${index}`}
                    className={cn(
                      'flex items-start justify-between gap-3 px-3.5 py-2.5',
                      unavailable && 'opacity-60',
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn('block font-bold', unavailable && 'line-through')}>
                        {line.quantity}× {nameOf(line.productId, line.name)}
                      </span>
                      {line.note ? (
                        <span className="block text-[12px] text-muted">{line.note}</span>
                      ) : null}
                      {unavailable ? (
                        <span className="mt-0.5 inline-block rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-extrabold text-danger">
                          {t('unavailable')}
                        </span>
                      ) : null}
                      {change ? (
                        <span className="mt-0.5 block text-[12px] font-bold text-secondary">
                          {t('priceChanged', { a: money(change.before), b: money(change.now) })}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex-none font-bold">
                      {unavailable
                        ? '—'
                        : money((priceCents(line.productId) * line.quantity) / 100)}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="rounded-2xl border border-line bg-surface px-3.5 py-3 text-[14px]">
              <div className="flex justify-between text-muted">
                <span>{t('originalTotal')}</span>
                <span>{money(order.total)}</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between">
                <span className="font-extrabold">{t('currentSubtotal')}</span>
                <span className="font-display text-[22px]">{money(newSubtotal)}</span>
              </div>
              <p className="m-0 mt-1 text-[12px] text-muted">{t('shippingNote')}</p>
            </div>

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
