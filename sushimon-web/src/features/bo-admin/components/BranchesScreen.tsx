'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { IconPencil, IconPlus, IconStore } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import {
  useBackofficeOrders,
  useBoBranches,
  useDashboard,
  useUpdateBranch,
} from '@/features/backoffice/hooks';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { errorMessage, isForbidden } from '@/features/bo-orders/error-message';
import type { Branch } from '@/lib/data-access/models';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/cn';
import { branchCapacity, branchStats, radiusLabel } from '../branches-view';
import { formatMoneyCompact } from '../format';
import { BranchEditModal } from './BranchEditModal';

/** Sucursales (admin): tarjetas con abierta/cerrada, estadísticas de hoy, edición y cupo de sucursales. */
export function BranchesScreen() {
  const t = useTranslations('backoffice.branches');
  const tu = useTranslations('ui');
  const toast = useToast();
  const { role } = useShell();
  const branches = useBoBranches();
  const dashboard = useDashboard();
  const orders = useBackofficeOrders({});
  const update = useUpdateBranch();
  const [editing, setEditing] = useState<Branch | null>(null);
  const noteId = useId();

  if (isForbidden(branches.error)) return <ForbiddenScreen reason="server" />;

  const all = branches.data ?? [];
  const active = all.filter((b) => b.status === 'active');
  const capacity = branchCapacity(all);
  const canEdit = can(role, 'branches');

  const toggle = (branch: Branch, isOpen: boolean) => {
    update.mutate(
      { id: branch.id, input: { isOpen } },
      {
        onSuccess: () =>
          toast.notify(t(isOpen ? 'toastOpened' : 'toastClosed', { name: branch.name })),
        onError: (e) => toast.notify(errorMessage(e)),
      },
    );
  };

  const addSlot = (branch: Branch) => {
    update.mutate(
      { id: branch.id, input: { status: 'active', isOpen: false } },
      {
        onSuccess: () => toast.notify(t('toastAdded')),
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
            {t('subtitle', { count: capacity.count, cap: capacity.cap })}
          </div>
        </div>
        <div
          className="cap"
          role="img"
          aria-label={t('capLabel', { count: capacity.count, cap: capacity.cap })}
        >
          {Array.from({ length: capacity.cap }, (_, i) => (
            <span key={i} className={i < capacity.count ? 'on' : ''} />
          ))}
        </div>
      </div>

      {branches.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void branches.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {branches.isPending ? (
        <div className="bgrid" aria-busy="true" aria-label={tu('loading')}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} zone="bo" style={{ height: 360, borderRadius: 16 }} />
          ))}
        </div>
      ) : !branches.isError && all.length === 0 ? (
        <EmptyState zone="bo" title={t('emptyTitle')} description={t('emptyText')} />
      ) : (
        <div className="bgrid">
          {active.map((branch) => {
            const stats = branchStats(branch.id, dashboard.data?.byBranch, orders.data);
            const pending = dashboard.isPending || orders.isPending;
            return (
              <div key={branch.id} className={cn('bcard', !branch.isOpen && 'off')}>
                <div className="bcard-top">
                  <span className="bcard-ic">
                    <IconStore />
                  </span>
                  <div className="grow">
                    <div className="cname">{branch.name}</div>
                    <div className="sm muted" style={{ fontWeight: 700 }}>
                      {branch.zoneLabel}
                    </div>
                  </div>
                  <Pill zone="bo" tone={branch.isOpen ? 'success' : 'muted'}>
                    {branch.isOpen ? t('open') : t('closed')}
                  </Pill>
                </div>
                <div className="bcard-b">
                  <dl className="kv">
                    <dt>{t('address')}</dt>
                    <dd>{branch.address}</dd>
                    <dt>{t('hours')}</dt>
                    <dd>{branch.hoursLabel}</dd>
                    <dt>{t('phone')}</dt>
                    <dd className="num">{branch.phone}</dd>
                    <dt>{t('coverage')}</dt>
                    <dd>{radiusLabel(branch)}</dd>
                  </dl>
                  <div className="ptags">
                    {(branch.coverageLabels.length
                      ? branch.coverageLabels
                      : [t('zonesPending')]
                    ).map((zone) => (
                      <span key={zone} className="ptag">
                        {zone}
                      </span>
                    ))}
                  </div>
                  <div className="row gap8">
                    <Switch
                      zone="bo"
                      checked={branch.isOpen}
                      label={t('switchLabel', { name: branch.name })}
                      disabled={!canEdit || update.isPending}
                      onCheckedChange={(next) => toggle(branch, next)}
                    />
                    <span className="sm" style={{ fontWeight: 700 }}>
                      {branch.isOpen ? t('switchOn') : t('switchOff')}
                    </span>
                    <span className="spacer" />
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn sm"
                        aria-label={t('editLabel', { name: branch.name })}
                        onClick={() => setEditing(branch)}
                      >
                        <IconPencil size="sm" />
                        {t('edit')}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="bstats">
                  <span>
                    <b>{pending ? '—' : stats.orders}</b>
                    {t('statOrders')}
                  </span>
                  <span>
                    <b>{pending ? '—' : stats.active}</b>
                    {t('statActive')}
                  </span>
                  <span>
                    <b>{pending ? '—' : formatMoneyCompact(stats.sales)}</b>
                    {t('statSales')}
                  </span>
                </div>
              </div>
            );
          })}

          {capacity.slots.map((slot, i) => (
            <button
              key={slot.id}
              type="button"
              className="bslot"
              disabled={!canEdit || update.isPending}
              onClick={() => addSlot(slot)}
            >
              <span
                className="bcard-ic"
                style={{ background: 'var(--bo-surface-2)', color: 'var(--bo-text)' }}
              >
                <IconPlus />
              </span>
              <span className="cname">{t('add')}</span>
              <span className="sm muted" style={{ fontWeight: 700 }}>
                {t('slotFree', { n: capacity.count + i + 1, cap: capacity.cap })}
              </span>
            </button>
          ))}

          {capacity.unassignedSlots > 0 && !capacity.full ? (
            <button type="button" className="bslot" aria-disabled="true" aria-describedby={noteId}>
              <span
                className="bcard-ic"
                style={{ background: 'var(--bo-surface-2)', color: 'var(--bo-text)' }}
              >
                <IconPlus />
              </span>
              <span className="cname">{t('unassignedTitle')}</span>
              <span className="sm muted" style={{ fontWeight: 700 }}>
                {t('unassignedText')}
              </span>
            </button>
          ) : null}

          {capacity.full ? (
            <button type="button" className="bslot" aria-disabled="true" aria-describedby={noteId}>
              <span
                className="bcard-ic"
                style={{ background: 'var(--bo-surface-2)', color: 'var(--bo-text)' }}
              >
                <IconPlus />
              </span>
              <span className="cname">{t('fullTitle', { cap: capacity.cap })}</span>
              <span className="sm muted" style={{ fontWeight: 700 }}>
                {t('fullText')}
              </span>
            </button>
          ) : null}
        </div>
      )}

      <p id={noteId} className="sm muted" style={{ fontWeight: 600 }}>
        {capacity.full ? t('fullNote', { cap: capacity.cap }) : t('demoNote')}
      </p>

      {editing ? <BranchEditModal branch={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
