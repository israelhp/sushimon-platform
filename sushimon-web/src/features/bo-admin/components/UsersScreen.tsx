'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { avatarStyle, staffInitials } from '@/features/backoffice-shell/staff-display';
import { isForbidden } from '@/features/bo-orders/error-message';
import { useDemoSession } from '@/features/session/demo-session';
import { useAdminRoles, useAdminStaffList } from '@/features/staff/hooks';
import type { AdminStaff, StaffRole } from '@/lib/data-access/models';
import {
  DEFAULT_STAFF_LIST,
  ROLE_ORDER,
  ROLE_PILL_TONE,
  STAFF_PAGE_SIZE,
  hasStaffFilters,
  staffPageCount,
  toStaffFilters,
  type StaffIdentityFilter,
  type StaffListState,
  type StaffSortKey,
  type StaffStatusFilter,
} from '../users-view';
import { StaffAssignmentsModal } from './StaffAssignmentsModal';
import { StaffStatusModal } from './StaffStatusModal';
import { UserModal } from './UserModal';

const SEARCH_DEBOUNCE_MS = 300;

type Modal =
  | { kind: 'create' }
  | { kind: 'edit'; staff: AdminStaff }
  | { kind: 'assign'; staff: AdminStaff }
  | { kind: 'status'; staff: AdminStaff };

const primaryRole = (staff: AdminStaff): StaffRole => {
  const codes = staff.assignments.map((a) => a.role.code);
  return ROLE_ORDER.find((r) => codes.includes(r)) ?? 'staff';
};

/**
 * Usuarios (F03): empleados con asignaciones rol + sucursal, identidad (Pendiente de vincular Google / Vinculada) y
 * estado (Activo / Desactivado). Lista paginada con búsqueda, filtros y orden; alta (preautorización), edición,
 * asignaciones y activación con motivo. La UI solo muestra/oculta: `manageable` orienta y la API decide
 * (400/403/404/409 se muestran en los modales). El estado de MFA por persona no lo expone la API y no se muestra.
 */
