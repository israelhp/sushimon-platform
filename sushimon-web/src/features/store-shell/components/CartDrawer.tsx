'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { FoodArt } from '@/components/art/FoodArt';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Product } from '@/lib/data-access/models';
import { useCart } from '@/features/cart/cart-context';
import { estimateSubtotal } from '@/features/cart/cart';
import { useProducts } from '@/features/catalog/hooks';
import { foodArtKind, productName, tileClass } from '@/features/catalog/localized';
import { BranchNotAcceptingNotice } from '@/features/branch-schedule/components/BranchNotAcceptingNotice';
import { useBranchAvailability } from '@/features/branch-schedule/hooks';
import { usePublicBranches } from '@/features/branches/hooks';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { STORE_ROUTES } from '../nav';
import { useCartDrawer } from '../store-shell-context';
import { ErrorNotice } from './ErrorNotice';
import { OrderModeButton } from './OrderModeButton';

const money = (value: number) => formatMoney(value, 'es', { decimals: 'auto' });

/**
 * Carrito lateral ("Tu pedido"): modo de entrega, líneas con cantidad/nota/eliminar, total estimado y
 * "Continuar" al checkout. Los precios son del catálogo (el total definitivo lo calcula el servidor).
 * Esc o clic fuera lo cierran; el foco queda atrapado y vuelve al botón que lo abrió.
 */
export function CartDrawer() {
  const { isOpen, close } = useCartDrawer();
  const t = useTranslations();
  const locale = useLocale();
  const { notify } = useToast();
  const cart = useCart();
  const products = useProducts();
  // F08: aviso (solo UI) si la sucursal elegida no recibe pedidos ahora; lo calcula el servidor.
  const { mode } = useOrderMode();
  const publicBranches = usePublicBranches();
  const branchAvailability = useBranchAvailability(mode.when.kind === 'now' ? mode.branchId : null);
  const branchName = publicBranches.data?.find((b) => b.id === mode.branchId)?.name ?? '';

  const byId = new Map<string, Product>((products.data ?? []).map((p) => [p.id, p]));
  const rows = cart.lines.flatMap((line, index) => {
    const product = byId.get(line.productId);
    return product ? [{ line, index, product }] : [];
  });
  const prices = Object.fromEntries((products.data ?? []).map((p) => [p.id, p.price]));
  const total = estimateSubtotal(
    rows.map((r) => r.line),
    prices,
  );
  const units = rows.reduce((n, r) => n + r.line.quantity, 0);
  const loading = products.isPending && cart.lines.length > 0;
  const failed = products.isError && cart.lines.length > 0;

  return (
    <Drawer
      open={isOpen}
      onClose={close}
      title={t('cart.title')}
      footer={
        rows.length > 0 ? (
          <div className="flex flex-col gap-2.5 pt-0.5">
            <div className="flex items-baseline justify-between">
              <span className="font-bold">{t('cart.total')}</span>
              <strong className="font-display text-[26px]">{money(total)}</strong>
            </div>
            <Link
              href={STORE_ROUTES.checkout}
              onClick={close}
              className="btn btn-primary w-full !justify-between !px-6"
            >
              <span>{t('common.continue')}</span>
              <span className="text-sm">{t('common.products', { a: units })}</span>
            </Link>
          </div>
        ) : null
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-dashed border-line bg-surface px-5 py-2.5">
          <span className="text-[13px] font-bold text-muted">{t('cart.delivery')}</span>
          <OrderModeButton />
        </div>
        {branchName ? (
          <BranchNotAcceptingNotice
            name={branchName}
            availability={branchAvailability.data}
            className="mx-4 mt-3"
          />
        ) : null}

        {cart.lines.length === 0 ? (
          <EmptyState
            title={t('cart.empty')}
            description={t('cart.emptySub')}
            action={
              <Link
                href={STORE_ROUTES.menu}
                onClick={close}
                className="btn btn-primary !min-h-[44px]"
              >
                {t('common.goMenu')}
              </Link>
            }
          />
        ) : loading ? (
          <ul
            aria-busy="true"
            aria-label={t('ui.loading')}
            className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2.5 overflow-y-auto px-4 py-3"
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
        ) : failed ? (
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
                          {!product.available ? (
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
              {rows.length > 0 ? (
                <li className="flex justify-end">
                  <Button
                    variant="link"
                    className="!min-h-[36px] !py-0 text-[13px] !text-muted"
                    onClick={() => {
                      cart.clear();
                      notify(t('cart.cleared'));
                    }}
                  >
                    {t('cart.clear')}
                  </Button>
                </li>
              ) : null}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}
