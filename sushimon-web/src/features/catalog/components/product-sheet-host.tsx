'use client';

import { Minus, Plus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { Portal } from '@/components/ui/Portal';
import { useToast } from '@/components/ui/Toast';
import { useDialog } from '@/components/ui/use-dialog';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { isApiError } from '@/lib/data-access/errors';
import type { Product, PublicModifierGroup, PublicProductMedia } from '@/lib/data-access/models';
import type { ModifierSelection } from '@/lib/modifier-rules';
import { safeMediaUrl } from '@/lib/product-rules';
import { useCategoryLabel } from '@/features/menu/category-label';
import { MAX_NOTE_LENGTH, MAX_QUANTITY } from '@/features/cart/cart';
import { useCart } from '@/features/cart/cart-context';
import type { CatalogProduct } from '../catalog-product';
import { useProducts, useStoreProduct } from '../hooks';
import { productDescription, productName, tileClass } from '../localized';
import { estimatedUnitCents, useModifierSelection } from '../modifier-selection';
import { useProductSheet } from '../product-sheet-context';
import { FavoriteButton } from './favorite-button';
import { ModifierSelector } from './modifier-selector';
import { ProductArt } from './product-art';

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

/** Campos de `CatalogProduct` que la ficha aprovecha cuando existen (slug para la ficha del servidor, categoría e imágenes). */
type ProductWithCatalogFields = Product &
  Partial<Pick<CatalogProduct, 'slug' | 'category' | 'media' | 'basePrice' | 'effectivePrice'>>;

/**
 * Ficha del producto: hoja inferior en móvil y modal centrado de dos columnas desde `md` (como el
 * prototipo). Cantidad 1–99, observaciones (no cambian el precio) y "Agregar" con el total, que es solo
 * una referencia: el precio definitivo lo calcula el servidor al crear el pedido.
 */
/** Lo que la ficha entrega al agregar: producto, cantidad, nota y la selección ESTRUCTURADA de extras (F12; F18 la consume). */
export interface SheetAddPayload {
  productId: string;
  quantity: number;
  note: string;
  modifiers: ModifierSelection[];
}

const NO_GROUPS: readonly PublicModifierGroup[] = [];

export function ProductSheet({
  product,
  catalog,
  onClose,
  onAdd,
}: {
  product: Product;
  catalog: readonly Product[];
  onClose: () => void;
  /**
   * Reemplaza la acción de agregar. Por defecto agrega el producto BASE al carrito mock: el carrito aún no transporta extras
   * (F18); la selección validada llega en `modifiers` para quien la consuma.
   */
  onAdd?: (payload: SheetAddPayload) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const cart = useCart();
  const { notify } = useToast();
  const categoryLabel = useCategoryLabel();
  const detailSlug = (product as ProductWithCatalogFields).slug ?? null;
  const detail = useStoreProduct(detailSlug);
  const ref = useDialog<HTMLDivElement>(true, onClose);
  const noteId = useId();
  const titleId = useId();
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  const name = productName(product, locale);
  const extra = product as ProductWithCatalogFields;
  const category = extra.category;
  const categoryText = category ? categoryLabel(category) : '';
  const ancestors = detail.data?.categoryAncestors ?? [];
  const gallery = (detail.data?.media ?? extra.media ?? []).filter((m) => safeMediaUrl(m.url));
  const [imageIndex, setImageIndex] = useState(0);
  const image: PublicProductMedia | null =
    gallery[Math.min(imageIndex, gallery.length - 1)] ?? null;
  const description =
    productDescription(product, locale) ||
    (product.food ? t('product.pendingIngredients') : `${categoryText}.`);
  // 404 de la ficha (ya no está publicado: inactivo o categoría oculta): no se puede agregar al pedido.
  const gone = isApiError(detail.error) && detail.error.status === 404;
  const available = product.available && !gone;

  // F12: extras de la ficha del servidor (solo grupos ofrecibles y opciones activas). Sin ficha (sin slug) no hay extras.
  const groups = useMemo(() => detail.data?.modifierGroups ?? NO_GROUPS, [detail.data]);
  const selection = useModifierSelection(groups);
  const modifiersLoading = Boolean(detailSlug) && detail.isPending;
  const modifiersFailed = detail.isError && !gone;
  const canAdd = available && !modifiersLoading && !modifiersFailed && selection.valid;
  // F13: la estimación parte del precio EFECTIVO de la sucursal elegida (override o base), nunca del de otra.
  const basePrice = extra.effectivePrice ?? extra.basePrice ?? null;
  const unitCents =
    (basePrice ? estimatedUnitCents(basePrice, selection.extraCents) : null) ??
    Math.round(product.price * 100) + selection.extraCents;

  const submit = () => {
    if (!canAdd) return;
    if (onAdd) onAdd({ productId: product.id, quantity, note, modifiers: selection.selections });
    else cart.add(product.id, quantity, note);
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
          {image ? (
            <ProductArt
              product={product}
              media={image}
              sizing={{
                width: 430,
                height: 340,
                sizes: '(min-width: 768px) 430px, 100vw',
                priority: true,
              }}
              altFallback={productName(product, locale)}
              className={cn(!available && 'opacity-60 grayscale')}
            />
          ) : (
            <ProductArt
              product={product}
              media={null}
              artClassName={cn(
                'w-[55%] max-w-[280px] md:w-[70%]',
                !available && 'opacity-60 grayscale',
              )}
            />
          )}
          {gallery.length > 1 ? (
            <div
              role="group"
              aria-label={t('product.gallery')}
              className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5"
            >
              {gallery.map((m, i) => (
                <button
                  key={`${m.url}-${i}`}
                  type="button"
                  aria-label={t('product.imageN', { a: i + 1, b: gallery.length })}
                  aria-pressed={i === imageIndex}
                  onClick={() => setImageIndex(i)}
                  className={cn(
                    'h-3 w-3 rounded-full border border-white shadow-card',
                    i === imageIndex ? 'bg-primary' : 'bg-white/70',
                  )}
                />
              ))}
            </div>
          ) : null}
          {product.featured ? (
            <span className="absolute left-3 top-3 rounded-full bg-white px-2.5 py-1 text-xs font-extrabold uppercase text-neutral-900 shadow-card">
              {t('product.favoriteLong')}
            </span>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-col gap-3.5 p-6 md:overflow-y-auto md:p-7">
          {category ? (
            <nav aria-label={t('product.breadcrumb')}>
              <ol className="eyebrow m-0 flex list-none flex-wrap items-center gap-x-1.5 p-0 text-secondary">
                {[...ancestors, category].map((c, i, all) => (
                  <li key={c.id} className="flex items-center gap-1.5">
                    {i > 0 ? <span aria-hidden="true">›</span> : null}
                    <span aria-current={i === all.length - 1 ? 'location' : undefined}>
                      {categoryLabel(c)}
                    </span>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
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
          {gone ? (
            <p role="status" className="notice notice-warn m-0">
              {t('product.goneNote')}
            </p>
          ) : !available ? (
            <p role="status" className="notice notice-warn m-0">
              {t('product.unavailableNote')}
            </p>
          ) : null}
          {modifiersLoading ? (
            <p role="status" className="m-0 text-[14px] text-muted">
              {t('product.modifiers.loading')}
            </p>
          ) : modifiersFailed ? (
            <p role="alert" className="notice notice-warn m-0">
              {t('product.modifiers.loadError')}{' '}
              <button type="button" className="underline" onClick={() => void detail.refetch()}>
                {t('product.modifiers.retry')}
              </button>
            </p>
          ) : null}
          <ModifierSelector groups={groups} selection={selection} disabled={!available} />
          {groups.length > 0 ? (
            <div className="rounded-2xl bg-subtle p-3.5 text-[14px]">
              <dl className="m-0 flex flex-col gap-1">
                <div className="flex justify-between gap-3">
                  <dt>{t('product.modifiers.extrasTotal')}</dt>
                  <dd className="m-0 font-bold">{`+${formatMoney(selection.extraCents / 100)}`}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>{t('product.modifiers.estimatedTotal')}</dt>
                  <dd className="m-0 font-extrabold">{formatMoney(unitCents / 100)}</dd>
                </div>
              </dl>
              <p className="m-0 mt-1.5 text-[13px] text-muted">
                {t('product.modifiers.estimateNote')}
              </p>
              <p className="m-0 mt-1 text-[13px] text-muted">{t('product.modifiers.cartNote')}</p>
            </div>
          ) : null}
          {!selection.valid && available ? (
            <p role="status" className="m-0 text-[13px] font-bold text-danger">
              {t('product.modifiers.missing')}
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
              disabled={!canAdd}
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
