'use client';

import { useOrderDetail } from '../order-detail-context';
import { OrderDrawer } from './OrderDrawer';
import { RejectModal } from './RejectModal';

/** Monta el drawer de detalle y el modal Rechazar del pedido abierto. Va una sola vez en el layout autenticado. */
export function OrderDetailHost() {
  const { orderId, rejectOpen } = useOrderDetail();
  if (!orderId) return null;
  return (
    <>
      <OrderDrawer orderId={orderId} />
      {rejectOpen ? <RejectModal orderId={orderId} /> : null}
    </>
  );
}
