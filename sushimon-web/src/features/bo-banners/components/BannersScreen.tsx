'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
  IconCalendar,
  IconChevronDown,
  IconChevronUp,
  IconPencil,
  IconPlus,
} from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useNow } from '@/features/backoffice-shell/use-now';
import {
  useAdminBannerOrder,
  useAdminBanners,
  useMoveBanner,
  useSetBannerStatus,
} from '@/features/banners/hooks';
import { MediaThumb } from '@/features/bo-catalog/components/MediaThumb';
import { isForbidden } from '@/features/bo-orders/error-message';
import { useAdminBranches } from '@/features/branches/hooks';
import { queryKeys } from '@/features/query-keys';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { BANNER_SEARCH_MAX, isBannerExpiredByDate } from '@/lib/banner-rules';
import { cn } from '@/lib/cn';
import type { AdminBannerSummary } from '@/lib/data-access/models';
import { formatDateTime } from '@/lib/format';
import {
  EMPTY_FILTERS,
  LIFECYCLE_FILTERS,
  bannerServerError,
  filtersToQuery,
  hasActiveFilters,
  type BannerFilterValues,
} from '../banners-view';
import { BannerModal } from './BannerModal';

const PAGE_SIZE = 10;

const LIFECYCLE_TONE: Record<AdminBannerSummary['lifecycle'], PillTone> = {
  PUBLISHED: 'success',
  SCHEDULED: 'info',
  EXPIRED: 'warning',
  INACTIVE: 'muted',
};

type Dialog = { kind: 'create' } | { kind: 'edit'; id: string };

/**
 * Pantalla Banners (F16, sin prototipo: sigue el patrón de Promociones): lista PAGINADA del servidor en el orden de la tienda
 * (prioridad), con filtros (sucursal, estado derivado y búsqueda por título o código), alta y edición con formulario validado y
 * previsualización, activar/desactivar y reordenar con botones subir/bajar (teclado; sin arrastrar). Ver exige `banners.read`;
 * crear `banners.create`; editar, activar y reordenar `banners.update` (el reordenado, con alcance global). La UI solo oculta o
 * deshabilita: la API decide (401/403/404/409/422/503). Sin borrado.
 */
