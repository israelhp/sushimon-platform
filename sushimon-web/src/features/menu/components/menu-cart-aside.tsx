'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { FoodArt } from '@/components/art/FoodArt';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/lib/data-access/models';
import { estimateSubtotal } from '@/features/cart/cart';
import { useCart } from '@/features/cart/cart-context';
import { useProducts } from '@/features/catalog/hooks';
import { foodArtKind, productName, tileClass } from '@/features/catalog/localized';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { OrderModeButton } from '@/features/store-shell/components/OrderModeButton';
import { STORE_ROUTES } from '@/features/store-shell/nav';

const money = (value: number) => formatMoney(value, 'es', { decimals: 'auto' });

/**
 * Panel "Tu pedido" fijo a la derecha del menú en escritorio (lg): modo de entrega, líneas con
 * cantidad, total estimado y "Continuar". Los precios son del catálogo; el total definitivo lo calcula el servidor.
 */
export function MenuCartAside() {
  const t = useTranslations();
  const locale = useLocale();
  const { notify } = useToast();
  const cart = useCart();
  const products = useProducts();

  const byId = new Map<string, Product>((products.data ?? []).map((p) => [p.id, p]));
  const rows = cart.lines.flatMap((line, index) => {
    const product = byId.get(line.productId);
    return product ? [{ line, index, product }] : [];
  });
  const total = estimateSubtotal(
    rows.map((r) => r.line),
    Object.fromEntries((products.data ?? []).map((p) => [p.id, p.price])),
  );
  const units = rows.reduce((n, r) => n + r.line.quantity, 0);
  const hasLines = cart.lines.length > 0;

  return (
    <aside className="hidden lg:block" aria-label={t('cart.title')}>
      <div className="sticky top-[72px] flex h-[calc(100vh-72px)] flex-col border-l border-line bg-bg">
        <h2 className="disp border-b border-line bg-surface px-5 py-3.5 text-[24px]">
          {t('cart.title')}
        </h2>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-dashed border-line bg-surface px-5 py-2.5">
            <span className="text-[13px] font-bold text-muted">{t('cart.delivery')}</span>
            <OrderModeButton />
          </div>
          {!hasLines ? (
            <EmptyState title={t('cart.empty')} description={t('cart.emptySub')} compact />
          ) : products.isPending ? (
            <ul
              aria-busy="true"
              aria-label={t('ui.loading')}
              className="m-0 flex list-none flex-col gap-2.5 px-4 py-3"
            >
              {cart.lines.slice(0, 3).map((line, i) => (
                <li
                  key={`${line.productId}|${i}`}
                  className="flex gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-card"
                >
                  <Skeleton className="h-14 w-14 flex-none" />
                  <div className="flex flex-1 flex-col gap-2 py-1">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </li>
              ))}
            </ul>
          ) : products.isError ? (
            <div className="p-4">
              <ErrorNotice onRetry={() => void products.refetch()} />
            </div>
          ) : (
            <>
              <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2.5 overflow-y-auto px-4 py-3">
                {rows.map(({ line, index, product }) => {
                  const name = productName(product, locale);
                  return (
                    <li
                      key={`${line.productId}|${line.note}`}
                      className="flex gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-card"
                    >
                      <div
                        className={cn(
                          tileClass(products.data ?? [], product.id),
                          'flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-xl',
                        )}
                      >
                        <FoodArt kind={foodArtKind(product.illustration)} className="h-11 w-11" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="m-0 text-[15px] font-extrabold leading-tight">{name}</p>
                            <p className="m-0 text-[12px] text-muted">
                              {money(product.price)} × {line.quantity} ={' '}
                              {money(product.price * line.quantity)}
                            </p>
                            {line.note ? (
                              <p className="m-0 mt-0.5 truncate text-[12px] text-muted">
                                {t('cart.note')}: {line.note}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              cart.remove(index);
                              notify(t('product.removed', { a: name }));
                            }}
                            aria-label={t('cart.removeAria', { a: name })}
                            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full text-danger hover:bg-danger-soft"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                        <div className="mt-1.5 inline-flex items-center overflow-hidden rounded-full border border-line bg-surface">
                          <button
                            type="button"
                            onClick={() => cart.decrement(index)}
                            aria-label={t('product.removeOneOf', { a: name })}
                            className="inline-flex h-9 w-9 items-center justify-center hover:bg-subtle"
                          >
                            <Minus className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <span
                            className="min-w-[26px] text-center font-extrabold"
                            aria-live="polite"
                          >
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => cart.increment(index)}
                            aria-label={t('product.addOneOf', { a: name })}
                            className="inline-flex h-9 w-9 items-center justify-center bg-primary text-onprimary hover:brightness-95"
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-col gap-2.5 border-t border-line bg-surface px-5 pb-4 pt-3.5">
                <div className="flex items-baseline justify-between">
                  <span className="font-bold">{t('cart.total')}</span>
                  <strong className="font-display text-[26px]">{money(total)}</strong>
                </div>
                <Link
                  href={STORE_ROUTES.checkout}
                  className="btn btn-primary w-full !justify-between !px-6"
                >
                  <span>{t('common.continue')}</span>
                  <span className="text-sm">{t('common.products', { a: units })}</span>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
