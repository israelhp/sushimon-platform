'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { IconCheckBold } from '@/components/icons/bo';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { isForbidden } from '@/features/bo-orders/error-message';
import {
  useAdminRoles,
  usePermissionCatalog,
  useReplaceRolePermissions,
} from '@/features/staff/hooks';
import { cn } from '@/lib/cn';
import type { AdminRole, StaffRole } from '@/lib/data-access/models';
import {
  diffPermissions,
  hasPermissionChanges,
  rolePermissionsError,
  setModule,
  togglePermission,
} from '../roles-view';

const KNOWN_ROLES: readonly string[] = ['admin', 'manager', 'kitchen', 'staff'];
const KNOWN_MODULES = [
  'dashboard',
  'branches',
  'staff',
  'roles',
  'catalog',
  'promotions',
  'banners',
  'orders',
  'payments',
  'riders',
  'deliveries',
  'incidents',
  'reports',
  'audit',
  'settings',
] as const;
type ModuleKey = (typeof KNOWN_MODULES)[number];

/**
 * Roles y permisos (F03): lista de roles, permisos agrupados por módulo y edición de los permisos de un rol (solo con
 * `roles.manage`; `admin` y los roles del sistema son de solo lectura). Avisa a cuántos empleados activos afecta el
 * cambio. La UI solo orienta: el servidor exige alcance global sobre cada permiso añadido (403) y rechaza roles del
 * sistema (409).
 */
