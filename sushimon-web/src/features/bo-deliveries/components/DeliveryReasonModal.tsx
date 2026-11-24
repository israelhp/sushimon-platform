'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { IconClose } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import type { AdminDelivery } from '@/lib/data-access/models';
import { DELIVERY_REASON_MAX, isStaleError, validateDeliveryReason } from '../delivery-model';
import { useDeliveryActions } from '../use-delivery-actions';

export type DeliveryReasonKind = 'cancel' | 'unassign';

/**
 * Cancelar la entrega (motivo OBLIGATORIO) o quitar al motorista (motivo opcional). El motivo es texto INTERNO: el modal avisa que
 * no se escriban datos personales. Envía `expectedVersion` (la `version` que la persona vio). Un 409/404 cierra el modal y el detalle
 * muestra el estado actual y qué hacer; los demás errores se explican aquí y la persona decide.
 */
export function DeliveryReasonModal({
  kind,
  delivery,
  onClose,
}: {
  kind: DeliveryReasonKind;
  delivery: AdminDelivery;
  /** `done` = se aplicó (o ya estaba aplicado); `stale` = la entrega cambió (texto para el detalle); `closed` = sin enviar. */
  onClose: (result: 'done' | 'stale' | 'closed', note?: string) => void;
}) {
  const t = useTranslations(`backoffice.deliveries.fleet.reasonModal.${kind}`);
  const tc = useTranslations('backoffice.deliveries.fleet.reasonModal');
  const actions = useDeliveryActions();
  const required = kind === 'cancel';
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const fieldId = useId();
  const helpId = useId();
  const errorId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const id = setTimeout(() => fieldRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  const problem = validateDeliveryReason(value, required);
  const showError = touched && problem !== null;
  const length = value.trim().length;

  const submit = async () => {
    setTouched(true);
    if (problem !== null || actions.pending) return;
    setServerError(null);
    const reason = value.trim();
    const result = await actions.run(
      kind === 'cancel'
        ? { kind: 'cancel', id: delivery.id, expectedVersion: delivery.version, reason }
        : {
            kind: 'unassign',
            id: delivery.id,
            expectedVersion: delivery.version,
            ...(reason ? { reason } : {}),
          },
      delivery.displayNumber,
    );
    if (result.ok) onClose('done');
    else if (isStaleError(result.error.kind)) onClose('stale', result.text);
    else if (result.text) setServerError(result.text);
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
      description={`#${delivery.displayNumber}${delivery.rider ? ` · ${delivery.rider.fullName}` : ''}`}
      onClose={() => onClose('closed')}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onClose('closed')}>
            {tc('back')}
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
        {t('consequences')}
      </p>
      <div className="field">
        <label htmlFor={fieldId} className="flabel">
          {required ? tc('labelRequired') : tc('labelOptional')}
        </label>
        <textarea
          id={fieldId}
          ref={fieldRef}
          className="inp"
          rows={3}
          value={value}
          required={required}
          aria-required={required}
          aria-invalid={showError}
          aria-describedby={`${helpId}${showError ? ` ${errorId}` : ''}`}
          onChange={(e) => {
            setValue(e.target.value);
            setServerError(null);
          }}
          onBlur={() => setTouched(true)}
        />
        <div id={helpId} className="xs muted" style={{ fontWeight: 600 }}>
          {tc('pii')}{' '}
          <span className="num">{tc('counter', { count: length, max: DELIVERY_REASON_MAX })}</span>
        </div>
        {showError ? (
          <div
            id={errorId}
            role="alert"
            className="xs"
            style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
          >
            {tc(`error.${problem}`)}
          </div>
        ) : null}
      </div>
      {serverError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {serverError}
        </Banner>
      ) : null}
    </Modal>
  );
}
