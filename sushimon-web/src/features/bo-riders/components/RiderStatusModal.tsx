'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconRider } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { AdminRiderSummary } from '@/lib/data-access/models';
import { useSetRiderStatus } from '../hooks';
import { RIDER_REASON_MAX, validateRiderReason } from '../rider-model';
import { useRiderErrorText } from '../use-rider-text';

/**
 * Confirmación de activar/desactivar. Desactivar lo deja NO disponible y el servidor lo rechaza con una entrega activa
 * (409 `RIDER_HAS_ACTIVE_DELIVERY`); reactivar NO lo marca disponible. Motivo opcional (≤ 200) que va a la auditoría.
 */
export function RiderStatusModal({
  rider,
  onClose,
}: {
  rider: AdminRiderSummary;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.riders.status');
  const tr = useTranslations('backoffice.riders');
  const toast = useToast();
  const errorText = useRiderErrorText();
  const mutation = useSetRiderStatus();
  const activating = !rider.active;
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [serverError, setServerError] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    const found = validateRiderReason(reason);
    setReasonError(found);
    setServerError('');
    if (found) {
      reasonRef.current?.focus();
      return;
    }
    const trimmed = reason.trim();
    mutation.mutate(
      { id: rider.id, input: { active: activating, ...(trimmed ? { reason: trimmed } : {}) } },
      {
        onSuccess: () => {
          toast.notify(
            tr(activating ? 'toastActivated' : 'toastDeactivated', { name: rider.fullName }),
          );
          onClose();
        },
        onError: (error) => setServerError(errorText(error)),
      },
    );
  };

  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      title={t(activating ? 'activateTitle' : 'deactivateTitle')}
      description={rider.fullName}
      icon={<IconRider />}
      iconTone={activating ? 'green' : 'coral'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={activating ? 'btn btn-primary' : 'btn danger'}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? t('saving')
              : t(activating ? 'confirmActivate' : 'confirmDeactivate')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="form-grid">
        <p className="span-2 sm" style={{ margin: 0 }}>
          {t(activating ? 'activateText' : 'deactivateText', { name: rider.fullName })}
        </p>
        <div className="field span-2">
          <label className="flabel" htmlFor={`${formId}-reason`}>
            {t('reason')}
          </label>
          <textarea
            id={`${formId}-reason`}
            ref={reasonRef}
            className="inp"
            rows={3}
            maxLength={RIDER_REASON_MAX + 50}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError('');
              setServerError('');
            }}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={`${formId}-hint${reasonError ? ` ${formId}-err` : ''}`}
          />
          <span id={`${formId}-hint`} className="xs muted" style={{ fontWeight: 600 }}>
            {t('reasonHint')}
          </span>
          {reasonError ? (
            <span
              id={`${formId}-err`}
              className="xs"
              role="alert"
              style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
            >
              {tr('errors.invalid')}
            </span>
          ) : null}
        </div>
        {serverError ? (
          <Banner zone="bo" tone="danger" role="alert" className="span-2">
            {serverError}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
