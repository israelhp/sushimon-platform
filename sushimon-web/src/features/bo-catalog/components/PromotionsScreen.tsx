'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BoProductArt, IconCalendar, IconClock, IconPencil, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { isForbidden } from '@/features/bo-orders/error-message';
import { useAdminBranches } from '@/features/branches/hooks';
import { lastIncludedInstant } from '@/features/promos/happy-hour';
import { useAdminPromotions, useSetPromotionStatus } from '@/features/promotions/hooks';
import { queryKeys } from '@/features/query-keys';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/cn';
import type { AdminPromotionSummary } from '@/lib/data-access/models';
import { formatDate } from '@/lib/format';
import { PROMO_TONES } from '../catalog-view';
import {
  EMPTY_FILTERS,
  PROMOTION_KINDS,
  discountLabel,
  filterDatesInvalid,
  filtersToQuery,
  hasActiveFilters,
  promotionServerError,
  type PromotionFilterValues,
} from '../promotions-view';
import { PromotionModal } from './PromotionModal';

const PAGE_SIZE = 12;

const LIFECYCLE_TONE: Record<AdminPromotionSummary['lifecycle'], PillTone> = {
  RUNNING: 'success',
  SCHEDULED: 'info',
  EXPIRED: 'warning',
  INACTIVE: 'muted',
};

const STATUS_FILTERS = ['active', 'inactive', 'scheduled', 'running', 'expired'] as const;

type Dialog = { kind: 'create' } | { kind: 'edit'; id: string };

/**
 * Pantalla Promociones (F15): lista PAGINADA del servidor con filtros (sucursal, estado, tipo, fechas y búsqueda por nombre o
 * código), alta y edición con formulario validado, y activar/desactivar. Ver exige `promotions.read`; crear `promotions.create`;
 * editar y activar `promotions.update` con alcance sobre TODAS las sucursales de la promoción (`editable`). La UI solo oculta o
 * deshabilita: la API decide (401/403/404/409/422). Sin borrado.
 */
