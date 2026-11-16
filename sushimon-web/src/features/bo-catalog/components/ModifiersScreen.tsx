'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { IconLayers, IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/features/bo-admin/components/ConfirmModal';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { isForbidden } from '@/features/bo-orders/error-message';
import { useAdminModifierGroups, useUpdateModifierGroup } from '@/features/modifiers/hooks';
import { queryKeys } from '@/features/query-keys';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { canGlobally } from '@/lib/permissions';
import {
  modifierServerError,
  modifierStatusToActive,
  ruleText,
  type ModifierStatusFilter,
} from '../modifiers-view';
import { ModifierGroupModal } from './ModifierGroupModal';
import { ModifierOptionsModal } from './ModifierOptionsModal';

const PAGE_SIZE = 20;

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'options'; id: string }
  | { kind: 'status'; id: string };

/**
 * Pantalla Extras (F12): grupos de modificadores. Lista PAGINADA del servidor (búsqueda con debounce y filtro de estado) con
 * resumen «obligatorio/opcional» + regla de elección, conteo de opciones y de productos. Alta (con opciones iniciales), edición
 * de nombre/mínimo/máximo, activar/desactivar con confirmación y gestión de opciones (modal). La vista exige `catalog.read`;
 * crear/editar `catalog.create`/`catalog.update` con alcance GLOBAL (si no, se deshabilitan con aviso: el servidor responde 403
 * de todos modos). Sin borrado: solo se desactiva.
 */
