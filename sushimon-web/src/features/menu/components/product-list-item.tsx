'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/lib/data-access/models';
import { useCart } from '@/features/cart/cart-context';
import { FavoriteButton } from '@/features/catalog/components/favorite-button';
import { ProductArt } from '@/features/catalog/components/product-art';
import { productDescription, productName, tileClass } from '@/features/catalog/localized';
import { useProductSheet } from '@/features/catalog/product-sheet-context';

const money = (value: number) => formatMoney(value, 'es', { decimals: 'auto' });

/**
 * Fila compacta del menú en escritorio (3 columnas): toda la fila abre la ficha, donde se agrega.
 * Muestra una insignia con la cantidad ya en el pedido y rotula los productos no disponibles.
 */
export function ProductListItem({
  product,
  catalog,
}: {
  product: Product;
  catalog: readonly Product[];
}) {
  const locale = useLocale();
  const t = useTranslations();
  const { openProduct } = useProductSheet();
  const cart = useCart();
  const name = productName(product, locale);
  const quantity = cart.quantityOf(product.id);
  const text =
    productDescription(product, locale) ||
    (product.featured ? t('product.favoriteSub') : t('product.tapToCustomize'));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => openProduct(product.id)}
        className="group flex w-full items-center gap-3.5 rounded-xl border-b border-line py-3 pl-2 pr-12 text-left transition hover:bg-surface focus-visible:bg-surface"
      >
        <span
          className={cn(
            tileClass(catalog, product.id),
            'relative flex h-[72px] w-[72px] flex-none items-center justify-center overflow-hidden rounded-xl transition group-hover:-rotate-2',
            !product.available && 'opacity-50 grayscale',
          )}
        >
          <ProductArt product={product} artClassName="h-[56px] w-[56px]" />
          {quantity > 0 ? (
            <span
              className="absolute -right-0.5 -top-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-bl-lg rounded-tr-lg bg-deep px-1.5 text-[12px] font-extrabold text-ondeep"
              role="img"
              aria-label={t('product.inOrder', { a: quantity })}
            >
              {quantity}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-extrabold leading-tight text-fg group-hover:text-primary">
            {name}
          </span>
          <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{text}</span>
          <span className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-[15px]">{money(product.price)}</span>
            {!product.available ? (
              <span className="text-[12px] font-bold text-danger">{t('fav.unavailable')}</span>
            ) : null}
          </span>
        </span>
      </button>
      <FavoriteButton productId={product.id} name={name} className="absolute right-1 top-2" />
    </div>
  );
}
