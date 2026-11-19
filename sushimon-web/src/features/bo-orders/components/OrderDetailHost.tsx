'use client';

import { useOrderDetail } from '../order-detail-context';
import { OrderDrawer } from './OrderDrawer';

/** Monta el drawer de detalle del pedido abierto. Va una sola vez en el layout autenticado. */
export function OrderDetailHost() {
  const { orderId } = useOrderDetail();
  if (!orderId) return null;
  return <OrderDrawer orderId={orderId} />;
}
