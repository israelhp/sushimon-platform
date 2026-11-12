'use client';

import { DispatchModal } from '@/features/bo-deliveries/components/DispatchModal';

/**
 * Host del modal "Despachar pedido" (PedidosYa SIMULADO / repartidor propio). Mantiene la firma
 * `{ orderId, onClose }` que monta `DispatchModalProvider`; el flujo vive en `bo-deliveries`.
 */
export function DispatchModalHost({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  return <DispatchModal orderId={orderId} onClose={onClose} />;
}
