import { ToastProvider } from '@/components/ui/Toast';
import { CartProvider } from '@/features/cart/cart-context';
import { OrderModeProvider } from '@/features/order-mode/order-mode-context';
import { StoreShell } from '@/features/store-shell/components/StoreShell';

/**
 * Zona tienda: aplica los tokens y clases propias de la tienda (`[data-zone='store']`), el proveedor de
 * avisos y el armazón (encabezado, navegación inferior móvil, pie y overlays: carrito, modo de pedido,
 * inicio de sesión simulado y ficha de producto). Ver `features/store-shell/`.
 */
export default function StoreZoneLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-zone="store" className="flex min-h-dvh flex-col bg-bg text-fg">
      <CartProvider>
        <OrderModeProvider>
          <ToastProvider zone="store">
            <StoreShell>{children}</StoreShell>
          </ToastProvider>
        </OrderModeProvider>
      </CartProvider>
    </div>
  );
}
