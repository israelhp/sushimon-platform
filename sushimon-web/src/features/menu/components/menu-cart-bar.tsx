'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format';
import { estimateSubtotal } from '@/features/cart/cart';
import { useCart } from '@/features/cart/cart-context';
import { useProducts } from '@/features/catalog/hooks';
import { useProductSheet } from '@/features/catalog/product-sheet-context';
import { useCartDrawer } from '@/features/store-shell/store-shell-context';

/**
 * Barra flotante "N productos · Q… — Ver pedido" (móvil/tablet; en escritorio el pedido está en el panel
 * lateral). Se oculta con el carrito vacío, el carrito abierto o la ficha de producto abierta.
 */
export function MenuCartBar() {
  const t = useTranslations();
  const cart = useCart();
  const products = useProducts();
  const drawer = useCartDrawer();
  const sheet = useProductSheet();
  if (cart.count === 0 || drawer.isOpen || sheet.productId) return null;
  const total = estimateSubtotal(
    cart.lines,
    Object.fromEntries((products.data ?? []).map((p) => [p.id, p.price])),
  );
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={drawer.open}
        className="anim-rise fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-[60] flex min-h-[56px] w-[min(520px,calc(100%-24px))] -translate-x-1/2 items-center justify-between gap-3 rounded-full bg-deep py-1.5 pl-5 pr-1.5 text-[15px] font-extrabold text-ondeep shadow-pop dark:bg-surface dark:text-fg dark:ring-1 dark:ring-line"
      >
        <span>
          {t('common.products', { a: cart.count })} ·{' '}
          {formatMoney(total, 'es', { decimals: 'auto' })}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-onprimary">
          {t('cart.viewOrder')} <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      </button>
    </div>
  );
}