export function RolesScreen() {
  const t = useTranslations('backoffice.rolesScreen');
  const tu = useTranslations('ui');
  const tr = useTranslations('backoffice.roles');
  const trd = useTranslations('backoffice.roleDescriptions');
  const tm = useTranslations('backoffice.permissionModules');
  const toast = useToast();
  const { can } = useShell();
  const roles = useAdminRoles();
  const catalog = usePermissionCatalog();
  const save = useReplaceRolePermissions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  if (isForbidden(roles.error) || isForbidden(catalog.error))
    return <ForbiddenScreen reason="server" />;

  const items = roles.data ?? [];
  const selected = items.find((r) => r.id === selectedId) ?? items[0];
  const modules = catalog.data ?? [];
  const totalPermissions = modules.reduce((n, m) => n + m.permissions.length, 0);
  const roleName = (r: Pick<AdminRole, 'code' | 'name'>) =>
    KNOWN_ROLES.includes(r.code) ? tr(r.code as StaffRole) : r.name;
  const moduleName = (m: string) =>
    (KNOWN_MODULES as readonly string[]).includes(m) ? tm(m as ModuleKey) : m;

  const canManage = can('roles.manage') && !!selected && !selected.isSystem;
  const editing = draft !== null && !!selected;
  const diff =
    selected && draft
      ? diffPermissions(
          selected.permissions.map((p) => p.code),
          draft,
        )
      : null;

  const pick = (id: string) => {
    setSelectedId(id);
    setDraft(null);
    setError('');
  };

  const submit = () => {
    if (!selected || !draft || save.isPending) return;
    if (draft.length === 0) {
      setError(t('atLeastOne'));
      return;
    }
    setError('');
    save.mutate(
      { id: selected.id, input: { permissions: draft } },
      {
        onSuccess: () => {
          toast.notify(t('toastSaved', { role: roleName(selected) }));
          setDraft(null);
        },
        onError: (err) => setError(rolePermissionsError(err)),
      },
    );
  };

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">
            {roles.data && catalog.data
              ? t('subtitle', { count: items.length, permissions: totalPermissions })
              : ' '}
          </div>
        </div>
      </div>
      <p className="sm muted" style={{ fontWeight: 600, marginTop: 0 }}>
        {t('intro')}
      </p>

      {roles.isError || catalog.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              void roles.refetch();
              void catalog.refetch();
            }}
          >
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {roles.isPending ? (
        <div className="rgrid" aria-busy="true" aria-label={tu('loading')}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} zone="bo" style={{ height: 120, borderRadius: 16 }} />
          ))}
        </div>
      ) : items.length === 0 && !roles.isError ? (
        <EmptyState zone="bo" title={t('emptyTitle')} description={t('emptyText')} />
      ) : (
        <div className="rgrid" role="list" aria-label={t('listLabel')}>
          {items.map((role) => {
            const on = role.id === selected?.id;
            return (
              <section key={role.id} className="card" role="listitem">
                <div className="card-h">
                  <h2>{roleName(role)}</h2>
                  {role.isSystem ? (
                    <Pill zone="bo" tone="muted">
                      {t('systemBadge')}
                    </Pill>
                  ) : null}
                </div>
                <div
                  className="card-b"
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="sm muted" style={{ fontWeight: 600 }}>
                    {KNOWN_ROLES.includes(role.code) ? trd(role.code as StaffRole) : role.name}
                  </div>
                  <div className="sm" style={{ fontWeight: 700 }}>
                    {t('assigned', { count: role.assignedStaffCount })} ·{' '}
                    {t('permissionsCount', {
                      count: role.permissions.length,
                      total: totalPermissions,
                    })}
                  </div>
                  <button
                    type="button"
                    className={cn('btn sm', on && 'btn-primary')}
                    aria-pressed={on}
                    onClick={() => pick(role.id)}
                  >
                    {t('detailTitle', { role: roleName(role) })}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {selected ? (
        <section
          className="card"
          style={{ marginTop: 16 }}
          aria-label={t('detailTitle', { role: roleName(selected) })}
        >
          <div className="card-h">
            <h2>{t('detailTitle', { role: roleName(selected) })}</h2>
            <span className="spacer" />
            {canManage && !editing ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setDraft(selected.permissions.map((p) => p.code));
                  setError('');
                }}
              >
                {t('edit')}
              </button>
            ) : null}
          </div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {selected.isSystem ? (
              <Banner zone="bo" tone="info" role="note">
                {t('readOnlySystem')}
              </Banner>
            ) : !can('roles.manage') ? (
              <Banner zone="bo" tone="info" role="note">
                {t('readOnlyNoManage')}
              </Banner>
            ) : null}

            {modules.map((m) => {
              const codes = m.permissions.map((p) => p.code);
              const current = new Set(selected.permissions.map((p) => p.code));
              return (
                <fieldset key={m.module} style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="flabel" style={{ marginBottom: 6 }}>
                    {moduleName(m.module)}
                  </legend>
                  {editing && draft ? (
                    <>
                      <div className="form-grid" role="group" aria-label={moduleName(m.module)}>
                        {m.permissions.map((p) => {
                          const checked = draft.includes(p.code);
                          return (
                            <button
                              key={p.code}
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              className={cn('ckb', checked && 'on')}
                              onClick={() => {
                                setDraft(togglePermission(draft, p.code));
                                setError('');
                              }}
                            >
                              <span className="box">
                                {checked ? <IconCheckBold size="sm" /> : null}
                              </span>
                              <span>
                                {p.description}
                                <span className="xs muted" style={{ display: 'block' }}>
                                  <code>{p.code}</code>
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() =>
                          setDraft(setModule(draft, codes, !codes.every((c) => draft.includes(c))))
                        }
                      >
                        {t('moduleSelectAll', { module: moduleName(m.module) })}
                      </button>
                    </>
                  ) : (
                    <div className="ptags">
                      {m.permissions.map((p) => {
                        const included = current.has(p.code);
                        return (
                          <span
                            key={p.code}
                            className={included ? 'ptag' : 'ptag no'}
                            title={p.code}
                          >
                            {p.description}
                            {included ? null : <span className="sr-only"> (no incluido)</span>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              );
            })}

            {editing && diff ? (
              <>
                <Banner zone="bo" tone="alert" role="status">
                  {t('affects', { count: selected.assignedStaffCount, role: roleName(selected) })}
                  {hasPermissionChanges(diff)
                    ? ` ${t('added', { count: diff.added.length })} · ${t('removed', { count: diff.removed.length })}`
                    : ` ${t('noChanges')}`}
                </Banner>
                {error ? (
                  <Banner zone="bo" tone="danger" role="alert">
                    {error}
                  </Banner>
                ) : null}
                <div className="row gap10">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setDraft(null);
                      setError('');
                    }}
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={save.isPending || !hasPermissionChanges(diff)}
                    onClick={submit}
                  >
                    {save.isPending ? t('saving') : t('save')}
                  </button>
                </div>
              </>
            ) : null}
            <p className="sm muted" style={{ fontWeight: 600, margin: 0 }}>
              {t('pending')}
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
