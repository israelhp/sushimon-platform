'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconCheckBold, IconUserPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useToast } from '@/components/ui/Toast';
import { useSaveUser } from '@/features/backoffice/hooks';
import { errorMessage } from '@/features/bo-orders/error-message';
import { cn } from '@/lib/cn';
import type { Branch, StaffUser } from '@/lib/data-access/models';
import {
  ALL_PERMISSIONS,
  ROLE_ORDER,
  emptyUserForm,
  toUserInput,
  toggled,
  userToForm,
  validateUserForm,
  withRole,
  type UserFormErrors,
  type UserFormField,
  type UserFormValues,
} from '../users-view';

export interface UserModalProps {
  /** Usuario a editar; sin él, alta. */
  user?: StaffUser;
  /** Sucursales activas elegibles. */
  branches: readonly Branch[];
  /** El usuario editado es la sesión actual. */
  isSelf?: boolean;
  onClose: () => void;
}

/**
 * Modal "Usuario" (alta y edición): nombre, correo, rol, sucursal y permisos. La validación de cliente solo orienta
 * (foco al primer campo inválido); el servidor vuelve a validar correo, rol y sucursal. Es DEMOSTRACIÓN: no envía correo.
 */
export function UserModal({ user, branches, isSelf = false, onClose }: UserModalProps) {
  const t = useTranslations('backoffice.users.modal');
  const tu = useTranslations('backoffice.users');
  const tr = useTranslations('backoffice.roles');
  const tp = useTranslations('backoffice.permissions');
  const toast = useToast();
  const save = useSaveUser();
  const firstBranchId = branches[0]?.id ?? '';
  const [values, setValues] = useState<UserFormValues>(() =>
    user ? userToForm(user) : emptyUserForm(firstBranchId),
  );
  const [errors, setErrors] = useState<UserFormErrors | null>(null);
  const [serverError, setServerError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const bannerId = `${formId}-error`;

  const invalid = (field: UserFormField) => !!errors?.fields.includes(field);
  const clear = () => {
    setErrors(null);
    setServerError('');
  };
  const patch = (next: Partial<UserFormValues>) => {
    setValues((v) => ({ ...v, ...next }));
    clear();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateUserForm(values);
    setErrors(found);
    if (found) {
      const first = found.fields[0];
      if (first === 'name') nameRef.current?.focus();
      else if (first === 'email') emailRef.current?.focus();
      else branchRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      return;
    }
    save.mutate(
      { id: user?.id, input: toUserInput(values) },
      {
        onSuccess: () => {
          toast.notify(tu(user ? 'toastUpdated' : 'toastCreated'));
          onClose();
        },
        onError: (err) => setServerError(errorMessage(err) || t('serverError')),
      },
    );
  };

  const bannerText = errors
    ? t(errors.reason === 'branch' ? 'branchInvalid' : 'invalid')
    : serverError;
  const describedBy = bannerText ? bannerId : undefined;
  const isAdmin = values.role === 'admin';

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      title={t(user ? 'titleEdit' : 'titleNew')}
      icon={<IconUserPlus />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} style={{ display: 'contents' }}>
        <div className="form-grid">
          <label className="field">
            <span className="flabel">{t('name')}</span>
            <input
              ref={nameRef}
              className="inp"
              value={values.name}
              autoComplete="off"
              onChange={(e) => patch({ name: e.target.value })}
              aria-invalid={invalid('name') ? true : undefined}
              aria-describedby={invalid('name') ? describedBy : undefined}
            />
          </label>
          <label className="field">
            <span className="flabel">{t('email')}</span>
            <input
              ref={emailRef}
              className="inp"
              type="email"
              value={values.email}
              autoComplete="off"
              onChange={(e) => patch({ email: e.target.value })}
              aria-invalid={invalid('email') ? true : undefined}
              aria-describedby={invalid('email') ? describedBy : undefined}
            />
          </label>
          <div className="field span-2">
            <span className="flabel">{t('role')}</span>
            <SegmentedControl
              zone="bo"
              label={t('roleGroup')}
              value={values.role}
              options={ROLE_ORDER.map((r) => ({ value: r, label: tr(r) }))}
              onChange={(role) => {
                setValues((v) => withRole(v, role, firstBranchId));
                clear();
              }}
            />
          </div>
          <div className="field span-2">
            <span className="flabel" id={`${formId}-branch`}>
              {t('branch')}
            </span>
            <div
              ref={branchRef}
              className="chips"
              role="group"
              aria-labelledby={`${formId}-branch`}
              aria-describedby={invalid('branchId') ? describedBy : undefined}
            >
              {[{ id: 'all', name: tu('all') }, ...branches].map((b) => {
                const on = values.branchId === b.id;
                const disabled = isAdmin ? b.id !== 'all' : b.id === 'all';
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={cn('chip', on && 'on')}
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() => patch({ branchId: b.id })}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="field">
          <span className="flabel" id={`${formId}-perms`}>
            {t('perms')}
          </span>
          <div className="sm muted" style={{ fontWeight: 600 }}>
            {t('permsHint')}
          </div>
          <div className="form-grid" role="group" aria-labelledby={`${formId}-perms`}>
            {ALL_PERMISSIONS.map((p) => {
              const on = values.permissions.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={cn('ckb', on && 'on')}
                  onClick={() => patch({ permissions: toggled(values.permissions, p) })}
                >
                  <span className="box">{on ? <IconCheckBold size="sm" /> : null}</span>
                  {tp(p)}
                </button>
              );
            })}
          </div>
        </div>

        {isSelf ? (
          <Banner zone="bo" tone="info" role="note">
            {t('selfNote')}
          </Banner>
        ) : null}
        {bannerText ? (
          <Banner zone="bo" tone="danger" role="alert" id={bannerId}>
            {bannerText}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
