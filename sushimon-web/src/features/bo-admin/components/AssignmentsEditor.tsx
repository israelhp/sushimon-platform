'use client';

import { useTranslations } from 'next-intl';
import { IconClose, IconPlus } from '@/components/icons/bo';
import type { AdminRole, Branch } from '@/lib/data-access/models';
import {
  GLOBAL_BRANCH,
  MAX_ASSIGNMENTS,
  type AssignmentDraft,
  type StaffFormErrors,
} from '../users-view';

export interface AssignmentsEditorProps {
  idPrefix: string;
  drafts: readonly AssignmentDraft[];
  /** Roles que el actor puede ofrecer (regla del subconjunto, orientativa). */
  roles: readonly AdminRole[];
  /** Sucursales activas autorizadas para el actor. */
  branches: readonly Pick<Branch, 'id' | 'name'>[];
  errors?: Pick<StaffFormErrors, 'assignments' | 'rows'>;
  /** Si el actor puede otorgar alcance global (admin). */
  allowGlobal: boolean;
  disabled?: boolean;
  onChange: (next: AssignmentDraft[]) => void;
}

/** Filas rol + sucursal (1..20). El administrador es siempre global; el resto, una sucursal concreta. */
export function AssignmentsEditor({
  idPrefix,
  drafts,
  roles,
  branches,
  errors,
  allowGlobal,
  disabled,
  onChange,
}: AssignmentsEditorProps) {
  const t = useTranslations('backoffice.users.modal');
  const tr = useTranslations('backoffice.roles');
  const patch = (i: number, next: Partial<AssignmentDraft>) =>
    onChange(drafts.map((d, j) => (j === i ? { ...d, ...next } : d)));
  const roleLabel = (r: AdminRole) => (r.code in ROLE_KEYS ? tr(r.code as RoleKey) : r.name);

  return (
    <div className="field span-2">
      <span className="flabel" id={`${idPrefix}-label`}>
        {t('assignments')}
      </span>
      <div className="sm muted" style={{ fontWeight: 600 }}>
        {t('assignmentsHint')}
      </div>
      <ul
        aria-labelledby={`${idPrefix}-label`}
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}
      >
        {drafts.map((d, i) => {
          const role = roles.find((r) => r.id === d.roleId);
          const isAdmin = role?.code === 'admin';
          const rowError = errors?.rows[i];
          const errId = `${idPrefix}-row-${i}-error`;
          return (
            <li key={i}>
              <div className="row gap8" style={{ flexWrap: 'wrap' }}>
                <select
                  className="inp"
                  style={{ flex: '1 1 160px', width: 'auto' }}
                  aria-label={t('assignmentRole', { n: i + 1 })}
                  aria-invalid={rowError ? true : undefined}
                  aria-describedby={rowError ? errId : undefined}
                  value={d.roleId}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = roles.find((r) => r.id === e.target.value);
                    patch(i, {
                      roleId: e.target.value,
                      // El administrador es global; al salir de admin hay que elegir sucursal.
                      branchId:
                        next?.code === 'admin'
                          ? GLOBAL_BRANCH
                          : d.branchId === GLOBAL_BRANCH
                            ? ''
                            : d.branchId,
                    });
                  }}
                >
                  <option value="">{t('pickRole')}</option>
                  {roles
                    .filter((r) => r.code !== 'admin' || allowGlobal)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {roleLabel(r)}
                      </option>
                    ))}
                </select>
                {isAdmin ? (
                  <span className="btag" style={{ flex: '1 1 160px' }}>
                    {t('globalOnly')}
                  </span>
                ) : (
                  <select
                    className="inp"
                    style={{ flex: '1 1 160px', width: 'auto' }}
                    aria-label={t('assignmentBranch', { n: i + 1 })}
                    aria-invalid={rowError ? true : undefined}
                    aria-describedby={rowError ? errId : undefined}
                    value={d.branchId}
                    disabled={disabled}
                    onChange={(e) => patch(i, { branchId: e.target.value })}
                  >
                    <option value="">{t('pickBranch')}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('removeAssignment', { n: i + 1 })}
                  title={t('removeAssignment', { n: i + 1 })}
                  disabled={disabled || drafts.length <= 1}
                  onClick={() => onChange(drafts.filter((_, j) => j !== i))}
                >
                  <IconClose size="sm" />
                </button>
              </div>
              {rowError ? (
                <span
                  id={errId}
                  className="xs"
                  role="alert"
                  style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
                >
                  {rowError}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {errors?.assignments ? (
        <span className="xs" role="alert" style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}>
          {errors.assignments}
        </span>
      ) : null}
      <div>
        <button
          type="button"
          className="btn sm"
          disabled={disabled || drafts.length >= MAX_ASSIGNMENTS}
          onClick={() => onChange([...drafts, { roleId: '', branchId: '' }])}
        >
          <IconPlus size="sm" />
          {t('addAssignment')}
        </button>
      </div>
    </div>
  );
}

const ROLE_KEYS = { admin: 1, manager: 1, kitchen: 1, staff: 1 } as const;
type RoleKey = keyof typeof ROLE_KEYS;
