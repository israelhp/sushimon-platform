'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconUserPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useCreateStaff, useUpdateStaff } from '@/features/staff/hooks';
import { canGlobally } from '@/lib/permissions';
import type { AdminRole, AdminStaff } from '@/lib/data-access/models';
import {
  emptyStaffForm,
  firstStaffError,
  grantableRoles,
  hasFormErrors,
  staffServerError,
  staffToForm,
  toCreateStaffRequest,
  toUpdateStaffRequest,
  validateStaffForm,
  type StaffFormErrors,
  type StaffFormValues,
} from '../users-view';
import { AssignmentsEditor } from './AssignmentsEditor';

export interface UserModalProps {
  /** Empleado a editar; sin él, alta (preautorización). */
  staff?: AdminStaff;
  /** Roles del catálogo (`GET /v1/admin/roles`). */
  roles: readonly AdminRole[];
  /** El empleado editado es la sesión actual (solo puede cambiar su nombre). */
  isSelf?: boolean;
  onClose: () => void;
}

/**
 * Modal "Usuario": alta (nombre, correo, asignaciones rol + sucursal múltiples) y edición (nombre y correo; las
 * asignaciones y el estado tienen su propio flujo). Preautoriza: no crea cuenta ni envía correo. La validación de
 * cliente solo orienta; el servidor valida permisos, alcance y unicidad (400/403/404/409 se muestran aquí).
 */
export function UserModal({ staff, roles, isSelf = false, onClose }: UserModalProps) {
  const t = useTranslations('backoffice.users.modal');
  const tu = useTranslations('backoffice.users');
  const toast = useToast();
  const { branches, grants } = useShell();
  const create = useCreateStaff();
  const update = useUpdateStaff();
  const editing = Boolean(staff);
  const emailLocked = staff?.identityStatus === 'LINKED' || isSelf;
  const [values, setValues] = useState<StaffFormValues>(() =>
    staff ? staffToForm(staff) : emptyStaffForm(),
  );
  const [errors, setErrors] = useState<StaffFormErrors>({ rows: {} });
  const [serverError, setServerError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  const pending = create.isPending || update.isPending;
  const offered = grantableRoles(roles, grants);

  const clear = () => {
    setErrors({ rows: {} });
    setServerError('');
  };
  const patch = (next: Partial<StaffFormValues>) => {
    setValues((v) => ({ ...v, ...next }));
    clear();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateStaffForm(values, roles, editing ? 'edit' : 'create', emailLocked);
    setErrors(found);
    setServerError('');
    if (hasFormErrors(found)) {
      const first = firstStaffError(found);
      if (first === 'fullName') nameRef.current?.focus();
      else if (first === 'email') emailRef.current?.focus();
      else formRef.current?.querySelector<HTMLElement>('select:not(:disabled)')?.focus();
      return;
    }
    const onError = (err: unknown) => {
      const mapped = staffServerError(err);
      setErrors({
        rows: {},
        fullName: mapped.fields.fullName,
        email: mapped.fields.email,
        assignments: mapped.fields.assignments,
      });
      setServerError(mapped.message);
    };
    if (staff) {
      const input = toUpdateStaffRequest(values, staff);
      if (!input) {
        onClose();
        return;
      }
      update.mutate(
        { id: staff.id, input },
        {
          onSuccess: () => {
            toast.notify(tu('toastUpdated'));
            onClose();
          },
          onError,
        },
      );
    } else {
      create.mutate(toCreateStaffRequest(values), {
        onSuccess: (created) => {
          toast.notify(tu('toastCreated', { name: created.fullName }));
          onClose();
        },
        onError,
      });
    }
  };

  const errorId = `${formId}-error`;
  const emailHint = emailLocked ? t('emailLocked') : t('emailHint');

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      title={t(editing ? 'titleEdit' : 'titleNew')}
      description={editing ? staff?.email : t('description')}
      icon={<IconUserPlus />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
            {pending ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <form id={formId} ref={formRef} noValidate onSubmit={submit} className="form-grid">
        <div className="field">
          <label className="flabel" htmlFor={`${formId}-name`}>
            {t('name')}
          </label>
          <input
            id={`${formId}-name`}
            ref={nameRef}
            className="inp"
            value={values.fullName}
            autoComplete="off"
            onChange={(e) => patch({ fullName: e.target.value })}
            aria-invalid={errors.fullName ? true : undefined}
            aria-describedby={errors.fullName ? `${formId}-name-error` : undefined}
          />
          {errors.fullName ? (
            <span
              id={`${formId}-name-error`}
              className="xs"
              role="alert"
              style={{ color: 'var(--bo-red)', fontWeight: 700 }}
            >
              {errors.fullName}
            </span>
          ) : null}
        </div>
        <div className="field">
          <label className="flabel" htmlFor={`${formId}-email`}>
            {t('email')}
          </label>
          <input
            id={`${formId}-email`}
            ref={emailRef}
            className="inp"
            type="email"
            value={values.email}
            autoComplete="off"
            readOnly={editing && emailLocked}
            onChange={(e) => patch({ email: e.target.value })}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={`${formId}-email-hint${errors.email ? ` ${formId}-email-error` : ''}`}
          />
          <span id={`${formId}-email-hint`} className="xs muted" style={{ fontWeight: 600 }}>
            {emailHint}
          </span>
          {errors.email ? (
            <span
              id={`${formId}-email-error`}
              className="xs"
              role="alert"
              style={{ color: 'var(--bo-red)', fontWeight: 700 }}
            >
              {errors.email}
            </span>
          ) : null}
        </div>

        {editing ? null : (
          <>
            <AssignmentsEditor
              idPrefix={formId}
              drafts={values.assignments}
              roles={offered}
              branches={branches}
              errors={errors}
              allowGlobal={canGlobally(grants, 'staff.assign_roles')}
              onChange={(assignments) => patch({ assignments })}
            />
            <div className="field span-2">
              <span className="flabel">{t('initialStatus')}</span>
              <span className="sm" style={{ fontWeight: 700 }}>
                {t('initialActive')}
              </span>
              <span className="xs muted" style={{ fontWeight: 600 }}>
                {t('initialNote')}
              </span>
            </div>
          </>
        )}

        {isSelf ? (
          <Banner zone="bo" tone="info" role="note" className="span-2">
            {t('selfNote')}
          </Banner>
        ) : null}
        <p className="xs muted span-2" style={{ margin: 0, fontWeight: 600 }}>
          {t('mfaNote')}
        </p>
        {serverError ? (
          <Banner zone="bo" tone="danger" role="alert" id={errorId} className="span-2">
            {serverError}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
