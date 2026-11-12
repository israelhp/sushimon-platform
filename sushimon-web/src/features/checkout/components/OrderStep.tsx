'use client';

import { Minus, Plus, Trash2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { FoodArt } from '@/components/art/FoodArt';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { useCart } from '@/features/cart/cart-context';
import { foodArtKind, productName, tileClass } from '@/features/catalog/localized';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { useCheckoutDraft } from '../checkout-context';
import type { CheckoutData } from '../use-checkout-data';
import { useCheckoutSteps } from './parts';

/** Paso 1 · Tu pedido: líneas editables (cantidad, quitar), "agregar más" e indicaciones para el restaurante. */
export function OrderStep({ data }: { data: CheckoutData }) {
  const t = useTranslations();
  const steps = useCheckoutSteps();
  const locale = useLocale();
  const { notify } = useToast();
  const cart = useCart();
  const { draft, dispatch } = useCheckoutDraft();
  const [notesOpen, setNotesOpen] = useState(() => !!draft.notes.trim());
  const catalog = data.productsQuery.data ?? [];
  const unavailableIds = new Set(data.unavailable.map((r) => r.product.id));

  return (
    <section aria-label={steps[0]} className="flex flex-col gap-3">
      {unavailableIds.size > 0 ? (
        <div role="alert" className="notice notice-warn">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
          <div>{t('checkoutFlow.unavailableNotice')}</div>
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {data.rows.map(({ line, index, product, subtotal }) => {
          const name = productName(product, locale);
          const unavailable = unavailableIds.has(product.id);
          return (
            <li
              key={`${line.productId}|${line.note}`}
              className="flex gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card"
            >
              <span
                className={cn(
                  tileClass(catalog, product.id),
                  'flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-xl',
                )}
              >
                <FoodArt kind={foodArtKind(product.illustration)} className="h-12 w-12" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 font-extrabold leading-tight">{name}</p>
                    <p className="m-0 text-[13px] text-muted">
                      {formatMoney(product.price, locale, { decimals: 'auto' })} × {line.quantity}
                    </p>
                    {line.note ? (
                      <p className="m-0 truncate text-[12px] text-muted">
                        {t('cart.note')}: {line.note}
                      </p>
                    ) : null}
                    {unavailable ? (
                      <p className="m-0 mt-0.5 text-[12px] font-bold text-danger">
                        {t('fav.unavailable')}
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
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="inline-flex items-center overflow-hidden rounded-full border border-line">
                    <button
                      type="button"
                      onClick={() => cart.decrement(index)}
                      aria-label={t('product.removeOneOf', { a: name })}
                      className="inline-flex h-10 w-10 items-center justify-center hover:bg-subtle"
                    >
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <span className="min-w-[28px] text-center font-extrabold" aria-live="polite">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => cart.increment(index)}
                      aria-label={t('product.addOneOf', { a: name })}
                      className="inline-flex h-10 w-10 items-center justify-center bg-primary text-onprimary hover:brightness-95"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <span className="font-display text-lg">{formatMoney(subtotal, locale)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Link
        href={STORE_ROUTES.menu}
        className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-sm font-extrabold text-secondary no-underline"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> {t('checkout.addMore')}
      </Link>
      {notesOpen ? (
        <div>
          <label className="lbl" htmlFor="d-notes">
            {t('checkout.notesLabel')}{' '}
            <span className="font-normal text-muted">({t('common.optional')})</span>
          </label>
          <textarea
            id="d-notes"
            className="input min-h-[88px] resize-y"
            maxLength={280}
            placeholder={t('checkout.notesPh')}
            value={draft.notes}
            onChange={(e) => dispatch({ type: 'notes', notes: e.target.value })}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          className="inline-flex min-h-[40px] items-center gap-1.5 self-start text-sm font-extrabold text-secondary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> {t('checkout.addNotes')}
        </button>
      )}
    </section>
  );
}

/** Esqueleto mientras carga el catálogo con un carrito no vacío. */
export function OrderStepSkeleton({ lines }: { lines: number }) {
  return (
    <ul aria-busy="true" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {Array.from({ length: Math.min(lines, 3) }, (_, i) => (
        <li
          key={i}
          className="flex gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card"
        >
          <Skeleton className="h-16 w-16 flex-none" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