export function UsersScreen() {
  const t = useTranslations('backoffice.users');
  const tu = useTranslations('ui');
  const tr = useTranslations('backoffice.roles');
  const { can, branches } = useShell();
  const { staff: session } = useDemoSession();
  const [list, setList] = useState<StaffListState>(DEFAULT_STAFF_LIST);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);

  // La búsqueda se envía con un pequeño retardo y reinicia la página.
  useEffect(() => {
    const id = setTimeout(
      () => setList((s) => (s.q === search ? s : { ...s, q: search, page: 1 })),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [search]);

  const filters = useMemo(() => toStaffFilters(list), [list]);
  const staff = useAdminStaffList(filters);
  const roles = useAdminRoles();

  const items = staff.data?.items ?? [];
  const total = staff.data?.total ?? 0;
  const pages = staffPageCount(total, staff.data?.pageSize ?? STAFF_PAGE_SIZE);

  // Si la página pedida quedó vacía (p. ej., tras un filtro), retrocede una página.
  if (staff.data && !staff.isPlaceholderData && items.length === 0 && list.page > 1) {
    setList((s) => ({ ...s, page: Math.max(1, Math.min(s.page - 1, pages)) }));
  }

  if (isForbidden(staff.error)) return <ForbiddenScreen reason="server" />;

  const roleLabel = (code: string, fallback: string) =>
    (ROLE_ORDER as readonly string[]).includes(code) ? tr(code as StaffRole) : fallback;
  const setFilter = (patch: Partial<StaffListState>) =>
    setList((s) => ({ ...s, ...patch, page: 1 }));
  const clearFilters = () => {
    setSearch('');
    setList(DEFAULT_STAFF_LIST);
  };
  const canCreate = can('staff.create') && can('staff.assign_roles');
  const orderText = list.order === 'asc' ? t('orderAsc') : t('orderDesc');
  const sortLabels: Record<StaffSortKey, string> = {
    fullName: t('sortName'),
    email: t('sortEmail'),
    createdAt: t('sortCreated'),
  };

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">{staff.data ? t('subtitle', { total }) : ' '}</div>
        </div>
        <SearchInput
          zone="bo"
          inline
          clearable
          value={search}
          onValueChange={setSearch}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
        />
        {canCreate ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModal({ kind: 'create' })}
          >
            <IconPlus size="sm" />
            {t('new')}
          </button>
        ) : null}
      </div>

      <div
        className="row gap10"
        role="group"
        aria-label={t('filtersLabel')}
        style={{ flexWrap: 'wrap', marginBottom: 14 }}
      >
        <label className="row gap8">
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('filterRole')}
          </span>
          <select
            className="inp"
            style={{ width: 'auto' }}
            value={list.roleId}
            disabled={!roles.data}
            onChange={(e) => setFilter({ roleId: e.target.value })}
          >
            <option value="">{t('optAll')}</option>
            {(roles.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {roleLabel(r.code, r.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="row gap8">
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('filterBranch')}
          </span>
          <select
            className="inp"
            style={{ width: 'auto' }}
            value={list.branchId}
            onChange={(e) => setFilter({ branchId: e.target.value })}
          >
            <option value="">{t('optAllBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="row gap8">
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('filterStatus')}
          </span>
          <select
            className="inp"
            style={{ width: 'auto' }}
            value={list.status}
            onChange={(e) => setFilter({ status: e.target.value as StaffStatusFilter })}
          >
            <option value="all">{t('optAll')}</option>
            <option value="active">{t('optActive')}</option>
            <option value="inactive">{t('optInactive')}</option>
          </select>
        </label>
        <label className="row gap8">
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('filterIdentity')}
          </span>
          <select
            className="inp"
            style={{ width: 'auto' }}
            value={list.identity}
            onChange={(e) => setFilter({ identity: e.target.value as StaffIdentityFilter })}
          >
            <option value="all">{t('optAll')}</option>
            <option value="PENDING_LINK">{t('optPending')}</option>
            <option value="LINKED">{t('optLinked')}</option>
          </select>
        </label>
        <label className="row gap8">
          <span className="sm muted" style={{ fontWeight: 700 }}>
            {t('sortLabel')}
          </span>
          <select
            className="inp"
            style={{ width: 'auto' }}
            value={list.sort}
            onChange={(e) => setFilter({ sort: e.target.value as StaffSortKey })}
          >
            {(Object.keys(sortLabels) as StaffSortKey[]).map((key) => (
              <option key={key} value={key}>
                {sortLabels[key]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn sm"
          aria-label={t('orderToggle', { order: orderText })}
          onClick={() => setFilter({ order: list.order === 'asc' ? 'desc' : 'asc' })}
        >
          {list.order === 'asc' ? '↑' : '↓'} {orderText}
        </button>
      </div>

      {staff.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void staff.refetch()}>
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
            aria-busy={staff.isPending || staff.isFetching}
          >
            <div className="thead cols-users" role="row">
              <span role="columnheader">{t('colName')}</span>
              <span role="columnheader">{t('colEmail')}</span>
              <span role="columnheader">{t('colAssignments')}</span>
              <span role="columnheader">{t('colStatus')}</span>
              <span role="columnheader">
                <span className="sr-only">{t('edit')}</span>
              </span>
            </div>
            {staff.isPending
              ? [0, 1, 2, 3].map((i) => (
                  <div key={i} className="trow cols-users" role="row">
                    <Skeleton
                      zone="bo"
                      style={{ height: 34, gridColumn: '1 / -1', borderRadius: 10 }}
                    />
                  </div>
                ))
              : items.map((person) => {
                  const isSelf = person.id === session?.userId;
                  const canAct = person.manageable && !isSelf;
                  return (
                    <div key={person.id} className="trow cols-users" role="row">
                      <div className="row gap10" role="cell">
                        <span
                          className="avatar"
                          aria-hidden="true"
                          style={{
                            ...avatarStyle(primaryRole(person)),
                            width: 34,
                            height: 34,
                            fontSize: 11.5,
                          }}
                        >
                          {staffInitials(person.fullName)}
                        </span>
                        <span className="cell-main trunc">
                          {person.fullName}
                          {isSelf ? <span className="xs muted"> · {t('you')}</span> : null}
                        </span>
                      </div>
                      <div className="sm muted hide-sm" style={{ fontWeight: 600 }} role="cell">
                        {person.email}
                      </div>
                      <div className="ptags" role="cell">
                        {person.assignments.map((a) => (
                          <Pill
                            key={`${a.role.id}|${a.branch?.id ?? 'global'}`}
                            zone="bo"
                            tone={ROLE_PILL_TONE[a.role.code as StaffRole] ?? 'muted'}
                          >
                            {roleLabel(a.role.code, a.role.name)} ·{' '}
                            {a.branch
                              ? a.effective
                                ? a.branch.name
                                : t('ineffective', { branch: a.branch.name })
                              : t('allBranches')}
                          </Pill>
                        ))}
                      </div>
                      <div
                        role="cell"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          alignItems: 'flex-start',
                        }}
                      >
                        <Pill zone="bo" tone={person.active ? 'success' : 'muted'}>
                          {person.active ? t('statusActive') : t('statusInactive')}
                        </Pill>
                        <Pill
                          zone="bo"
                          tone={person.identityStatus === 'LINKED' ? 'info' : 'warning'}
                        >
                          {person.identityStatus === 'LINKED'
                            ? t('identityLinked')
                            : t('identityPending')}
                        </Pill>
                      </div>
                      <div className="row-actions u-act" role="cell">
                        {canAct ? (
                          <>
                            {can('staff.update') ? (
                              <button
                                type="button"
                                className="btn sm edit-btn"
                                aria-label={t('editLabel', { name: person.fullName })}
                                onClick={() => setModal({ kind: 'edit', staff: person })}
                              >
                                <IconPencil size="sm" />
                                {t('edit')}
                              </button>
                            ) : null}
                            {can('staff.assign_roles') ? (
                              <button
                                type="button"
                                className="btn sm"
                                aria-label={t('assignLabel', { name: person.fullName })}
                                onClick={() => setModal({ kind: 'assign', staff: person })}
                              >
                                {t('assign')}
                              </button>
                            ) : null}
                            {can('staff.disable') ? (
                              <button
                                type="button"
                                className="btn sm"
                                aria-label={t(person.active ? 'deactivateLabel' : 'activateLabel', {
                                  name: person.fullName,
                                })}
                                onClick={() => setModal({ kind: 'status', staff: person })}
                              >
                                {t(person.active ? 'deactivate' : 'activate')}
                              </button>
                            ) : null}
                          </>
                        ) : isSelf && can('staff.update') ? (
                          <button
                            type="button"
                            className="btn sm edit-btn"
                            aria-label={t('editLabel', { name: person.fullName })}
                            title={t('selfLocked')}
                            onClick={() => setModal({ kind: 'edit', staff: person })}
                          >
                            <IconPencil size="sm" />
                            {t('edit')}
                          </button>
                        ) : (
                          <span className="xs muted" style={{ fontWeight: 700 }}>
                            {t('outOfScope')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
          </div>
          {!staff.isPending && !staff.isError && items.length === 0 ? (
            hasStaffFilters(list) ? (
              <EmptyState
                zone="bo"
                title={t('noResultsTitle')}
                description={t('noResultsText')}
                action={
                  <button type="button" className="btn mt8" onClick={clearFilters}>
                    {t('clearFilters')}
                  </button>
                }
              />
            ) : (
              <EmptyState zone="bo" title={t('emptyTitle')} description={t('emptyText')} />
            )
          ) : null}
        </div>
      </div>

      {pages > 1 ? (
        <nav className="row gap10" aria-label={t('pagerLabel')} style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn sm"
            disabled={list.page <= 1}
            onClick={() => setList((s) => ({ ...s, page: s.page - 1 }))}
          >
            {t('prev')}
          </button>
          <span className="sm" style={{ fontWeight: 700 }} aria-live="polite">
            {t('pageOf', { page: list.page, pages })}
          </span>
          <button
            type="button"
            className="btn sm"
            disabled={list.page >= pages}
            onClick={() => setList((s) => ({ ...s, page: s.page + 1 }))}
          >
            {t('next')}
          </button>
        </nav>
      ) : null}

      <p className="sm muted" style={{ fontWeight: 600 }}>
        {t('demoNote')}
      </p>

      {modal?.kind === 'create' ? (
        <UserModal roles={roles.data ?? []} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'edit' ? (
        <UserModal
          staff={modal.staff}
          roles={roles.data ?? []}
          isSelf={modal.staff.id === session?.userId}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'assign' ? (
        <StaffAssignmentsModal
          staff={modal.staff}
          roles={roles.data ?? []}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'status' ? (
        <StaffStatusModal staff={modal.staff} onClose={() => setModal(null)} />
      ) : null}
    </div>
  );
}
