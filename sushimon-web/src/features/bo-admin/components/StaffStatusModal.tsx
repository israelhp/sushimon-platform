'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconUserPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useSetStaffStatus } from '@/features/staff/hooks';
import type { AdminStaff } from '@/lib/data-access/models';
import { STAFF_REASON_MAX, staffServerError, validateStaffReason } from '../users-view';

/**
 * Confirmación de activar/desactivar a un empleado. Desactivar exige motivo (máx. 200) y corta su acceso en la
 * siguiente solicitud. El servidor rechaza desactivarse a uno mismo o dejar al sistema sin administrador (409).
 */
export function StaffStatusModal({ staff, onClose }: { staff: AdminStaff; onClose: () => void }) {
  const t = useTranslations('backoffice.users.statusModal');
  const tu = useTranslations('backoffice.users');
  const toast = useToast();
  const mutation = useSetStaffStatus();
  const activating = !staff.active;
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
    const problem = validateStaffReason(reason, activating);
    setReasonError(problem);
    setServerError('');
    if (problem) {
      reasonRef.current?.focus();
      return;
    }
    const trimmed = reason.trim();
    mutation.mutate(
      { id: staff.id, input: { active: activating, ...(trimmed ? { reason: trimmed } : {}) } },
      {
        onSuccess: () => {
          toast.notify(
            tu(activating ? 'toastActivated' : 'toastDeactivated', { name: staff.fullName }),
          );
          onClose();
        },
        onError: (err) => setServerError(staffServerError(err).message),
      },
    );
  };

  return (
    <Modal
      open
      zone="bo"
      size="narrow"
      title={t(activating ? 'activateTitle' : 'deactivateTitle')}
      description={staff.fullName}
      icon={<IconUserPlus />}
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
          {t(activating ? 'activateText' : 'deactivateText', { name: staff.fullName })}
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
            maxLength={STAFF_REASON_MAX + 50}
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
              style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
            >
              {reasonError}
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
