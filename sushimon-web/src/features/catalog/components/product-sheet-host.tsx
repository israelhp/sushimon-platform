'use client';

import { Minus, Plus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { FoodArt } from '@/components/art/FoodArt';
import { Portal } from '@/components/ui/Portal';
import { useToast } from '@/components/ui/Toast';
import { useDialog } from '@/components/ui/use-dialog';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/lib/data-access/models';
import { MAX_NOTE_LENGTH, MAX_QUANTITY } from '@/features/cart/cart';
import { useCart } from '@/features/cart/cart-context';
import { useCategories, useProducts } from '../hooks';
import {
  categoryName,
  foodArtKind,
  productDescription,
  productName,
  tileClass,
} from '../localized';
import { useProductSheet } from '../product-sheet-context';
import { FavoriteButton } from './favorite-button';

const money = (value: number) => formatMoney(value, 'es', { decimals: 'auto' });

/**
 * PUNTO DE MONTAJE de la ficha de producto. Se renderiza una sola vez dentro de `StoreShell` y escucha
 * `useProductSheet().productId`; cualquier tarjeta abre la ficha con `openProduct(id)`.
 */
export function ProductSheetHost() {
  const { productId, closeProduct } = useProductSheet();
  const products = useProducts();
  const product = productId ? products.data?.find((p) => p.id === productId) : undefined;
  if (!product) return null;
  // `key`: cantidad y observaciones empiezan de cero con cada producto.
  return (
    <ProductSheet
      key={product.id}
      product={product}
      catalog={products.data ?? []}
      onClose={closeProduct}
    />
  );
}

/**
 * Ficha del producto: hoja inferior en móvil y modal centrado de dos columnas desde `md` (como el
 * prototipo). Cantidad 1–99, observaciones (no cambian el precio) y "Agregar" con el total, que es solo
 * una referencia: el precio definitivo lo calcula el servidor al crear el pedido.
 */
export function ProductSheet({
  product,
  catalog,
  onClose,
}: {
  product: Product;
  catalog: readonly Product[];
  onClose: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const cart = useCart();
  const { notify } = useToast();
  const categories = useCategories();
  const ref = useDialog<HTMLDivElement>(true, onClose);
  const noteId = useId();
  const titleId = useId();
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  const name = productName(product, locale);
  const category = categories.data?.find((c) => c.id === product.categoryId);
  const categoryLabel = category ? categoryName(category, locale) : '';
  const description =
    productDescription(product, locale) ||
    (product.food ? t('product.pendingIngredients') : `${categoryLabel}.`);
  const available = product.available;

  const submit = () => {
    if (!available) return;
    cart.add(product.id, quantity, note);
    notify(t('product.addedQty', { a: quantity, b: name }));
    onClose();
  };

  return (
    <Portal zone="store">
      <div
        className="anim-fade fixed inset-0 z-[70] bg-black/55"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="anim-pop fixed inset-x-0 bottom-0 z-[90] grid max-h-[92%] overflow-y-auto rounded-t-3xl border border-line bg-bg text-fg shadow-pop outline-none md:inset-auto md:left-1/2 md:top-1/2 md:w-[min(860px,calc(100%-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:grid-cols-2 md:overflow-hidden md:rounded-3xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute right-3.5 top-3.5 z-10 inline-flex h-[44px] w-[44px] items-center justify-center rounded-full border border-line bg-surface shadow-card hover:bg-subtle"
        >
          <X aria-hidden="true" />
        </button>

        <div
          className={cn(
            tileClass(catalog, product.id),
            'relative flex min-h-[200px] items-center justify-center md:min-h-[340px]',
          )}
        >
          <FoodArt
            kind={foodArtKind(product.illustration)}
            className={cn('w-[55%] max-w-[280px] md:w-[70%]', !available && 'opacity-60 grayscale')}
          />
          {product.featured ? (
            <span className="absolute left-3 top-3 rounded-full bg-white px-2.5 py-1 text-xs font-extrabold uppercase text-neutral-900 shadow-card">
              {t('product.favoriteLong')}
            </span>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-col gap-3.5 p-6 md:overflow-y-auto md:p-7">
          {categoryLabel ? <p className="eyebrow text-secondary">{categoryLabel}</p> : null}
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="disp min-w-0 text-[30px] md:text-[40px]">
              {name}
            </h2>
            <FavoriteButton
              productId={product.id}
              name={name}
              size="md"
              className="border border-line"
            />
          </div>
          <p className="m-0 leading-relaxed text-muted">{description}</p>
          <p className="m-0 font-display text-[32px]">{money(product.price)}</p>
          {!available ? (
            <p role="status" className="notice notice-warn m-0">
              {t('product.unavailableNote')}
            </p>
          ) : null}
          <div>
            <label className="lbl" htmlFor={noteId}>
              {t('product.notes')}
            </label>
            <textarea
              id={noteId}
              className="input min-h-[88px] resize-y"
              maxLength={MAX_NOTE_LENGTH}
              placeholder={t('product.notesPh')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={!available}
            />
            <p className="mt-1.5 text-[13px] text-muted">{t('product.notesHelp')}</p>
          </div>
          <div className="sticky bottom-0 -mx-6 -mb-6 mt-auto flex items-center gap-3 border-t border-line bg-surface px-6 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 md:-mx-7 md:-mb-7 md:px-7">
            <div
              role="group"
              aria-label={t('product.qty')}
              className="inline-flex flex-none items-center overflow-hidden rounded-full border border-line bg-surface"
            >
              <button
                type="button"
                onClick={() => setQuantity((n) => Math.max(1, n - 1))}
                disabled={!available || quantity <= 1}
                aria-label={t('product.decrease')}
                className="inline-flex h-12 w-11 items-center justify-center hover:bg-subtle disabled:opacity-40"
              >
                <Minus className="h-5 w-5" aria-hidden="true" />
              </button>
              <span className="min-w-[28px] text-center text-lg font-extrabold" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((n) => Math.min(MAX_QUANTITY, n + 1))}
                disabled={!available || quantity >= MAX_QUANTITY}
                aria-label={t('product.increase')}
                className="inline-flex h-12 w-11 items-center justify-center bg-primary text-onprimary hover:brightness-95 disabled:opacity-40"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary min-w-0 flex-1 !justify-between !px-5"
              onClick={submit}
              disabled={!available}
            >
              <span>{t('common.add')}</span>
              <span className="font-display">{money(product.price * quantity)}</span>
            </button>
          </div>
          {quantity >= MAX_QUANTITY ? (
            <p role="status" className="sr-only">
              {t('product.maxQty', { a: MAX_QUANTITY })}
            </p>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}
