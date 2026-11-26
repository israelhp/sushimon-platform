'use client';

import { useTranslations } from 'next-intl';
import { Drawer } from '@/components/ui/Drawer';
import { BranchNotAcceptingNotice } from '@/features/branch-schedule/components/BranchNotAcceptingNotice';
import { useBranchAvailability } from '@/features/branch-schedule/hooks';
import { usePublicBranches } from '@/features/branches/hooks';
import { CartFooter, CartPanelBody } from '@/features/cart/components/CartPanel';
import { useCart } from '@/features/cart/cart-context';
import { useCartView } from '@/features/cart/use-cart-view';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { useCartDrawer } from '../store-shell-context';
import { OrderModeButton } from './OrderModeButton';

/**
 * Carrito lateral ("Tu pedido"): modo de entrega, líneas con extras/cantidad/quitar, subtotal ESTIMADO y "Continuar".
 * Se monta SOLO al abrirlo (carga perezosa) y entonces revalida (precio, disponibilidad y extras de la sucursal del carrito);
 * cerrado no existe ni consulta nada. En escritorio el resumen del menú ya revalidó y comparte la caché.
 * Esc o clic fuera lo cierran; el foco queda atrapado y vuelve al botón que lo abrió.
 */
export function CartDrawer() {
  const { isOpen, close } = useCartDrawer();
  const t = useTranslations();
  const cart = useCart();
  const view = useCartView({ enabled: isOpen });
  // F08: aviso (solo UI) si la sucursal elegida no recibe pedidos ahora; lo calcula el servidor.
  const { mode } = useOrderMode();
  const publicBranches = usePublicBranches();
  const branchAvailability = useBranchAvailability(isOpen ? mode.branchId : null);
  const branchName = publicBranches.data?.find((b) => b.id === mode.branchId)?.name ?? '';

  return (
    <Drawer
      open={isOpen}
      onClose={close}
      title={t('cart.title')}
      footer={
        cart.lines.length > 0 ? (
          <CartFooter view={view} units={cart.count} onNavigate={close} />
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
        <CartPanelBody view={view} onNavigate={close} />
      </div>
    </Drawer>
  );
}
