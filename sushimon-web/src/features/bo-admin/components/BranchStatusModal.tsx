'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconStore } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useSetBranchStatus } from '@/features/branches/hooks';
import type { AdminBranch } from '@/lib/data-access/models';
import { branchServerError, REASON_MAX, validateStatusReason } from '../branches-view';

/**
 * Confirmación de cambio de estado ADMINISTRATIVO (activa/inactiva). Desactivar exige un motivo (máx. 200). No cancela
 * pedidos en curso: la política queda pendiente (F20/F22). No toca el horario ni la pausa operativa (F08).
 */
export function BranchStatusModal({
  branch,
  onClose,
}: {
  branch: AdminBranch;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.branches.statusModal');
  const tb = useTranslations('backoffice.branches');
  const toast = useToast();
  const mutation = useSetBranchStatus();
  const activating = !branch.active;
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [serverError, setServerError] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();
  const errId = `${formId}-reason-error`;
  const hintId = `${formId}-reason-hint`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    const problem = validateStatusReason(reason, activating);
    setReasonError(problem);
    setServerError('');
    if (problem) {
      reasonRef.current?.focus();
      return;
    }
    const trimmed = reason.trim();
    mutation.mutate(
      { id: branch.id, input: { active: activating, ...(trimmed ? { reason: trimmed } : {}) } },
      {
        onSuccess: () => {
          toast.notify(
            tb(activating ? 'toastActivated' : 'toastDeactivated', { name: branch.name }),
          );
          onClose();
        },
        onError: (err) => setServerError(branchServerError(err).message),
      },
    );
  };

  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      title={t(activating ? 'activateTitle' : 'deactivateTitle')}
      description={branch.name}
      icon={<IconStore />}
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
          {t(activating ? 'activateText' : 'deactivateText', { name: branch.name })}
        </p>
        <div className="field span-2">
          <label className="flabel" htmlFor={`${formId}-reason`}>
            {t(activating ? 'reasonOptional' : 'reason')}
          </label>
          <textarea
            id={`${formId}-reason`}
            ref={reasonRef}
            className="inp"
            rows={3}
            maxLength={REASON_MAX + 50}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError('');
              setServerError('');
            }}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${errId} ${hintId}` : hintId}
          />
          <span id={hintId} className="xs muted" style={{ fontWeight: 600 }}>
            {t('reasonHint')}
          </span>
          {reasonError ? (
            <span
              id={errId}
              className="xs"
              role="alert"
              style={{ color: 'var(--bo-red)', fontWeight: 700 }}
            >
              {reasonError}
            </span>
          ) : null}
        </div>
        {serverError ? (
          <Banner zone="bo" tone="alert" role="alert" className="span-2">
            {serverError}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
