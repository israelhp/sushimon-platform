'use client';

import { Minus, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { memo } from 'react';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { isBlockingStatus, MAX_QUANTITY, type LineStatus } from '@/lib/cart-rules';
import type { Product, PublicProductMedia } from '@/lib/data-access/models';
import { ProductArt } from '@/features/catalog/components/product-art';
import { tileClass } from '@/features/catalog/localized';
import type { CatalogProduct } from '@/features/catalog/catalog-product';
import { useCartActions } from '../cart-context';
import { REJECTION_KEY } from '../use-add-to-cart';
import type { CartRowView } from '../use-cart-view';

export const centsMoney = (cents: number) => formatMoney(cents / 100, 'es', { decimals: 'auto' });

function statusKey(status: LineStatus | null) {
  switch (status) {
    case 'UNAVAILABLE':
      return 'cart.status.unavailable';
    case 'INACTIVE':
      return 'cart.status.inactive';
    case 'NOT_FOUND':
      return 'cart.status.notFound';
    case 'MODIFIER_INVALID':
      return 'cart.status.modifierInvalid';
    case 'OPTION_UNAVAILABLE':
      return 'cart.status.optionUnavailable';
    case 'BRANCH_MISMATCH':
      return 'cart.status.branchMismatch';
    default:
      return undefined;
  }
}

/**
 * Una línea del carrito (cajón, resumen del menú y checkout): imagen, nombre, extras, nota, cantidad ±, subtotal de línea, quitar
 * (con «Deshacer» inline), aviso de estado y sus acciones. Las cifras son provisionales. `memo`: solo se repinta si cambia SU fila.
 */
export const CartLineItem = memo(function CartLineItem({
  row,
  catalog,
  index,
  size = 'compact',
  onEdit,
  onRemove,
}: {
  row: CartRowView;
  catalog: readonly Product[];
  /** Posición de la fila (el marcador «Deshacer» ocupa su lugar). */
  index: number;
  size?: 'compact' | 'comfortable';
  /** Abre la ficha precargada con la selección de la línea. */
  onEdit?: (row: CartRowView) => void;
  onRemove: (lineId: string, name: string, index: number) => void;
}) {
  const t = useTranslations();
  const cart = useCartActions();
  const { notify } = useToast();
  const { line, evaluation, name } = row;
  const status = evaluation?.status ?? null;
  const blocked = status !== null && isBlockingStatus(status);
  const messageKey = statusKey(status);
  const big = size === 'comfortable';
  // «Editar» en toda línea con extras o nota (y siempre que el estado lo exija); sin producto vigente no hay ficha a la que ir.
  const editable =
    Boolean(onEdit && row.product) && (line.selections.length > 0 || line.note !== '' || blocked);

  const change = (run: () => ReturnType<typeof cart.increment>) => {
    const result = run();
    if (!result.ok) notify(t(REJECTION_KEY[result.reason]), { tone: 'warn' });
  };

  return (
    <li
      data-line-status={status ?? undefined}
      data-line-id={line.lineId}
      tabIndex={-1}
      className={cn(
        'flex gap-3 rounded-2xl border bg-surface shadow-card outline-none focus-visible:ring-2 focus-visible:ring-primary',
        big ? 'p-3' : 'p-2.5',
        blocked ? 'border-danger/50' : 'border-line',
      )}
    >
      <div
        className={cn(
          tileClass(catalog, line.productId),
          'flex flex-none items-center justify-center overflow-hidden rounded-xl',
          big ? 'h-16 w-16' : 'h-14 w-14',
          blocked && 'opacity-60 grayscale',
        )}
      >
        <LineThumb row={row} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn('m-0 font-extrabold leading-tight', !big && 'text-[15px]')}>{name}</p>
            {line.display.options.length > 0 ? (
              <ul
                className="m-0 mt-0.5 list-none p-0 text-[12px] text-muted"
                aria-label={t('cart.extras')}
              >
                {line.display.options.map((o) => (
                  <li key={`${o.groupId}:${o.optionId}`}>
                    + {o.optionName}
                    {o.extraCents > 0 ? ` (${centsMoney(o.extraCents)})` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="m-0 text-[12px] text-muted">
              {centsMoney(row.unitCents)} × {line.quantity} = {centsMoney(row.subtotalCents)}
            </p>
            {line.note ? (
              <p
                className="m-0 mt-0.5 line-clamp-2 break-words text-[12px] text-muted"
                title={line.note}
              >
                {t('cart.note')}: {line.note}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onRemove(line.lineId, name, index)}
            aria-label={t('cart.removeAria', { a: name })}
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full text-danger hover:bg-danger-soft"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {messageKey ? (
          <p className="m-0 mt-1 flex items-start gap-1.5 text-[12px] font-bold text-danger">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
            {t(messageKey)}
          </p>
        ) : null}
        {status === 'PRICE_CHANGED' && row.previousUnitCents !== null ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="m-0 text-[12px] font-bold text-secondary">
              {t('cart.status.priceChanged', {
                a: centsMoney(row.previousUnitCents),
                b: centsMoney(row.unitCents),
              })}
            </p>
            <button
              type="button"
              aria-label={t('cart.ackAria', { a: name })}
              className="inline-flex min-h-[44px] items-center text-[13px] font-extrabold text-secondary underline"
              onClick={() => cart.acknowledgePrice(line.lineId)}
            >
              {t('cart.ack')}
            </button>
          </div>
        ) : null}
        {editable ? (
          <button
            type="button"
            aria-label={t('cart.editAria', { a: name })}
            className="inline-flex min-h-[44px] items-center text-[13px] font-extrabold text-secondary underline"
            onClick={() => onEdit?.(row)}
          >
            {t('cart.edit')}
          </button>
        ) : null}

        <div className="mt-1 flex items-center justify-between gap-2">
          <div
            role="group"
            aria-label={t('product.qtyOf', { a: name })}
            className="inline-flex items-center overflow-hidden rounded-full border border-line bg-surface"
          >
            <button
              type="button"
              onClick={() => change(() => cart.decrement(line.lineId))}
              aria-label={t('product.removeOneOf', { a: name })}
              className="inline-flex h-11 w-11 items-center justify-center hover:bg-subtle"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="min-w-[28px] text-center font-extrabold">{line.quantity}</span>
            <button
              type="button"
              onClick={() => change(() => cart.increment(line.lineId))}
              disabled={line.quantity >= MAX_QUANTITY}
              aria-label={t('product.addOneOf', { a: name })}
              className="inline-flex h-11 w-11 items-center justify-center bg-primary text-onprimary hover:brightness-95 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <span className="font-display text-lg">{centsMoney(row.subtotalCents)}</span>
        </div>
      </div>
    </li>
  );
});

/** Foto vigente del menú, o la guardada (solo https aprobada), o la ilustración neutra. */
function LineThumb({ row }: { row: CartRowView }) {
  const { line, product, name } = row;
  if (product) {
    return (
      <ProductArt
        product={product as CatalogProduct}
        sizing={{ width: 64, height: 64, sizes: '64px' }}
        altFallback={name}
        artClassName="h-11 w-11"
      />
    );
  }
  const media: PublicProductMedia | null = line.display.imageUrl
    ? { url: line.display.imageUrl, altText: null }
    : null;
  return (
    <ProductArt
      product={{ illustration: 'roll' } as Product}
      media={media}
      sizing={{ width: 64, height: 64, sizes: '64px' }}
      altFallback={name}
      artClassName="h-11 w-11"
    />
  );
}