export function ModifiersScreen() {
  const t = useTranslations('backoffice.modifiers');
  const tu = useTranslations('ui');
  const toast = useToast();
  const qc = useQueryClient();
  const { grants, can } = useShell();
  const update = useUpdateModifierGroup();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ModifierStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [statusError, setStatusError] = useState('');

  const q = useDebouncedValue(query, 300).trim();
  const groups = useAdminModifierGroups({
    q: q || undefined,
    active: modifierStatusToActive(status),
    page,
    pageSize: PAGE_SIZE,
  });
  const items = useMemo(() => groups.data?.items ?? [], [groups.data]);
  const total = groups.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q) || status !== 'all';

  const canCreate = canGlobally(grants, 'catalog.create');
  const canUpdate = canGlobally(grants, 'catalog.update');
  const anyWrite = can('catalog.create') || can('catalog.update');
  const noticeKey = canCreate || canUpdate ? null : anyWrite ? 'noticeScope' : 'noticeReadOnly';

  if (isForbidden(groups.error)) return <ForbiddenScreen reason="server" />;

  const target =
    dialog && dialog.kind !== 'create' ? items.find((g) => g.id === dialog.id) : undefined;
  const close = () => {
    setDialog(null);
    setStatusError('');
  };
  const resetPage =
    <T,>(set: (v: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setPage(1);
  };

  const confirmStatus = (id: string, name: string, active: boolean) =>
    update.mutate(
      { id, input: { active: !active } },
      {
        onSuccess: () => {
          toast.notify(t(active ? 'toastDeactivated' : 'toastActivated', { name }));
          close();
        },
        onError: (error) => {
          const parsed = modifierServerError(error);
          setStatusError(parsed.message);
          if (parsed.reload) void qc.invalidateQueries({ queryKey: queryKeys.modifiers.all });
        },
      },
    );

  return (
    <div className="page" style={{ animation: 'none' }}>
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">{t('subtitle', { count: total })}</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canCreate}
          onClick={() => setDialog({ kind: 'create' })}
        >
          <IconPlus size="sm" />
          {t('new')}
        </button>
      </div>

      {noticeKey ? (
        <Banner zone="bo" tone="info" role="status">
          {t(noticeKey)}
        </Banner>
      ) : null}

      <div className="toolbar">
        <SearchInput
          zone="bo"
          inline
          value={query}
          onValueChange={resetPage(setQuery)}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          maxLength={80}
        />
        <SegmentedControl
          zone="bo"
          label={t('statusFilter')}
          value={status}
          onChange={resetPage(setStatus)}
          options={[
            { value: 'all', label: t('statusAll') },
            { value: 'active', label: t('statusActive') },
            { value: 'inactive', label: t('statusInactive') },
          ]}
        />
      </div>

      {groups.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void groups.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {groups.isPending ? (
        <div aria-busy="true" aria-label={tu('loading')} className="card">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} zone="bo" style={{ height: 56, margin: 12, borderRadius: 12 }} />
          ))}
        </div>
      ) : items.length === 0 && !groups.isError ? (
        <EmptyState
          zone="bo"
          title={t('empty.title')}
          description={filtered ? t('empty.description') : t('empty.none')}
          action={
            filtered ? (
              <button type="button" className="btn mt8" onClick={clearFilters}>
                {t('empty.clear')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card">
          <div className="tscroll" style={{ paddingTop: 14 }}>
            <div className="min-mod" role="table" aria-label={t('title')}>
              <div className="thead cols-mod" role="row">
                <span role="columnheader">{t('table.name')}</span>
                <span role="columnheader">{t('table.rule')}</span>
                <span role="columnheader">{t('table.options')}</span>
                <span role="columnheader">{t('table.products')}</span>
                <span role="columnheader">{t('table.status')}</span>
                <span role="columnheader">
                  <span className="sr-only">{t('table.actions')}</span>
                </span>
              </div>
              {items.map((g) => (
                <div className="trow cols-mod" role="row" key={g.id}>
                  <div role="cell">
                    <div className="cell-main">{g.name}</div>
                    <div className="cell-sub">{g.required ? t('required') : t('optional')}</div>
                  </div>
                  <div className="sm" style={{ fontWeight: 700 }} role="cell">
                    {ruleText(g.minSelect, g.maxSelect)}
                  </div>
                  <div className="sm" role="cell">
                    {t('optionCount', { active: g.activeOptionCount, total: g.optionCount })}
                  </div>
                  <div className="sm" role="cell">
                    {t('productCount', { count: g.productCount })}
                  </div>
                  <div role="cell">
                    <Pill zone="bo" tone={g.active ? 'success' : 'muted'}>
                      {g.active ? t('active') : t('inactive')}
                    </Pill>
                  </div>
                  <div className="row-actions" role="cell">
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={t('optionsLabel', { name: g.name })}
                      onClick={() => setDialog({ kind: 'options', id: g.id })}
                    >
                      <IconLayers size="sm" />
                      {t('manageOptions')}
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={!canUpdate}
                      aria-label={t(g.active ? 'deactivateLabel' : 'activateLabel', {
                        name: g.name,
                      })}
                      onClick={() => setDialog({ kind: 'status', id: g.id })}
                    >
                      {t(g.active ? 'deactivate' : 'activate')}
                    </button>
                    <button
                      type="button"
                      className="icon-btn bordered"
                      disabled={!canUpdate}
                      aria-label={t('editLabel', { name: g.name })}
                      title={t('edit')}
                      onClick={() => setDialog({ kind: 'edit', id: g.id })}
                    >
                      <IconPencil size="sm" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {total > 0 ? (
        <nav
          className="row gap8"
          aria-label={t('pager.label')}
          style={{ justifyContent: 'center', marginTop: 16 }}
        >
          <button
            type="button"
            className="btn sm"
            disabled={page <= 1}
            onClick={() => setPage((n) => Math.max(1, n - 1))}
          >
            {t('pager.prev')}
          </button>
          <span className="sm muted" role="status" style={{ fontWeight: 700 }}>
            {t('pager.status', { page, pages, total })}
          </span>
          <button
            type="button"
            className="btn sm"
            disabled={page >= pages}
            onClick={() => setPage((n) => n + 1)}
          >
            {t('pager.next')}
          </button>
        </nav>
      ) : null}

      {dialog?.kind === 'create' ? <ModifierGroupModal onClose={close} /> : null}
      {dialog?.kind === 'edit' && target ? (
        <ModifierGroupModal group={target} onClose={close} />
      ) : null}
      {dialog?.kind === 'options' && target ? (
        <ModifierOptionsModal
          groupId={target.id}
          canCreate={canCreate}
          canUpdate={canUpdate}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'status' && target ? (
        <ConfirmModal
          title={t(target.active ? 'deactivateTitle' : 'activateTitle', { name: target.name })}
          confirmLabel={t(target.active ? 'deactivate' : 'activate')}
          cancelLabel={t('cancel')}
          pendingLabel={t('saving')}
          danger={target.active}
          pending={update.isPending}
          error={statusError}
          onConfirm={() => confirmStatus(target.id, target.name, target.active)}
          onClose={close}
        >
          {target.active
            ? t('deactivateBody', { name: target.name, count: target.productCount })
            : t('activateBody', { name: target.name })}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