export function BannersScreen() {
  const t = useTranslations('backoffice.banners');
  const tu = useTranslations('ui');
  const toast = useToast();
  const qc = useQueryClient();
  const { can, grants } = useShell();
  const now = useNow();
  const setStatus = useSetBannerStatus();
  const move = useMoveBanner();
  const branchesQuery = useAdminBranches({ pageSize: 100 });

  const [filters, setFilters] = useState<BannerFilterValues>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** Tras mover un banner el foco vuelve a su botón (la fila se reordena y el navegador lo perdería). */
  /** Error persistente de mover/activar (409/422/503…): se muestra con `role="alert"` además del aviso temporal. */
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingFocusRef = useRef<{ code: string; dir: 'up' | 'down' } | null>(null);

  const debounced = useDebouncedValue(filters.q, 300);
  const query = filtersToQuery({ ...filters, q: debounced }, page, PAGE_SIZE);
  const banners = useAdminBanners(query);
  const order = useAdminBannerOrder();

  const items = banners.data?.items ?? [];
  const total = banners.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const branches = branchesQuery.data?.items ?? [];
  const filtered = hasActiveFilters(filters);

  const canCreate = can('banners.create');
  const canUpdate = can('banners.update');
  const canReorder = Boolean(grants['banners.update']?.allBranches);
  const noticeKey =
    canCreate && canUpdate ? null : canCreate || canUpdate ? 'noticeScope' : 'noticeReadOnly';

  // Banners que participan del orden: no vencidos por fecha (el servidor exige exactamente ese conjunto).
  const orderable = now
    ? (order.data ?? []).filter((b) => !isBannerExpiredByDate(b, now)).map((b) => b.id)
    : [];

  const movingNow = move.isPending || pendingId !== null;
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target || movingNow) return;
    pendingFocusRef.current = null;
    const rowEl = document.querySelector(
      `[data-testid="banner-row"][data-code="${CSS.escape(target.code)}"]`,
    );
    const wanted = rowEl?.querySelector<HTMLButtonElement>(`[data-move="${target.dir}"]`);
    const other = rowEl?.querySelector<HTMLButtonElement>(
      `[data-move="${target.dir === 'up' ? 'down' : 'up'}"]`,
    );
    (wanted && !wanted.disabled ? wanted : other)?.focus();
  }, [movingNow, banners.data]);

  if (isForbidden(banners.error)) return <ForbiddenScreen reason="server" />;

  const patch = (change: Partial<BannerFilterValues>) => {
    setFilters((f) => ({ ...f, ...change }));
    setPage(1);
  };
  const clear = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const fail = (error: unknown) => {
    const parsed = bannerServerError(error);
    const message = t('saveError', { message: parsed.message });
    toast.notify(message);
    setActionError(message);
    if (parsed.reload) void qc.invalidateQueries({ queryKey: queryKeys.backoffice.banners });
  };

  const toggle = (b: AdminBannerSummary) => {
    setActionError(null);
    setPendingId(b.id);
    setStatus.mutate(
      { id: b.id, active: !b.active },
      {
        onSuccess: () => toast.notify(t(b.active ? 'toast.off' : 'toast.on', { name: b.title })),
        onError: fail,
        onSettled: () => setPendingId(null),
      },
    );
  };

  const reorder = (b: AdminBannerSummary, direction: 'up' | 'down') => {
    if (!now) return;
    setActionError(null);
    setPendingId(b.id);
    move.mutate(
      { id: b.id, direction, now },
      {
        onSuccess: (moved) => {
          pendingFocusRef.current = { code: b.code, dir: direction };
          if (moved)
            toast.notify(
              t(direction === 'up' ? 'toast.movedUp' : 'toast.movedDown', { name: b.title }),
            );
        },
        onError: fail,
        onSettled: () => setPendingId(null),
      },
    );
  };

  const switchState = (b: AdminBannerSummary) =>
    b.lifecycle === 'EXPIRED'
      ? 'expired'
      : !b.active
        ? 'off'
        : b.lifecycle === 'SCHEDULED'
          ? 'scheduled'
          : b.visibleNow
            ? 'on'
            : 'hidden';

  const period = (b: AdminBannerSummary) =>
    !b.startsAt && !b.endsAt
      ? t('period.always')
      : t('period.range', {
          from: b.startsAt ? formatDateTime(b.startsAt, 'es') : t('period.now'),
          to: b.endsAt ? formatDateTime(b.endsAt, 'es') : t('period.noEnd'),
        });

  const ctaText = (b: AdminBannerSummary) =>
    b.cta.type === 'CATEGORY' || b.cta.type === 'PRODUCT'
      ? t('cta.withTarget', {
          type: t(`cta.types.${b.cta.type}`),
          target: b.cta.targetLabel ?? '—',
        })
      : b.cta.type === 'PAGE'
        ? t('cta.withTarget', {
            type: t(`cta.types.PAGE`),
            target: b.cta.page ? t(`cta.pages.${b.cta.page}`) : '—',
          })
        : t(`cta.types.${b.cta.type}`);

  const reorderHint = !canReorder
    ? t('order.needGlobal')
    : filtered
      ? t('order.clearFilters')
      : null;

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
          disabled={!canCreate || banners.isPending}
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
      <Banner zone="bo" tone="info" role="note">
        {t('publishDelay')} {t('uploadAdminOnly')}
      </Banner>

      <div className="toolbar" role="search" aria-label={t('filters.label')}>
        <SearchInput
          zone="bo"
          inline
          value={filters.q}
          onValueChange={(q) => patch({ q })}
          label={t('filters.search')}
          placeholder={t('filters.searchPlaceholder')}
          maxLength={BANNER_SEARCH_MAX}
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
          value={filters.lifecycle}
          onChange={(e) => patch({ lifecycle: e.target.value as BannerFilterValues['lifecycle'] })}
        >
          <option value="all">{t('filters.statusAll')}</option>
          {LIFECYCLE_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(`lifecycle.${s}`)}
            </option>
          ))}
        </select>
        {filtered ? (
          <button type="button" className="btn sm" onClick={clear}>
            {t('empty.clear')}
          </button>
        ) : null}
      </div>
      {reorderHint ? (
        <p className="xs muted" style={{ fontWeight: 600, margin: '4px 0 8px' }}>
          {reorderHint} {t('order.tieNote')}
        </p>
      ) : (
        <p className="xs muted" style={{ fontWeight: 600, margin: '4px 0 8px' }}>
          {t('order.help')} {t('order.tieNote')}
        </p>
      )}

      {actionError ? (
        <Banner zone="bo" tone="alert" role="alert">
          {actionError}{' '}
          <button type="button" className="link-btn" onClick={() => setActionError(null)}>
            {tu('close')}
          </button>
        </Banner>
      ) : null}

      {banners.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void banners.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {banners.isPending ? (
        <div style={{ display: 'grid', gap: 12 }} aria-busy="true" aria-label={tu('loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} zone="bo" style={{ height: 110, borderRadius: 16 }} />
          ))}
        </div>
      ) : items.length === 0 && !banners.isError ? (
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
        <ul style={{ display: 'grid', gap: 12, listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((b) => {
            const state = switchState(b);
            const expired = now ? isBannerExpiredByDate(b, now) : b.lifecycle === 'EXPIRED';
            const at = orderable.indexOf(b.id);
            const sortable =
              !expired && at >= 0 && !filtered && canUpdate && canReorder && b.editable;
            const busy = pendingId === b.id || move.isPending;
            const branchText =
              b.branchScope === 'ALL'
                ? t('branchesAll')
                : b.branches.map((x) => x.name).join(', ') || t('branchesNone');
            return (
              <li
                key={b.id}
                data-testid="banner-row"
                data-code={b.code}
                className={cn(
                  'card grid grid-cols-1 min-[560px]:grid-cols-[minmax(120px,200px)_1fr_auto]',
                  (!b.active || expired) && 'off',
                )}
                style={{
                  gap: 12,
                  padding: 14,
                  alignItems: 'start',
                  opacity: !b.active || expired ? 0.85 : 1,
                }}
              >
                <div
                  style={{
                    aspectRatio: '3 / 1',
                    overflow: 'hidden',
                    borderRadius: 10,
                    width: '100%',
                  }}
                >
                  <MediaThumb url={b.image.url} fill />
                </div>
                <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                  <div className="row gap8" style={{ flexWrap: 'wrap' }}>
                    <strong style={{ overflowWrap: 'anywhere' }}>{b.title}</strong>
                    <Pill zone="bo" tone={LIFECYCLE_TONE[b.lifecycle]}>
                      {t(`lifecycle.${b.lifecycle}`)}
                    </Pill>
                    {b.hasEnglish ? (
                      <Pill zone="bo" tone="confirmed" role="img" aria-label={t('hasEnglish')}>
                        EN
                      </Pill>
                    ) : null}
                  </div>
                  <div className="xs muted" style={{ fontWeight: 600 }}>
                    {t('code', { code: b.code })} · {t('priority', { n: b.sortOrder })}
                  </div>
                  <div className="xs" style={{ fontWeight: 600 }}>
                    <IconCalendar size="sm" /> {period(b)}
                  </div>
                  <div className="xs" style={{ fontWeight: 600 }}>
                    {ctaText(b)} · {branchText}
                    {b.promotion ? ` · ${t('promotion', { name: b.promotion.name })}` : ''}
                  </div>
                  {b.lifecycle === 'PUBLISHED' && b.hiddenReason ? (
                    <div
                      className="xs"
                      role="note"
                      style={{ fontWeight: 700, color: 'var(--bo-red-text)' }}
                    >
                      {t(`hidden.${b.hiddenReason}`)}
                    </div>
                  ) : null}
                  <div className="row gap8 mt4">
                    <Switch
                      zone="bo"
                      checked={b.active}
                      label={t('activate', { name: b.title })}
                      disabled={!canUpdate || !b.editable || busy}
                      onCheckedChange={() => toggle(b)}
                    />
                    <span className="sm" style={{ fontWeight: 700 }}>
                      {t(`switchState.${state}`)}
                    </span>
                  </div>
                </div>
                <div className="row gap8" style={{ alignItems: 'center' }}>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    data-move="up"
                    aria-label={t('order.up', { name: b.title })}
                    title={reorderHint ?? undefined}
                    disabled={!sortable || busy || at <= 0}
                    onClick={() => reorder(b, 'up')}
                  >
                    <IconChevronUp size="sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    data-move="down"
                    aria-label={t('order.down', { name: b.title })}
                    title={reorderHint ?? undefined}
                    disabled={!sortable || busy || at === orderable.length - 1}
                    onClick={() => reorder(b, 'down')}
                  >
                    <IconChevronDown size="sm" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn bordered"
                    disabled={!canUpdate || !b.editable}
                    aria-label={t('editLabel', { name: b.title })}
                    title={b.editable ? t('edit') : t('notEditable')}
                    onClick={() => setDialog({ kind: 'edit', id: b.id })}
                  >
                    <IconPencil size="sm" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
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
        <BannerModal
          bannerId={dialog.kind === 'edit' ? dialog.id : undefined}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
