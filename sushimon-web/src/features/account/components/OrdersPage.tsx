'use client';

import { Inbox, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/data-access/errors';
import type { MyOrderSummary } from '@/lib/data-access/models';
import { usePublicBranches } from '@/features/branches/hooks';
import { HistoryOrderRow } from '@/features/orders/components/history-order-row';
import { ReorderDialog } from '@/features/orders/components/reorder-dialog';
import {
  HISTORY_TABS,
  hasActiveFilters,
  rangeProblem,
  type HistoryTab,
  type OrderHistoryFilters,
} from '@/features/orders/history/history-model';
import { useMyOrderHistory } from '@/features/orders/history/use-order-history';
import { useIsSimulation } from '@/features/orders/hooks';
import { ErrorNotice } from '@/features/store-shell/components/ErrorNotice';
import { STORE_ROUTES } from '@/features/store-shell/nav';
import { AccountSection } from './AccountSection';

const FIELD =
  'min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-fg';

/** Mensaje de error de la lista según el estado HTTP (sin convertirlo en un estado de negocio). */
function errorInfo(error: unknown): {
  kind: 'generic' | 'offline' | 'rateLimited' | 'busy';
  wait: number;
} {
  if (!isApiError(error)) return { kind: 'generic', wait: 0 };
  if (error.status === 0) return { kind: 'offline', wait: 0 };
  if (error.status === 429) return { kind: 'rateLimited', wait: error.retryAfterSec ?? 0 };
  if (error.status >= 500) return { kind: 'busy', wait: error.retryAfterSec ?? 0 };
  return { kind: 'generic', wait: 0 };
}

/**
 * F23 (spec 024 §9.2) — «Mis pedidos» REAL: `GET /v1/me/orders` con cursor y «Cargar más». Pestañas «En curso» / «Historial» y
 * filtros de sucursal y fechas que viajan AL SERVIDOR (la web no ordena ni filtra). Sin resumen «pedidos/gastado» (la API no entrega
 * conteo total). Estados: sin sesión (invitación; no llama a la API), carga, error (429/503 con espera), vacío, fin de lista.
 * Sin sondeo: se refresca al montar y al volver el foco.
 */
export function OrdersPage() {
  const t = useTranslations('orders.history');
  const tHub = useTranslations('hub');
  const simulation = useIsSimulation();
  const [tab, setTab] = useState<HistoryTab>('active');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [reorder, setReorder] = useState<MyOrderSummary | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const branches = usePublicBranches();

  const filters: OrderHistoryFilters = { tab, branchId, from, to };
  const history = useMyOrderHistory(filters);
  const problem = rangeProblem(from, to);
  const filtered = hasActiveFilters(filters);
  const clearFilters = () => {
    setBranchId(null);
    setFrom(null);
    setTo(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = HISTORY_TABS.indexOf(tab);
    let next: HistoryTab | null = null;
    if (event.key === 'ArrowRight') next = HISTORY_TABS[(index + 1) % HISTORY_TABS.length]!;
    else if (event.key === 'ArrowLeft') {
      next = HISTORY_TABS[(index + HISTORY_TABS.length - 1) % HISTORY_TABS.length]!;
    } else if (event.key === 'Home') next = HISTORY_TABS[0]!;
    else if (event.key === 'End') next = HISTORY_TABS[HISTORY_TABS.length - 1]!;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  };

  const loadMore = () => void history.fetchNextPage();

  // Un solo anuncio educado por resultado: «N pedidos» al cambiar de pestaña, filtros o al cargar más; o el rango inválido.
  const settledSig = problem
    ? `blocked|${from}|${to}`
    : history.isSuccess && !history.isFetching
      ? `${tab}|${branchId}|${from}|${to}|${history.rows.length}|${history.hasNextPage}`
      : null;
  const [announcedSig, setAnnouncedSig] = useState<string | null>(null);
  if (settledSig && settledSig !== announcedSig) {
    setAnnouncedSig(settledSig);
    setAnnouncement(
      problem
        ? t('rangeBlocked')
        : t(history.hasNextPage ? 'resultCountMore' : 'resultCount', { a: history.rows.length }),
    );
  }

  const failure = history.isError ? errorInfo(history.error) : null;
  const showSkeleton = history.validRange && history.isPending && history.gate === 'ready';
  const empty = !history.isPending && !history.isError && history.rows.length === 0;

  return (
    <AccountSection
      title={tHub('orders')}
      intro={t('intro')}
      action={simulation ? <SimulationBadge kind="simulation" /> : undefined}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <div
        role="tablist"
        aria-label={t('tabsLabel')}
        className="grid grid-cols-2 rounded-full border border-line bg-surface p-1"
      >
        {HISTORY_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls="orders-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={onKeyDown}
            className={cn(
              'inline-flex min-h-[44px] items-center justify-center rounded-full text-[14px] font-extrabold',
              tab === id ? 'bg-secondary text-onsecondary' : 'text-muted hover:text-fg',
            )}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </div>

      <fieldset className="m-0 mt-3 grid grid-cols-1 gap-3 rounded-2xl border border-line bg-surface p-3.5 min-[520px]:grid-cols-3">
        <legend className="px-1 text-[13px] font-extrabold text-muted">
          {t('filters.legend')}
        </legend>
        <label className="grid gap-1 text-[13px] font-bold">
          {t('filters.branch')}
          <select
            className={FIELD}
            value={branchId ?? ''}
            onChange={(e) => setBranchId(e.target.value || null)}
          >
            <option value="">{t('filters.allBranches')}</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[13px] font-bold">
          {t('filters.from')}
          <input
            type="date"
            className={FIELD}
            value={from ?? ''}
            max={to ?? undefined}
            aria-invalid={problem !== null || undefined}
            aria-describedby={problem ? 'orders-range-error' : undefined}
            onChange={(e) => setFrom(e.target.value || null)}
          />
        </label>
        <label className="grid gap-1 text-[13px] font-bold">
          {t('filters.to')}
          <input
            type="date"
            className={FIELD}
            value={to ?? ''}
            min={from ?? undefined}
            aria-invalid={problem !== null || undefined}
            aria-describedby={problem ? 'orders-range-error' : undefined}
            onChange={(e) => setTo(e.target.value || null)}
          />
        </label>
        {problem ? (
          <p
            id="orders-range-error"
            className="m-0 text-[13px] font-bold text-danger min-[520px]:col-span-3"
          >
            {t(`filters.range.${problem}`)}
          </p>
        ) : null}
        {filtered ? (
          <div className="min-[520px]:col-span-3">
            <button type="button" className="link-btn !min-h-[44px] text-sm" onClick={clearFilters}>
              {t('filters.clear')}
            </button>
          </div>
        ) : null}
      </fieldset>

      <div
        id="orders-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        aria-busy={showSkeleton || undefined}
        className="mt-3 flex flex-col gap-2.5"
      >
        {showSkeleton ? (
          <div className="flex flex-col gap-2.5" aria-label={t('loading')}>
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        ) : failure ? (
          <ErrorNotice
            key={history.errorUpdatedAt}
            message={t(`error.${failure.kind}`)}
            cooldownSec={failure.wait}
            onRetry={() => void history.refetch()}
          />
        ) : !history.validRange ? (
          <p className="m-0 rounded-2xl border border-dashed border-line px-5 py-6 text-center font-bold">
            {t('rangeBlocked')}
          </p>
        ) : empty ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-5 py-8 text-center">
            <Inbox className="h-8 w-8 text-muted" aria-hidden="true" />
            <p className="m-0 font-bold">
              {filtered ? t('emptyFiltered') : t(tab === 'active' ? 'emptyActive' : 'emptyHistory')}
            </p>
            {filtered ? (
              <button type="button" className="btn !min-h-[44px]" onClick={clearFilters}>
                {t('filters.clear')}
              </button>
            ) : (
              <>
                <Link
                  href={STORE_ROUTES.menu}
                  className="btn btn-primary !min-h-[44px] no-underline"
                >
                  {t('goMenu')}
                </Link>
                <p className="m-0 max-w-[48ch] text-[13px] text-muted">
                  {t('guestNote')}{' '}
                  <Link
                    href={STORE_ROUTES.track}
                    className="link-btn inline-flex !min-h-[44px] items-center text-[13px]"
                  >
                    {t('guestLookup')}
                  </Link>
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {history.rows.map((order) => (
                <li key={order.id}>
                  <HistoryOrderRow order={order} onReorder={setReorder} />
                </li>
              ))}
            </ul>
            {history.isFetchNextPageError ? (
              <ErrorNotice
                key={history.errorUpdatedAt}
                message={t('loadMoreError')}
                onRetry={() => void loadMore()}
              />
            ) : history.hasNextPage ? (
              <button
                type="button"
                className="btn !min-h-[44px] self-center"
                disabled={history.isFetchingNextPage}
                aria-busy={history.isFetchingNextPage || undefined}
                onClick={loadMore}
              >
                {history.isFetchingNextPage ? (
                  <LoaderCircle className="anim-spin h-4 w-4" aria-hidden="true" />
                ) : null}{' '}
                {history.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
              </button>
            ) : history.rows.length > 0 ? (
              <p className="m-0 text-center text-[13px] text-muted">{t('end')}</p>
            ) : null}
          </>
        )}
      </div>

      {reorder ? (
        <ReorderDialog
          orderId={reorder.id}
          displayNumber={reorder.displayNumber}
          inProgress={!reorder.terminal}
          onClose={() => setReorder(null)}
        />
      ) : null}
    </AccountSection>
  );
}
