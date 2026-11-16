'use client';

import { Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/lib/data-access/models';
import { useCart } from '@/features/cart/cart-context';
import { productDescription, productName, tileClass } from '../localized';
import { useProductSheet } from '../product-sheet-context';
import { FavoriteButton } from './favorite-button';
import { ProductArt } from './product-art';

const money = (value: number) => formatMoney(value, 'es', { decimals: 'auto' });

export interface ProductCardProps {
  product: Product;
  /** Catálogo completo (define el color de fondo de la ilustración, estable por producto). */
  catalog: readonly Product[];
  /**
   * `tile`: tarjeta vertical compacta (favoritos del Inicio). `row`: fila con "Agregar"/cantidad (menú).
   * Ambas abren la ficha del producto con `useProductSheet().openProduct(id)`.
   */
  variant?: 'tile' | 'row';
  className?: string;
}

/** Tarjeta de producto reutilizable (Inicio, menú, promociones). Sin datos propios: recibe el producto. */
export function ProductCard({ product, catalog, variant = 'tile', className }: ProductCardProps) {
  return variant === 'tile' ? (
    <TileCard product={product} catalog={catalog} className={className} />
  ) : (
    <RowCard product={product} catalog={catalog} className={className} />
  );
}

function TileCard({ product, catalog, className }: Omit<ProductCardProps, 'variant'>) {
  const locale = useLocale();
  const t = useTranslations();
  const { openProduct } = useProductSheet();
  const name = productName(product, locale);
  return (
    <div className={cn('relative w-[150px] flex-none snap-start sm:w-auto', className)}>
      <button
        type="button"
        onClick={() => openProduct(product.id)}
        className="flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lift"
      >
        <span
          className={cn(
            tileClass(catalog, product.id),
            'flex h-[110px] items-center justify-center',
          )}
        >
          <ProductArt
            product={product}
            sizing={{ width: 320, height: 110, sizes: '(min-width: 1024px) 25vw, 50vw' }}
            altFallback={name}
            className={cn(!product.available && 'opacity-50 grayscale')}
            artClassName={cn('h-[80%] w-auto', !product.available && 'opacity-50 grayscale')}
          />
        </span>
        <span className="flex flex-col gap-0.5 p-3">
          <span className="text-[15px] font-extrabold leading-tight">{name}</span>
          <span className="font-display text-base">{money(product.price)}</span>
          {!product.available ? (
            <span className="text-[12px] font-bold text-danger">{t('product.soldOut')}</span>
          ) : null}
        </span>
      </button>
      <FavoriteButton
        productId={product.id}
        name={name}
        onTile
        className="absolute right-2 top-2"
      />
    </div>
  );
}

function RowCard({ product, catalog, className }: Omit<ProductCardProps, 'variant'>) {
  const locale = useLocale();
  const t = useTranslations();
  const cart = useCart();
  const { notify } = useToast();
  const { openProduct } = useProductSheet();
  const name = productName(product, locale);
  const quantity = cart.quantityOf(product.id);
  const description = productDescription(product, locale);
  return (
    <article
      className={cn(
        'flex gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift sm:gap-4 sm:p-3',
        !product.available && 'opacity-80',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => openProduct(product.id)}
        aria-label={t('product.viewDetail', { a: name })}
        className={cn(
          tileClass(catalog, product.id),
          'flex h-[84px] w-[84px] flex-none items-center justify-center overflow-hidden rounded-xl sm:h-[96px] sm:w-[96px]',
        )}
      >
        <ProductArt
          product={product}
          sizing={{ width: 96, height: 96, sizes: '96px' }}
          altFallback={name}
          className={cn(!product.available && 'opacity-50 grayscale')}
          artClassName={cn('h-[78%] w-auto', !product.available && 'opacity-50 grayscale')}
        />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="-mr-1 -mt-1 flex items-start justify-between gap-1">
          <button
            type="button"
            onClick={() => openProduct(product.id)}
            className="min-w-0 pt-1 text-left"
          >
            <h3 className="m-0 text-base font-extrabold leading-tight hover:underline sm:text-[17px]">
              {name}
            </h3>
          </button>
          <FavoriteButton productId={product.id} name={name} />
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {product.featured ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-fg">
              {t('product.favorite')}
            </span>
          ) : null}
          <span className="line-clamp-1 text-[13px] text-muted">{description}</span>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="font-display text-lg sm:text-xl">{money(product.price)}</span>
          {!product.available ? (
            <button
              type="button"
              disabled
              aria-label={t('product.soldOutAria', { a: name })}
              className="inline-flex h-11 cursor-not-allowed items-center rounded-full border border-line px-4 text-sm font-extrabold text-muted"
            >
              {t('product.soldOut')}
            </button>
          ) : quantity === 0 ? (
            <button
              type="button"
              onClick={() => {
                cart.add(product.id, 1);
                notify(t('product.added', { a: name }));
              }}
              aria-label={t('product.addTo', { a: name })}
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-extrabold text-onprimary transition hover:brightness-95 active:scale-95"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('common.add')}
            </button>
          ) : (
            <div
              role="group"
              aria-label={t('product.qtyOf', { a: name })}
              className="inline-flex h-11 items-center overflow-hidden rounded-full bg-deep text-ondeep"
            >
              <button
                type="button"
                onClick={() => cart.removeOne(product.id)}
                aria-label={t('product.removeOneOf', { a: name })}
                className="inline-flex h-full w-11 items-center justify-center hover:bg-white/10"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="min-w-[24px] text-center font-extrabold" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => cart.add(product.id, 1)}
                aria-label={t('product.addOneOf', { a: name })}
                className="inline-flex h-full w-11 items-center justify-center hover:bg-white/10"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
