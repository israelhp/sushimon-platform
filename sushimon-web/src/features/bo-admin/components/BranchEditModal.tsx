'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconStore } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useUpdateBranch } from '@/features/backoffice/hooks';
import { errorMessage } from '@/features/bo-orders/error-message';
import type { Branch } from '@/lib/data-access/models';
import {
  branchToForm,
  validateBranchForm,
  type BranchFormErrors,
  type BranchFormValues,
} from '../branches-view';

type FieldName = keyof BranchFormValues;

/** Modal "Editar sucursal": datos visibles de la tarjeta. Valida en cliente y enfoca el primer campo con error. */
export function BranchEditModal({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  const t = useTranslations('backoffice.branches.modal');
  const tb = useTranslations('backoffice.branches');
  const toast = useToast();
  const update = useUpdateBranch();
  const [values, setValues] = useState<BranchFormValues>(() => branchToForm(branch));
  const [errors, setErrors] = useState<BranchFormErrors>({});
  const [serverError, setServerError] = useState('');
  const refs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({});
  const formId = useId();
  const errId = (field: FieldName) => `${formId}-${field}-error`;

  const set = (field: FieldName) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateBranchForm(values);
    setErrors(found);
    const first = (['name', 'address', 'radiusKm'] as const).find((f) => found[f]);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    update.mutate(
      {
        id: branch.id,
        input: {
          name: values.name.trim(),
          zoneLabel: values.zoneLabel.trim(),
          address: values.address.trim(),
          phone: values.phone.trim(),
          hoursLabel: values.hoursLabel.trim(),
          radiusKm: Number(values.radiusKm),
        },
      },
      {
        onSuccess: () => {
          toast.notify(tb('toastSaved'));
          onClose();
        },
        onError: (err) => setServerError(errorMessage(err)),
      },
    );
  };

  const field = (name: FieldName, label: string, extra?: { hint?: string; type?: string }) => (
    <label className="field">
      <span className="flabel">{label}</span>
      <input
        ref={(el) => {
          refs.current[name] = el;
        }}
        className="inp"
        type={extra?.type ?? 'text'}
        inputMode={extra?.type === 'number' ? 'decimal' : undefined}
        value={values[name]}
        onChange={set(name)}
        aria-invalid={errors[name as keyof BranchFormErrors] ? true : undefined}
        aria-describedby={errors[name as keyof BranchFormErrors] ? errId(name) : undefined}
      />
      {extra?.hint ? (
        <span className="xs muted" style={{ fontWeight: 600 }}>
          {extra.hint}
        </span>
      ) : null}
      {errors[name as keyof BranchFormErrors] ? (
        <span
          id={errId(name)}
          className="xs"
          role="alert"
          style={{ color: 'var(--bo-red)', fontWeight: 700 }}
        >
          {errors[name as keyof BranchFormErrors]}
        </span>
      ) : null}
    </label>
  );

  return (
    <Modal
      open
      zone="bo"
      title={t('title')}
      description={branch.name}
      icon={<IconStore />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={update.isPending}
          >
            {update.isPending ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="form-grid">
        {field('name', t('name'))}
        {field('zoneLabel', t('zone'))}
        {field('address', t('address'))}
        {field('phone', t('phone'))}
        {field('hoursLabel', t('hours'), { hint: t('hoursHint') })}
        {field('radiusKm', t('radius'), { type: 'number' })}
        {serverError ? (
          <Banner zone="bo" tone="alert" role="alert" className="span-2">
            {serverError}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
