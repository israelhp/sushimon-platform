'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import {
  useAdminBranchClosures,
  useDeleteBranchClosure,
  useUpdateBranchClosure,
} from '@/features/branch-schedule/hooks';
import { useNow } from '@/features/backoffice-shell/use-now';
import { isForbidden } from '@/features/bo-orders/error-message';
import type { AdminBranch, BranchClosure } from '@/lib/data-access/models';
import type { ClosureStatusFilter } from '@/services/branch-schedule';
import {
  CLOSURE_FILTERS,
  CLOSURE_PAGE_SIZE,
  CLOSURE_STATUS_LABEL,
  CLOSURE_STATUS_TONE,
  closureServerError,
  formatClosureInstant,
  formatClosureRange,
} from '../branch-schedule-view';
import { ClosureFormModal } from './ClosureFormModal';
import { ConfirmModal } from './ConfirmModal';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; closure: BranchClosure }
  | { kind: 'end'; closure: BranchClosure }
  | { kind: 'cancel'; closure: BranchClosure };

/**
 * Cierres extraordinarios de una sucursal (F08): lista con filtro de estado, crear, editar según estado (futuro:
 * todo; en curso: solo acortar el fin y el motivo), terminar uno en curso («Terminar ahora») y cancelar futuros. Los
 * terminados son de solo lectura. El motivo solo se ve en el backoffice. La API decide los permisos y las reglas.
 */
export function ClosuresPanel({ branch, canManage }: { branch: AdminBranch; canManage: boolean }) {
  const t = useTranslations('backoffice.branchSchedule.closures');
  const tu = useTranslations('ui');
  const toast = useToast();
  const now = useNow();
  const [status, setStatus] = useState<ClosureStatusFilter>('current');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [actionError, setActionError] = useState('');
  const closures = useAdminBranchClosures(branch.id, { status, page, pageSize: CLOSURE_PAGE_SIZE });
  const update = useUpdateBranchClosure();
  const remove = useDeleteBranchClosure();

  const items = closures.data?.items ?? [];
  const total = closures.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / CLOSURE_PAGE_SIZE));

  if (isForbidden(closures.error)) {
    return (
      <Banner zone="bo" tone="warning" role="alert">
        {t('forbidden')}
      </Banner>
    );
  }

  const close = () => {
    setDialog(null);
    setActionError('');
  };

  const endNow = (closure: BranchClosure) =>
    update.mutate(
      {
        id: branch.id,
        closureId: closure.id,
        // Cualquier instante <= ahora termina el cierre «ahora» (el servidor lo fija a su reloj).
        input: { endsAt: (now ?? new Date(closure.startsAt)).toISOString() },
      },
      {
        onSuccess: () => {
          toast.notify(t('toastEnded'));
          close();
        },
        onError: (e) => setActionError(closureServerError(e).message),
      },
    );

  const cancel = (closure: BranchClosure) =>
    remove.mutate(
      { id: branch.id, closureId: closure.id },
      {
        onSuccess: () => {
          toast.notify(t('toastCancelled'));
          close();
        },
        onError: (e) => setActionError(closureServerError(e).message),
      },
    );

  return (
    <div className="hrs">
      {!canManage ? (
        <Banner zone="bo" tone="info">
          {t('readOnly', { permission: 'branches.manage_hours' })}
        </Banner>
      ) : null}
      <div className="row gap10" style={{ flexWrap: 'wrap' }}>
        <SegmentedControl
          zone="bo"
          label={t('filterLabel')}
          value={status}
          options={CLOSURE_FILTERS}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <span className="spacer" />
        {canManage ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setDialog({ kind: 'create' })}
          >
            <IconPlus size="sm" />
            {t('new')}
          </button>
        ) : null}
      </div>
      <p className="xs muted" style={{ fontWeight: 600, margin: 0 }}>
        {t('note')}
      </p>

      {closures.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('loadError')}{' '}
          <button type="button" className="link-btn" onClick={() => void closures.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {closures.isPending ? (
        <div aria-busy="true" aria-label={tu('loading')} className="hrs">
          {[0, 1].map((i) => (
            <Skeleton key={i} zone="bo" style={{ height: 64, borderRadius: 12 }} />
          ))}
        </div>
      ) : !closures.isError && items.length === 0 ? (
        <EmptyState zone="bo" title={t('emptyTitle')} description={t('emptyText')} />
      ) : (
        <ul
          className="hrs"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
          aria-busy={closures.isFetching}
        >
          {items.map((c) => (
            <li key={c.id} className="clo-item">
              <div className="clo-main">
                <div className="row gap8" style={{ flexWrap: 'wrap' }}>
                  <Pill zone="bo" tone={CLOSURE_STATUS_TONE[c.status]}>
                    {CLOSURE_STATUS_LABEL[c.status]}
                  </Pill>
                  <span className="strong">{formatClosureRange(c)}</span>
                </div>
                <div className="sm muted" style={{ fontWeight: 600 }}>
                  {c.reason ? t('reason', { reason: c.reason }) : t('noReason')}
                </div>
              </div>
              {canManage && c.status !== 'past' ? (
                <div className="row gap8" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={t('editLabel', { from: formatClosureInstant(c.startsAt) })}
                    onClick={() => setDialog({ kind: 'edit', closure: c })}
                  >
                    {t('edit')}
                  </button>
                  {c.status === 'active' ? (
                    <button
                      type="button"
                      className="btn sm danger"
                      aria-label={t('endNowLabel', { from: formatClosureInstant(c.startsAt) })}
                      onClick={() => setDialog({ kind: 'end', closure: c })}
                    >
                      {t('endNow')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn sm danger"
                      aria-label={t('cancelLabel', { from: formatClosureInstant(c.startsAt) })}
                      onClick={() => setDialog({ kind: 'cancel', closure: c })}
                    >
                      {t('cancel')}
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="row gap10" aria-label={t('pagerLabel')}>
          <button
            type="button"
            className="btn sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('prev')}
          </button>
          <span className="sm" style={{ fontWeight: 700 }} aria-live="polite">
            {t('pageOf', { page, pages })}
          </span>
          <button
            type="button"
            className="btn sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('next')}
          </button>
        </nav>
      ) : null}

      {dialog?.kind === 'create' ? (
        <ClosureFormModal branch={branch} now={now} onClose={close} />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <ClosureFormModal branch={branch} closure={dialog.closure} now={now} onClose={close} />
      ) : null}
      {dialog?.kind === 'end' ? (
        <ConfirmModal
          title={t('endTitle')}
          description={branch.name}
          danger
          confirmLabel={t('endAction')}
          cancelLabel={t('back')}
          pendingLabel={t('working')}
          pending={update.isPending}
          error={actionError}
          onConfirm={() => endNow(dialog.closure)}
          onClose={close}
        >
          {t('endText', { range: formatClosureRange(dialog.closure) })}
        </ConfirmModal>
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <ConfirmModal
          title={t('cancelTitle')}
          description={branch.name}
          danger
          confirmLabel={t('cancelAction')}
          cancelLabel={t('back')}
          pendingLabel={t('working')}
          pending={remove.isPending}
          error={actionError}
          onConfirm={() => cancel(dialog.closure)}
          onClose={close}
        >
          {t('cancelText', { range: formatClosureRange(dialog.closure) })}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
