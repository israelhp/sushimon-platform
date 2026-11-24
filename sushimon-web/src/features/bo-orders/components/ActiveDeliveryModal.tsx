'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { IconClose } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { actionEnabled, validateDeliveryReason } from '@/features/bo-deliveries/delivery-model';
import { useAdminDeliveryList } from '@/features/bo-deliveries/hooks';
import { useDeliveryActions } from '@/features/bo-deliveries/use-delivery-actions';
import type { AdminOrderSummary } from '@/lib/data-access/models';
import { REASON_MAX } from '../admin-orders-model';
import { useAdminOrderActions } from '../use-admin-order-actions';
import type { ReasonKind } from './ReasonModal';

const OPEN_BLOCKING = ['pending', 'assigned', 'picked_up'] as const;
const FILTERS = { status: OPEN_BLOCKING, limit: 100 } as const;

/**
 * 409 `ORDER_HAS_ACTIVE_DELIVERY` (spec 029 §6.3): el pedido no se cancela ni se rechaza con una entrega abierta. Se ofrece
 * «Cancelar entrega y luego el pedido» en DOS pasos explícitos y NO atómicos: (1) cancelar la entrega, (2) cancelar el pedido. Si el
 * paso 2 falla, la entrega ya quedó cancelada y se dice. No se crea ni se reabre ninguna entrega aquí (solo se LEE la abierta).
 */
export function ActiveDeliveryModal({
  order,
  kind,
  initialReason,
  onClose,
}: {
  order: Pick<AdminOrderSummary, 'id' | 'status' | 'displayNumber' | 'branchId' | 'customerName'>;
  kind: ReasonKind;
  initialReason: string;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.orders.live.activeDelivery');
  const tr = useTranslations('backoffice.orders.live.reason');
  const deliveryActions = useDeliveryActions();
  const orderActions = useAdminOrderActions();
  const list = useAdminDeliveryList({ branchId: order.branchId, ...FILTERS }, { poll: false });
  const delivery = list.items.find((d) => d.orderId === order.id);
  const [reason, setReason] = useState(initialReason);
  const [deliveryCancelled, setDeliveryCancelled] = useState(false);
  const [orderCancelled, setOrderCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const id = setTimeout(() => fieldRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  const problem = validateDeliveryReason(reason, true);
  const busy = deliveryActions.pending || orderActions.pending;
  const canCancelDelivery = delivery ? actionEnabled(delivery, 'cancel') : false;

  const cancelDelivery = async () => {
    if (!delivery || problem || busy) return;
    setError(null);
    const result = await deliveryActions.run(
      { kind: 'cancel', id: delivery.id, expectedVersion: delivery.version, reason: reason.trim() },
      order.displayNumber,
    );
    if (result.ok) setDeliveryCancelled(true);
    else if (result.text) setError(result.text);
  };

  const cancelOrder = async () => {
    if (!deliveryCancelled || problem || busy) return;
    setError(null);
    const result = await orderActions.run(order, kind, reason.trim());
    if (result.ok) setOrderCancelled(true);
    else setError(t('step2Failed', { message: result.text }));
  };

  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      role="alertdialog"
      iconTone="coral"
      icon={<IconClose />}
      title={t('title')}
      description={`#${order.displayNumber} · ${order.customerName}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('close')}
        </button>
      }
    >
      <p className="sm fw6">{t('text', { code: order.displayNumber })}</p>
      {list.isLoading ? (
        <div role="status" aria-busy="true" aria-label={t('loading')}>
          <Skeleton zone="bo" className="h-11 rounded-[10px]" />
        </div>
      ) : !delivery && !deliveryCancelled ? (
        <Banner zone="bo" tone="warning" role="alert">
          {t('notFound')}
        </Banner>
      ) : (
        <>
          <div className="field">
            <label htmlFor={fieldId} className="flabel">
              {t('reason')}
            </label>
            <textarea
              id={fieldId}
              ref={fieldRef}
              className="inp"
              rows={3}
              value={reason}
              disabled={deliveryCancelled}
              aria-invalid={problem !== null}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="xs muted fw6">
              {t('pii')}{' '}
              <span className="num">
                {tr('counter', { count: reason.trim().length, max: REASON_MAX })}
              </span>
            </div>
          </div>
          {!canCancelDelivery && !deliveryCancelled ? (
            <Banner zone="bo" tone="info" role="note">
              {t('notCancellable')}
            </Banner>
          ) : null}
          <ol className="active-steps" aria-live="polite">
            <li>
              <span className="strong">{t('step1')}</span>
              {deliveryCancelled ? (
                <span className="xs fw7"> · {t('step1Done')}</span>
              ) : (
                <button
                  type="button"
                  className="btn sm btn-primary block"
                  disabled={busy || problem !== null || !canCancelDelivery}
                  aria-busy={deliveryActions.pending}
                  onClick={() => void cancelDelivery()}
                >
                  {t('cancelDelivery')}
                </button>
              )}
            </li>
            <li>
              <span className="strong">{t('step2')}</span>
              {orderCancelled ? (
                <span className="xs fw7"> · {t('step2Done')}</span>
              ) : (
                <button
                  type="button"
                  className="btn sm btn-primary block"
                  disabled={busy || !deliveryCancelled || problem !== null}
                  aria-busy={orderActions.pending}
                  onClick={() => void cancelOrder()}
                >
                  {t('cancelOrder')}
                </button>
              )}
            </li>
          </ol>
        </>
      )}
      {error ? (
        <Banner zone="bo" tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
    </Modal>
  );
}
