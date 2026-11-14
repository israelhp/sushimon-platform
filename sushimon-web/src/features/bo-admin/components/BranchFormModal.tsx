'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconStore } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useCreateBranch, useUpdateBranch } from '@/features/branches/hooks';
import type { AdminBranch } from '@/lib/data-access/models';
import {
  branchServerError,
  branchToForm,
  emptyBranchForm,
  firstBranchError,
  toCreateRequest,
  toUpdateRequest,
  validateBranchForm,
  type BranchFormErrors,
  type BranchFormField,
  type BranchFormValues,
} from '../branches-view';

/**
 * Alta (sin `branch`) y edición (con `branch`) de una sucursal — F07. En edición el código es de solo lectura
 * (inmutable) y solo se envían los campos modificados. Valida en cliente como el contrato y muestra los errores
 * del servidor (400 con detalles, 403, 404, 409 de código duplicado) sin cerrar el modal.
 */
export function BranchFormModal({
  branch,
  onClose,
}: {
  branch?: AdminBranch;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.branches.modal');
  const tb = useTranslations('backoffice.branches');
  const toast = useToast();
  const create = useCreateBranch();
  const update = useUpdateBranch();
  const editing = !!branch;
  const pending = create.isPending || update.isPending;
  const [values, setValues] = useState<BranchFormValues>(() =>
    branch ? branchToForm(branch) : emptyBranchForm(),
  );
  const [errors, setErrors] = useState<BranchFormErrors>({});
  const [serverError, setServerError] = useState('');
  const refs = useRef<Partial<Record<BranchFormField, HTMLInputElement | null>>>({});
  const formId = useId();
  const errId = (field: BranchFormField) => `${formId}-${field}-error`;
  const hintId = (field: BranchFormField) => `${formId}-${field}-hint`;
  const inputId = (field: BranchFormField) => `${formId}-${field}`;

  const set = (field: BranchFormField) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError('');
  };

  const fail = (error: unknown) => {
    const { message, fields } = branchServerError(error);
    setErrors(fields);
    setServerError(message);
    const first = firstBranchError(fields);
    if (first) refs.current[first]?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateBranchForm(values, editing ? 'edit' : 'create');
    setErrors(found);
    setServerError('');
    const first = firstBranchError(found);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    if (branch) {
      const patch = toUpdateRequest(values, branch);
      if (!patch) {
        toast.notify(tb('toastNoChanges'));
        onClose();
        return;
      }
      update.mutate(
        { id: branch.id, input: patch },
        {
          onSuccess: () => {
            toast.notify(tb('toastSaved'));
            onClose();
          },
          onError: fail,
        },
      );
      return;
    }
    create.mutate(toCreateRequest(values), {
      onSuccess: () => {
        toast.notify(tb('toastCreated'));
        onClose();
      },
      onError: fail,
    });
  };

  const field = (
    name: BranchFormField,
    label: string,
    opts: {
      hint?: string;
      readOnly?: boolean;
      className?: string;
      inputMode?: 'decimal' | 'tel';
    } = {},
  ) => {
    const error = errors[name];
    const describedBy = [error ? errId(name) : null, opts.hint ? hintId(name) : null]
      .filter(Boolean)
      .join(' ');
    return (
      <div className={`field ${opts.className ?? ''}`.trim()}>
        <label className="flabel" htmlFor={inputId(name)}>
          {label}
        </label>
        <input
          id={inputId(name)}
          ref={(el) => {
            refs.current[name] = el;
          }}
          className="inp"
          type="text"
          inputMode={opts.inputMode}
          autoComplete="off"
          value={values[name]}
          onChange={set(name)}
          readOnly={opts.readOnly}
          aria-readonly={opts.readOnly || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        {opts.hint ? (
          <span id={hintId(name)} className="xs muted" style={{ fontWeight: 600 }}>
            {opts.hint}
          </span>
        ) : null}
        {error ? (
          <span
            id={errId(name)}
            className="xs"
            role="alert"
            style={{ color: 'var(--bo-red)', fontWeight: 700 }}
          >
            {error}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <Modal
      open
      zone="bo"
      title={editing ? t('editTitle') : t('createTitle')}
      description={branch?.name}
      icon={<IconStore />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
            {pending ? t('saving') : editing ? t('save') : t('create')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="form-grid">
        {field('code', t('code'), {
          hint: editing ? t('codeLocked') : t('codeHint'),
          readOnly: editing,
          className: 'span-2',
        })}
        {field('name', t('name'), { className: 'span-2' })}
        {field('address', t('address'), { className: 'span-2' })}
        {field('phone', t('phone'), {
          hint: t('phoneHint'),
          inputMode: 'tel',
          className: 'span-2',
        })}
        {field('latitude', t('latitude'), { inputMode: 'decimal' })}
        {field('longitude', t('longitude'), { inputMode: 'decimal' })}
        <span className="xs muted span-2" style={{ fontWeight: 600 }}>
          {t('coordsHint')}
        </span>
        {serverError ? (
          <Banner zone="bo" tone="alert" role="alert" className="span-2">
            {serverError}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
