'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { IconRider } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import type { AdminDelivery } from '@/lib/data-access/models';
import { isStaleError } from '../delivery-model';
import { useDeliveryActions } from '../use-delivery-actions';

/**
 * Registrar el RETORNO del motorista (evento SEPARADO de la entrega): libera al motorista; no cambia el pedido ni su pago. Pide
 * confirmación porque es la única forma de liberarlo y queda en el historial con quien lo registró.
 */
export function ConfirmReturnModal({
  delivery,
  onClose,
}: {
  delivery: AdminDelivery;
  onClose: (result: 'done' | 'stale' | 'closed', note?: string) => void;
}) {
  const t = useTranslations('backoffice.deliveries.fleet.returnModal');
  const actions = useDeliveryActions();
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (actions.pending) return;
    setError(null);
    const result = await actions.run(
      { kind: 'return', id: delivery.id, expectedVersion: delivery.version },
      delivery.displayNumber,
    );
    if (result.ok) onClose('done');
    else if (isStaleError(result.error.kind)) onClose('stale', result.text);
    else if (result.text) setError(result.text);
  };

  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      role="alertdialog"
      icon={<IconRider />}
      iconTone="green"
      title={t('title')}
      description={`#${delivery.displayNumber}${delivery.rider ? ` · ${delivery.rider.fullName}` : ''}`}
      onClose={() => onClose('closed')}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onClose('closed')}>
            {t('back')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={actions.pending}
            aria-busy={actions.pending}
            onClick={() => void submit()}
          >
            {t('confirm')}
          </button>
        </>
      }
    >
      <p className="sm" style={{ fontWeight: 600 }}>
        {t('text', { name: delivery.rider?.fullName ?? '—' })}
      </p>
      <Banner zone="bo" tone="info" role="note">
        {t('note')}
      </Banner>
      {error ? (
        <Banner zone="bo" tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
    </Modal>
  );
}
