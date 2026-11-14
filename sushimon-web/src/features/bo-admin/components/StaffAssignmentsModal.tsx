'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { IconUserPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useReplaceStaffAssignments } from '@/features/staff/hooks';
import type { AdminRole, AdminStaff } from '@/lib/data-access/models';
import { canGlobally } from '@/lib/permissions';
import {
  assignmentsChanged,
  assignmentsToDrafts,
  grantableRoles,
  staffServerError,
  toAssignmentInputs,
  validateAssignments,
  type AssignmentDraft,
  type StaffFormErrors,
} from '../users-view';
import { AssignmentsEditor } from './AssignmentsEditor';

/**
 * Edición de asignaciones rol + sucursal (`PUT /v1/admin/staff/{id}/assignments`, reemplazo completo). Valida lo
 * evidente antes de enviar; el servidor aplica la regla del subconjunto, el dominio del empleado y el último
 * administrador (403/404/409 visibles). Para ofrecer también los roles ya asignados que el actor no puede otorgar
 * (si los hubiera) el servidor responderá 403: aquí solo se ofrecen los otorgables.
 */
export function StaffAssignmentsModal({
  staff,
  roles,
  onClose,
}: {
  staff: AdminStaff;
  roles: readonly AdminRole[];
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.users.assignmentsModal');
  const tu = useTranslations('backoffice.users');
  const toast = useToast();
  const { branches, grants } = useShell();
  const mutation = useReplaceStaffAssignments();
  const [drafts, setDrafts] = useState<AssignmentDraft[]>(() => assignmentsToDrafts(staff));
  const [errors, setErrors] = useState<Pick<StaffFormErrors, 'assignments' | 'rows'>>({ rows: {} });
  const [serverError, setServerError] = useState('');
  const formId = useId();
  // Los roles actuales siempre deben poder mostrarse aunque no sean otorgables (el servidor decide al guardar).
  // Sucursales actuales del empleado que el actor ya no ve (p. ej. inactivas) se conservan como opción.
  const branchOptions = [
    ...branches,
    ...staff.assignments.flatMap((a) =>
      a.branch && !branches.some((b) => b.id === a.branch?.id)
        ? [{ id: a.branch.id, name: a.effective ? a.branch.name : `${a.branch.name} (inactiva)` }]
        : [],
    ),
  ];
  const offered = [
    ...grantableRoles(roles, grants),
    ...roles.filter(
      (r) =>
        staff.assignments.some((a) => a.role.id === r.id) &&
        !grantableRoles(roles, grants).some((g) => g.id === r.id),
    ),
  ];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    setServerError('');
    const found = validateAssignments(drafts, roles);
    setErrors(found);
    if (found.assignments || Object.keys(found.rows).length) return;
    if (!assignmentsChanged(drafts, staff)) {
      setServerError(t('noChanges'));
      return;
    }
    mutation.mutate(
      { id: staff.id, input: { assignments: toAssignmentInputs(drafts) } },
      {
        onSuccess: () => {
          toast.notify(tu('toastAssignments', { name: staff.fullName }));
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
      size="wide"
      title={t('title', { name: staff.fullName })}
      description={staff.email}
      icon={<IconUserPlus />}
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
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="form-grid">
        <p className="span-2 sm" style={{ margin: 0 }}>
          {t('intro')}
        </p>
        <AssignmentsEditor
          idPrefix={formId}
          drafts={drafts}
          roles={offered}
          branches={branchOptions}
          errors={errors}
          allowGlobal={
            canGlobally(grants, 'staff.assign_roles') ||
            staff.assignments.some((a) => a.role.code === 'admin')
          }
          onChange={(next) => {
            setDrafts(next);
            setErrors({ rows: {} });
            setServerError('');
          }}
        />
        {serverError ? (
          <Banner zone="bo" tone="danger" role="alert" className="span-2">
            {serverError}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
