import type { Metadata } from 'next';
import { ScreenGuard } from '@/features/backoffice-shell/ScreenGuard';
import { OrdersScreen } from '@/features/bo-orders/components/OrdersScreen';

export const metadata: Metadata = { title: 'Pedidos' };

export default function PedidosPage() {
  return (
    <ScreenGuard screen="pedidos">
      <h1 className="sr-only">Pedidos</h1>
      <OrdersScreen />
    </ScreenGuard>
  );
}