export function PromotionsScreen() {
  const t = useTranslations('backoffice.promotions');
  const tu = useTranslations('ui');
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useShell();
  const setStatus = useSetPromotionStatus();
  const branchesQuery = useAdminBranches({ pageSize: 100 });

  const [filters, setFilters] = useState<PromotionFilterValues>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const debounced = useDebouncedValue(filters.q, 300);
  const invalidDates = filterDatesInvalid(filters);
  const query = filtersToQuery({ ...filters, q: debounced }, page, PAGE_SIZE);
  const promotions = useAdminPromotions(query);

  const items = promotions.data?.items ?? [];
  const total = promotions.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const branches = branchesQuery.data?.items ?? [];
  const filtered = hasActiveFilters(filters);

  const canCreate = can('promotions.create');
  const canUpdate = can('promotions.update');
  const noticeKey =
    canCreate && canUpdate ? null : canCreate || canUpdate ? 'noticeScope' : 'noticeReadOnly';

  if (isForbidden(promotions.error)) return <ForbiddenScreen reason="server" />;

  const patch = (change: Partial<PromotionFilterValues>) => {
    setFilters((f) => ({ ...f, ...change }));
    setPage(1);
  };
  const clear = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const toggle = (p: AdminPromotionSummary) => {
    setPendingId(p.id);
    setStatus.mutate(
      { id: p.id, active: !p.active },
      {
        onSuccess: () => toast.notify(t(p.active ? 'toast.off' : 'toast.on', { name: p.name })),
        onError: (error) => {
          const parsed = promotionServerError(error);
          toast.notify(t('saveError', { message: parsed.message }));
          if (parsed.reload)
            void qc.invalidateQueries({ queryKey: queryKeys.backoffice.promotions });
        },
        onSettled: () => setPendingId(null),
      },
    );
  };

  const switchState = (p: AdminPromotionSummary) =>
    p.lifecycle === 'EXPIRED'
      ? 'expired'
      : !p.active
        ? 'off'
        : p.lifecycle === 'SCHEDULED'
          ? 'scheduled'
          : 'on';

  const range = (p: AdminPromotionSummary) =>
    `${formatDate(p.startsAt, 'es')} – ${formatDate(lastIncludedInstant(p.endsAt), 'es')}`;

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
          disabled={!canCreate || promotions.isPending}
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

      <div className="toolbar" role="search" aria-label={t('filters.label')}>
        <SearchInput
          zone="bo"
          inline
          value={filters.q}
          onValueChange={(q) => patch({ q })}
          label={t('filters.search')}
          placeholder={t('filters.searchPlaceholder')}
          maxLength={80}
        />
        <select
          className="inp"
          aria-label={t('filters.branch')}
          value={filters.branchId}
          onChange={(e) => patch({ branchId: e.target.value })}
        >
          <option value="all">{t('filters.branchAll')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          className="inp"
          aria-label={t('filters.status')}
          value={filters.status}
          onChange={(e) => patch({ status: e.target.value as PromotionFilterValues['status'] })}
        >
          <option value="all">{t('filters.statusAll')}</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(`filters.statuses.${s}`)}
            </option>
          ))}
        </select>
        <select
          className="inp"
          aria-label={t('filters.kind')}
          value={filters.kind}
          onChange={(e) => patch({ kind: e.target.value as PromotionFilterValues['kind'] })}
        >
          <option value="all">{t('filters.kindAll')}</option>
          {PROMOTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
        <label className="row gap8">
          <span className="sm muted">{t('filters.from')}</span>
          <input
            className="inp"
            type="date"
            value={filters.from}
            aria-invalid={invalidDates}
            onChange={(e) => patch({ from: e.target.value })}
          />
        </label>
        <label className="row gap8">
          <span className="sm muted">{t('filters.to')}</span>
          <input
            className="inp"
            type="date"
            value={filters.to}
            aria-invalid={invalidDates}
            onChange={(e) => patch({ to: e.target.value })}
          />
        </label>
        {filtered ? (
          <button type="button" className="btn sm" onClick={clear}>
            {t('empty.clear')}
          </button>
        ) : null}
      </div>
      {invalidDates ? (
        <Banner zone="bo" tone="alert" role="alert" icon={null}>
          {t('filters.invalidDates')}
        </Banner>
      ) : null}

      {promotions.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void promotions.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {promotions.isPending ? (
        <div className="prgrid" aria-busy="true" aria-label={tu('loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} zone="bo" style={{ height: 360, borderRadius: 16 }} />
          ))}
        </div>
      ) : items.length === 0 && !promotions.isError ? (
        <EmptyState
          zone="bo"
          title={t('empty.title')}
          description={filtered ? t('empty.filtered') : t('empty.description')}
          action={
            filtered ? (
              <button type="button" className="btn mt8" onClick={clear}>
                {t('empty.clear')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="prgrid" role="list">
          {items.map((p, i) => {
            const state = switchState(p);
            const kicker = p.code ? 'coupon' : p.scheduleCount > 0 ? 'happy' : 'auto';
            const branchText =
              p.branchScope === 'ALL'
                ? t('branchesAll')
                : p.branches.map((b) => b.name).join(', ') || t('branchesNone');
            return (
              <div
                key={p.id}
                role="listitem"
                className={cn('promo', (!p.active || p.lifecycle === 'EXPIRED') && 'off')}
              >
                <div className={cn('promo-art sg', PROMO_TONES[i % PROMO_TONES.length])}>
                  <BoProductArt kind="roll" />
                  <div>
                    <div className="promo-kicker">{t(`kicker.${kicker}`)}</div>
                    <div className="promo-disc">{discountLabel(p)}</div>
                  </div>
                </div>
                <div className="promo-b">
                  <div className="row gap8">
                    <div className="promo-name grow">{p.name}</div>
                    <Pill zone="bo" tone={LIFECYCLE_TONE[p.lifecycle]}>
                      {t(`lifecycle.${p.lifecycle}`)}
                    </Pill>
                  </div>
                  {p.description ? (
                    <div className="muted sm" style={{ fontWeight: 600 }}>
                      {p.description}
                    </div>
                  ) : null}
                  <div className="pmeta">
                    <div>
                      <IconCalendar size="sm" />
                      {t('validity', { range: range(p) })}
                    </div>
                    <div>
                      <IconClock size="sm" />
                      {p.scheduleCount > 0
                        ? t('scheduleCount', { count: p.scheduleCount })
                        : t('noSchedule')}
                      {p.liveNow ? ` · ${t('liveNow')}` : ''}
                    </div>
                    <div>{branchText}</div>
                    <div>
                      {p.productScope === 'ALL'
                        ? t('productsAll')
                        : t('productsSome', { count: p.productCount })}
                      {p.dineInOnly ? ` · ${t('dineIn')}` : ''}
                    </div>
                    {p.code ? <div>{t('code', { code: p.code })}</div> : null}
                  </div>
                  <div className="row gap8 mt4">
                    <Switch
                      zone="bo"
                      checked={p.active}
                      label={t('activate', { name: p.name })}
                      disabled={!canUpdate || !p.editable || pendingId === p.id}
                      onCheckedChange={() => toggle(p)}
                    />
                    <span className="sm" style={{ fontWeight: 700 }}>
                      {t(`switchState.${state}`)}
                    </span>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="icon-btn bordered"
                      disabled={!canUpdate || !p.editable}
                      aria-label={t('editLabel', { name: p.name })}
                      title={p.editable ? t('edit') : t('notEditable')}
                      onClick={() => setDialog({ kind: 'edit', id: p.id })}
                    >
                      <IconPencil size="sm" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
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

      {dialog ? (
        <PromotionModal
          promotionId={dialog.kind === 'edit' ? dialog.id : undefined}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
