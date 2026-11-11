'use client';

import { useTranslations } from 'next-intl';
import { IconClose } from '@/components/icons/bo';
import { Modal } from '@/components/ui/Modal';
import { useOrderDetail } from '../order-detail-context';
import { orderCode } from '../order-view';
import { useOrderActions } from '../use-order-actions';
import { useScopedOrders } from '../use-scoped-orders';

/** Motivos de rechazo del prototipo (se notifica al cliente; el motivo viaja en `reason`). */
export const REJECT_REASON_KEYS = [
  'soldOut',
  'outOfZone',
  'saturated',
  'incompleteContact',
] as const;

/** Modal "Rechazar pedido": elegir un motivo rechaza el pedido y cierra detalle y modal. */
export function RejectModal({ orderId }: { orderId: string }) {
  const t = useTranslations('backoffice.orders.reject');
  const detail = useOrderDetail();
  const orders = useScopedOrders();
  const order = orders.data?.find((o) => o.id === orderId);
  const actions = useOrderActions(detail.closeReject);

  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      iconTone="coral"
      icon={<IconClose />}
      title={t('title')}
      description={order ? `${orderCode(order)} · ${order.customer.name}` : `#${orderId}`}
      onClose={detail.closeReject}
      footer={
        <button type="button" className="btn" onClick={detail.closeReject}>
          {t('back')}
        </button>
      }
    >
      <div className="sm" style={{ fontWeight: 700 }}>
        {t('hint')}
      </div>
      <div className="reasons">
        {REJECT_REASON_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="reason"
            disabled={!order || actions.pending}
            onClick={() => order && actions.reject(order, t(`reasons.${key}`))}
          >
            {t(`reasons.${key}`)}
          </button>
        ))}
      </div>
    </Modal>
  );
}
