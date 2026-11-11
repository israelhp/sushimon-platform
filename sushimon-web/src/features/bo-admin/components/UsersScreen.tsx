'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { useSaveUser, useUsers } from '@/features/backoffice/hooks';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { avatarStyle, staffInitials } from '@/features/backoffice-shell/staff-display';
import { errorMessage, isForbidden } from '@/features/bo-orders/error-message';
import { useDemoSession } from '@/features/session/demo-session';
import type { StaffUser } from '@/lib/data-access/models';
import {
  PERMISSION_LABEL,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  can,
} from '@/lib/permissions';
import {
  ALL_PERMISSIONS,
  ROLE_ORDER,
  ROLE_PILL_TONE,
  matchesUserSearch,
  userBranchLabel,
} from '../users-view';
import { UserModal } from './UserModal';

type ModalState = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; user: StaffUser };

/** Usuarios internos (admin): tabla con estado activo/inactivo, alta y edición, y la matriz de permisos por rol. */
export function UsersScreen() {
  const t = useTranslations('backoffice.users');
  const tu = useTranslations('ui');
  const toast = useToast();
  const { role, branches } = useShell();
  const { staff } = useDemoSession();
  const users = useUsers();
  const save = useSaveUser();
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' });

  if (isForbidden(users.error)) return <ForbiddenScreen reason="server" />;

  const all = users.data ?? [];
  const visible = all.filter((u) => matchesUserSearch(u, query));
  const canManage = can(role, 'users');

  const toggleActive = (user: StaffUser, active: boolean) => {
    save.mutate(
      { id: user.id, input: { active } },
      {
        onSuccess: () =>
          toast.notify(t(active ? 'toastActivated' : 'toastDeactivated', { name: user.name })),
        onError: (e) => toast.notify(errorMessage(e)),
      },
    );
  };

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">
            {users.data
              ? t('subtitle', { total: all.length, active: all.filter((u) => u.active).length })
              : ' '}
          </div>
        </div>
        <SearchInput
          zone="bo"
          inline
          clearable
          value={query}
          onValueChange={setQuery}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
        />
        {canManage ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModal({ mode: 'new' })}
          >
            <IconPlus size="sm" />
            {t('new')}
          </button>
        ) : null}
      </div>

      {users.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void users.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      <div className="card">
        <div className="tscroll" style={{ paddingTop: 14 }}>
          <div
            className="min-users"
            role="table"
            aria-label={t('tableLabel')}
            aria-busy={users.isPending}
          >
            <div className="thead cols-users" role="row">
              <span role="columnheader">{t('colName')}</span>
              <span role="columnheader">{t('colEmail')}</span>
              <span role="columnheader">{t('colRole')}</span>
              <span role="columnheader">{t('colBranch')}</span>
              <span role="columnheader">{t('colStatus')}</span>
              <span role="columnheader">
                <span className="sr-only">{t('edit')}</span>
              </span>
            </div>
            {users.isPending
              ? [0, 1, 2, 3].map((i) => (
                  <div key={i} className="trow cols-users" role="row">
                    <Skeleton
                      zone="bo"
                      style={{ height: 34, gridColumn: '1 / -1', borderRadius: 10 }}
                    />
                  </div>
                ))
              : visible.map((user) => (
                  <div key={user.id} className="trow cols-users" role="row">
                    <div className="row gap10" role="cell">
                      <span
                        className="avatar"
                        aria-hidden="true"
                        style={{ ...avatarStyle(user.role), width: 34, height: 34, fontSize: 11.5 }}
                      >
                        {staffInitials(user.name)}
                      </span>
                      <span className="cell-main trunc">{user.name}</span>
                    </div>
                    <div className="sm muted hide-sm" style={{ fontWeight: 600 }} role="cell">
                      {user.email}
                    </div>
                    <div role="cell">
                      <Pill zone="bo" tone={ROLE_PILL_TONE[user.role]}>
                        {ROLE_LABEL[user.role]}
                      </Pill>
                    </div>
                    <div className="hide-sm" role="cell">
                      <span className="btag">{userBranchLabel(user, branches)}</span>
                    </div>
                    <div className="sw-row" role="cell">
                      <Switch
                        zone="bo"
                        checked={user.active}
                        label={t('switchLabel', { name: user.name })}
                        disabled={!canManage || save.isPending}
                        onCheckedChange={(next) => toggleActive(user, next)}
                      />
                      {user.active ? t('active') : t('inactive')}
                    </div>
                    <div className="row-actions u-act" role="cell">
                      {canManage ? (
                        <button
                          type="button"
                          className="btn sm edit-btn"
                          aria-label={t('editLabel', { name: user.name })}
                          onClick={() => setModal({ mode: 'edit', user })}
                        >
                          <IconPencil size="sm" />
                          {t('edit')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
          </div>
          {!users.isPending && !users.isError && visible.length === 0 ? (
            <EmptyState zone="bo" title={t('emptyTitle')} description={t('emptyText')} />
          ) : null}
        </div>
      </div>

      <div className="rgrid">
        {ROLE_ORDER.map((r) => (
          <section key={r} className="card">
            <div className="card-h">
              <h2>{ROLE_LABEL[r]}</h2>
            </div>
            <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="sm muted" style={{ fontWeight: 600 }}>
                {ROLE_DESCRIPTION[r]}
              </div>
              <div className="ptags">
                {ALL_PERMISSIONS.map((p) => {
                  const included = ROLE_PERMISSIONS[r].includes(p);
                  return (
                    <span key={p} className={included ? 'ptag' : 'ptag no'}>
                      {PERMISSION_LABEL[p]}
                      {included ? null : <span className="sr-only"> (no incluido)</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          </section>
        ))}
      </div>

      <p className="sm muted" style={{ fontWeight: 600 }}>
        {t('demoNote')}
      </p>

      {modal.mode !== 'closed' ? (
        <UserModal
          user={modal.mode === 'edit' ? modal.user : undefined}
          branches={branches}
          isSelf={modal.mode === 'edit' && modal.user.id === staff?.userId}
          onClose={() => setModal({ mode: 'closed' })}
        />
      ) : null}
    </div>
  );
}
