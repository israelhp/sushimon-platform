'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ProductSheetProvider, useProductSheet } from '@/features/catalog/product-sheet-context';
import { FavoritesProvider } from '@/features/favorites/favorites-provider';
import { CartAnnouncer } from '@/features/cart/components/CartAnnouncer';
import { CartBranchGuard } from '@/features/cart/components/CartBranchGuard';
import { BranchSelectionGuard } from '@/features/order-mode/branch-selection';
import { StoreShellProvider, useStoreShell } from '../store-shell-context';
import { AuthModal } from './AuthModal';
import { MobileNav } from './MobileNav';
import { OrderModeSheet } from './OrderModeSheet';
import { StoreFooter } from './StoreFooter';
import { StoreHeader } from './StoreHeader';

// Carga PEREZOSA (sin SSR): el cajón del carrito y la ficha de producto solo se descargan cuando se abren (el contexto y el
// contador del carrito se quedan en el paquete inicial).
const CartDrawer = dynamic(() => import('./CartDrawer').then((m) => ({ default: m.CartDrawer })), {
  ssr: false,
});
const ProductSheetHost = dynamic(
  () =>
    import('@/features/catalog/components/product-sheet-host').then((m) => ({
      default: m.ProductSheetHost,
    })),
  { ssr: false },
);

/**
 * Overlays globales de la tienda. Se montan una sola vez: carrito, modo de pedido, inicio de sesión
 * simulado y la ficha de producto (`ProductSheetHost`, punto de montaje del bloque de Menú).
 */
export function StoreOverlays() {
  const { cartOpen } = useStoreShell();
  const { productId } = useProductSheet();
  return (
    <>
      <BranchSelectionGuard />
      <CartBranchGuard />
      <CartAnnouncer />
      {cartOpen ? <CartDrawer /> : null}
      <OrderModeSheet />
      <AuthModal />
      {productId ? <ProductSheetHost /> : null}
    </>
  );
}

/**
 * Armazón de la zona pública: enlace "Saltar al contenido", encabezado, contenido, pie, barra inferior
 * móvil y overlays. El checkout oculta pie y barra inferior; el menú maneja su propio espaciado.
 */
export function StoreShell({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const isCheckout = pathname.startsWith('/checkout');
  const isMenu = pathname.startsWith('/menu');

  return (
    <StoreShellProvider>
      <ProductSheetProvider>
        <FavoritesProvider>
          <div
            className={cn(
              'flex min-h-dvh flex-1 flex-col overflow-x-clip lg:pb-0',
              !isCheckout && 'pb-[calc(60px+env(safe-area-inset-bottom))]',
            )}
          >
            <a
              href="#contenido"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-full focus:bg-deep focus:px-4 focus:py-2 focus:text-ondeep"
            >
              {t('skip')}
            </a>
            <StoreHeader />
            <main
              id="contenido"
              className={cn('flex-1', !isCheckout && !isMenu && 'pb-16 md:pb-24')}
            >
              {children}
            </main>
            {isCheckout ? null : <StoreFooter />}
            {isCheckout ? null : <MobileNav />}
            <StoreOverlays />
          </div>
        </FavoritesProvider>
      </ProductSheetProvider>
    </StoreShellProvider>
  );
}
