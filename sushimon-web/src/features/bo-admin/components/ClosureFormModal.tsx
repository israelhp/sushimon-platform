'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconCalendar } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useCreateBranchClosure, useUpdateBranchClosure } from '@/features/branch-schedule/hooks';
import type { AdminBranch, BranchClosure } from '@/lib/data-access/models';
import { isoToLocalInput } from '@/lib/time';
import {
  CLOSURE_REASON_MAX,
  closureServerError,
  emptyClosureForm,
  firstClosureError,
  startsNow,
  toCreateClosure,
  toUpdateClosure,
  validateClosureForm,
  type ClosureEditMode,
  type ClosureField,
  type ClosureFormErrors,
  type ClosureFormValues,
} from '../branch-schedule-view';
import { ConfirmModal } from './ConfirmModal';

/**
 * Alta y edición de un cierre extraordinario (F08, D7/D8). Futuro: inicio, fin y motivo editables. En curso: el inicio
 * queda fijo y el fin solo se puede ACORTAR. `now` es la hora del servidor; el servidor revalida todo. Un cierre que
 * empieza ya (o la edición de uno en curso) pide una confirmación adicional.
 */
export function ClosureFormModal({
  branch,
  closure,
  now,
  onClose,
}: {
  branch: AdminBranch;
  closure?: BranchClosure;
  now: Date | null;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.branchSchedule.closures.form');
  const toast = useToast();
  const create = useCreateBranchClosure();
  const update = useUpdateBranchClosure();
  const mode: ClosureEditMode = !closure
    ? 'create'
    : closure.status === 'active'
      ? 'active'
      : 'upcoming';
  const pending = create.isPending || update.isPending;
  const [values, setValues] = useState<ClosureFormValues>(() =>
    closure
      ? {
          startsAt: isoToLocalInput(closure.startsAt),
          endsAt: isoToLocalInput(closure.endsAt),
          reason: closure.reason ?? '',
        }
      : emptyClosureForm(),
  );
  const [errors, setErrors] = useState<ClosureFormErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const refs = useRef<Partial<Record<ClosureField, HTMLInputElement | HTMLTextAreaElement | null>>>(
    {},
  );
  const formId = useId();
  const errId = (f: ClosureField) => `${formId}-${f}-err`;

  const set = (field: ClosureField) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError('');
  };

  const fail = (error: unknown) => {
    const parsed = closureServerError(error);
    setErrors(parsed.fields);
    setServerError(parsed.message);
    setBusy(!!parsed.busy);
    setConfirming(false);
    const first = firstClosureError(parsed.fields);
    if (first) refs.current[first]?.focus();
  };

  const run = () => {
    if (closure) {
      const patch = toUpdateClosure(values, closure, mode === 'active');
      if (!patch) {
        toast.notify(t('toastNoChanges'));
        onClose();
        return;
      }
      update.mutate(
        { id: branch.id, closureId: closure.id, input: patch },
        {
          onSuccess: () => {
            toast.notify(t('toastUpdated'));
            onClose();
          },
          onError: fail,
        },
      );
      return;
    }
    create.mutate(
      { id: branch.id, input: toCreateClosure(values) },
      {
        onSuccess: () => {
          toast.notify(t('toastCreated'));
          onClose();
        },
        onError: fail,
      },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateClosureForm(values, mode, now, closure);
    setErrors(found);
    setServerError('');
    setBusy(false);
    const first = firstClosureError(found);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    // Cambios sensibles: empieza ya (la sucursal deja de recibir pedidos) o se modifica un cierre en curso.
    if (startsNow(values, now) || mode === 'active') {
      setConfirming(true);
      return;
    }
    run();
  };

  const dateField = (name: 'startsAt' | 'endsAt', label: string, locked = false) => (
    <div className="field">
      <label className="flabel" htmlFor={`${formId}-${name}`}>
        {label}
      </label>
      <input
        id={`${formId}-${name}`}
        ref={(el) => {
          refs.current[name] = el;
        }}
        className="inp"
        type="datetime-local"
        value={values[name]}
        onChange={set(name)}
        disabled={locked}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? errId(name) : undefined}
      />
      {errors[name] ? (
        <span
          id={errId(name)}
          className="xs"
          role="alert"
          style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
        >
          {errors[name]}
        </span>
      ) : null}
    </div>
  );

  return (
    <>
      <Modal
        open
        zone="bo"
        title={closure ? t('editTitle') : t('createTitle')}
        description={branch.name}
        icon={<IconCalendar />}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              {t('cancel')}
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
              {pending ? t('saving') : closure ? t('save') : t('create')}
            </button>
          </>
        }
      >
        <form id={formId} noValidate onSubmit={submit} className="form-grid">
          {dateField('startsAt', t('startsAt'), mode === 'active')}
          {dateField('endsAt', mode === 'active' ? t('endsAtShorten') : t('endsAt'))}
          {mode === 'active' ? (
            <span className="xs muted span-2" style={{ fontWeight: 600 }}>
              {t('startLocked')}
            </span>
          ) : null}
          <div className="field span-2">
            <label className="flabel" htmlFor={`${formId}-reason`}>
              {t('reason')}
            </label>
            <textarea
              id={`${formId}-reason`}
              ref={(el) => {
                refs.current.reason = el;
              }}
              className="inp"
              rows={3}
              maxLength={CLOSURE_REASON_MAX + 50}
              value={values.reason}
              onChange={set('reason')}
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={errors.reason ? errId('reason') : `${formId}-reason-hint`}
            />
            <span id={`${formId}-reason-hint`} className="xs muted" style={{ fontWeight: 600 }}>
              {t('reasonHint', { max: CLOSURE_REASON_MAX })}
            </span>
            {errors.reason ? (
              <span
                id={errId('reason')}
                className="xs"
                role="alert"
                style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
              >
                {errors.reason}
              </span>
            ) : null}
          </div>
          {serverError ? (
            <Banner zone="bo" tone="alert" role="alert" className="span-2">
              {serverError}
              {busy ? (
                <>
                  {' '}
                  <button type="button" className="link-btn" disabled={pending} onClick={run}>
                    {t('retry')}
                  </button>
                </>
              ) : null}
            </Banner>
          ) : null}
        </form>
      </Modal>
      {confirming ? (
        <ConfirmModal
          title={t(mode === 'active' ? 'confirmActiveTitle' : 'confirmNowTitle')}
          description={branch.name}
          icon={<IconCalendar />}
          danger
          confirmLabel={t('confirmAction')}
          cancelLabel={t('confirmBack')}
          pendingLabel={t('saving')}
          pending={pending}
          onConfirm={run}
          onClose={() => setConfirming(false)}
        >
          {t(mode === 'active' ? 'confirmActiveText' : 'confirmNowText')}
        </ConfirmModal>
      ) : null}
    </>
  );
}
