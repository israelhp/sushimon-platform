'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ProductSheetHost } from '@/features/catalog/components/product-sheet-host';
import { ProductSheetProvider } from '@/features/catalog/product-sheet-context';
import { BranchSelectionGuard } from '@/features/order-mode/branch-selection';
import { StoreShellProvider } from '../store-shell-context';
import { AuthModal } from './AuthModal';
import { CartDrawer } from './CartDrawer';
import { MobileNav } from './MobileNav';
import { OrderModeSheet } from './OrderModeSheet';
import { StoreFooter } from './StoreFooter';
import { StoreHeader } from './StoreHeader';

/**
 * Overlays globales de la tienda. Se montan una sola vez: carrito, modo de pedido, inicio de sesión
 * simulado y la ficha de producto (`ProductSheetHost`, punto de montaje del bloque de Menú).
 */
export function StoreOverlays() {
  return (
    <>
      <BranchSelectionGuard />
      <CartDrawer />
      <OrderModeSheet />
      <AuthModal />
      <ProductSheetHost />
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
          <main id="contenido" className={cn('flex-1', !isCheckout && !isMenu && 'pb-16 md:pb-24')}>
            {children}
          </main>
          {isCheckout ? null : <StoreFooter />}
          {isCheckout ? null : <MobileNav />}
          <StoreOverlays />
        </div>
      </ProductSheetProvider>
    </StoreShellProvider>
  );
}
