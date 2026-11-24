'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { IconCheck } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import type { AdminDelivery } from '@/lib/data-access/models';
import { isStaleError } from '../delivery-model';
import { useDeliveryActions } from '../use-delivery-actions';

/**
 * Marcar como ENTREGADO: el pedido pasa a «Entregado» y no se deshace, por eso pide confirmación (patrón de `ConfirmReturnModal`).
 * «Marcar recogido» NO la pide: es un paso rutinario del flujo y el servidor ya lo bloquea si el pedido no está listo. Envía
 * `expectedVersion`; un 409/404 cierra el modal y el detalle muestra el estado actual.
 */
export function ConfirmDeliveredModal({
  delivery,
  onClose,
}: {
  delivery: AdminDelivery;
  onClose: (result: 'done' | 'stale' | 'closed', note?: string) => void;
}) {
  const t = useTranslations('backoffice.deliveries.fleet.deliveredModal');
  const actions = useDeliveryActions();
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (actions.pending) return;
    setError(null);
    const result = await actions.run(
      { kind: 'delivered', id: delivery.id, expectedVersion: delivery.version },
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
      icon={<IconCheck />}
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
      <p className="sm fw6">{t('text', { code: delivery.displayNumber })}</p>
      <Banner zone="bo" tone="warning" role="note">
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
