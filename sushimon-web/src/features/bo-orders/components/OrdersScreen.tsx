'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { IconHistory } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/data-access/errors';
import { addDaysISO, localDate } from '@/lib/time';
import type { AdminOrderListFilters } from '@/services/admin-orders';
import {
  BOARD_GROUPS,
  statusesOfGroup,
  type BoardGroup,
  type BoardGroupKey,
} from '../admin-orders-model';
import { useBoardFeed } from '../board-feed';
import { useAdminOrderList } from '../hooks';
import { KanbanBoard } from './KanbanBoard';
import { LiveStatus } from './LiveStatus';
import { OrdersTable } from './OrdersTable';

type View = 'kanban' | 'tabla';
type TabValue = 'todos' | BoardGroupKey;
type TypeFilter = 'todos' | 'PICKUP' | 'DELIVERY';
type Range = 'hoy' | '7d' | 'custom';

const MAX_RANGE_DAYS = 92;
const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN = 2;

/** Instantes con zona de Guatemala (UTC−6, sin horario de verano): el servidor filtra por `placedAt`. */
const dayStart = (day: string) => `${day}T00:00:00-06:00`;
const dayEnd = (day: string) => `${day}T23:59:59.999-06:00`;
const diffDays = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** Pantalla Pedidos real: tablero (sondeado por el shell) o tabla (primera página sondeada) con filtros enviados al servidor. */
export function OrdersScreen() {
  const t = useTranslations('backoffice.orders');
  const tl = useTranslations('backoffice.orders.live');
  const tt = useTranslations('backoffice.orders.table');
  const tu = useTranslations('ui');
  const shell = useShell();
  const feed = useBoardFeed();
  const [view, setView] = useState<View>('kanban');
  const [tab, setTab] = useState<TabValue>('todos');
  const [type, setType] = useState<TypeFilter>('todos');
  const [range, setRange] = useState<Range>('hoy');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = feed.serverNow !== null ? localDate(new Date(feed.serverNow)) : null;
  const from =
    range === 'custom' ? fromDay || today : range === '7d' && today ? addDaysISO(today, -6) : today;
  const to = range === 'custom' ? toDay || from : today;
  const rangeInvalid =
    from !== null && to !== null && (to < from || diffDays(from, to) >= MAX_RANGE_DAYS);

  const filters = useMemo<AdminOrderListFilters>(
    () => ({
      branchId: shell.branchId,
      status: tab === 'todos' ? undefined : statusesOfGroup(tab),
      fulfillmentType: type === 'todos' ? undefined : type,
      q: query.length >= SEARCH_MIN ? query : undefined,
      from: from ? dayStart(from) : undefined,
      to: to ? dayEnd(to) : undefined,
      limit: 25,
    }),
    [shell.branchId, tab, type, query, from, to],
  );
  const tableActive = view === 'tabla' && today !== null && !rangeInvalid;
  const list = useAdminOrderList(filters, { poll: tableActive, enabled: tableActive });

  const onSearch = (value: string) => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(value.trim()), SEARCH_DEBOUNCE_MS);
  };
  const clearFilters = () => {
    if (timer.current) clearTimeout(timer.current);
    setDraft('');
    setQuery('');
    setTab('todos');
    setType('todos');
    setRange('hoy');
    setFromDay('');
    setToDay('');
  };
  const showAll = (group: BoardGroup) => {
    setTab(group.key);
    setRange('7d');
    setView('tabla');
  };

  const forbidden = [feed.poll.error, view === 'tabla' ? list.error : null].some(
    (e) => isApiError(e) && e.status === 403,
  );
  if (forbidden) return <ForbiddenScreen reason="server" />;

  const active = feed.board?.summary.active ?? 0;
  const tabs: TabItem<TabValue>[] = [
    { value: 'todos', label: tt('all') },
    ...BOARD_GROUPS.map((g) => ({ value: g.key as TabValue, label: tl(`board.groups.${g.key}`) })),
  ];
  const status = view === 'kanban' ? feed.poll : list;

  return (
    <div className="page" style={{ animation: 'none' }}>
      <div className="toolbar">
        <SegmentedControl
          zone="bo"
          label={t('viewLabel')}
          value={view}
          onChange={setView}
          options={[
            { value: 'kanban', label: t('viewBoard') },
            { value: 'tabla', label: t('viewTable') },
          ]}
        />
        <span className="sm" style={{ fontWeight: 700 }}>
          {tl('summary', { active, pending: feed.pendingCount })}
          {feed.freshCount > 0 ? (
            <span className="count-chip fresh-chip" style={{ marginLeft: 8 }}>
              {tl('board.freshCount', { count: feed.freshCount })}
            </span>
          ) : null}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className={cn('btn sm', shell.soundOn && 'btn-primary')}
          aria-pressed={shell.soundOn}
          onClick={() => shell.setSoundOn(!shell.soundOn)}
        >
          {shell.soundOn ? tl('sound.on') : tl('sound.off')}
        </button>
        <SearchInput
          zone="bo"
          inline
          value={draft}
          onValueChange={onSearch}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
        />
      </div>

      <LiveStatus poll={status} clientNow={feed.clientNow} />
      {feed.pendingCount > 0 ? (
        <Banner zone="bo" tone="alert">
          {tl('pendingNotice', { count: feed.pendingCount })}
        </Banner>
      ) : null}

      {view === 'kanban' ? (
        feed.poll.isLoading || (!feed.groups && !feed.poll.errorKind) ? (
          <div className="board" aria-busy="true">
            {BOARD_GROUPS.map((g) => (
              <Skeleton key={g.key} zone="bo" style={{ height: 220, borderRadius: 16 }} />
            ))}
          </div>
        ) : feed.groups ? (
          // Interactuar con el tablero (no con la búsqueda ni otros controles) da por vistos los nuevos.
          <div
            className={cn(feed.poll.failing && 'is-stale')}
            onPointerDownCapture={feed.dismissFresh}
            onKeyDownCapture={feed.dismissFresh}
          >
            <KanbanBoard groups={feed.groups} onShowAll={showAll} />
          </div>
        ) : null
      ) : (
        <>
          <Tabs zone="bo" label={tt('tabsLabel')} items={tabs} value={tab} onChange={setTab} />
          <div className="toolbar">
            <span className="flabel">{tt('type')}</span>
            <SegmentedControl
              zone="bo"
              label={tt('typeLabel')}
              value={type}
              onChange={setType}
              options={[
                { value: 'todos', label: tt('typeAll') },
                { value: 'DELIVERY', label: t('type.delivery') },
                { value: 'PICKUP', label: t('type.pickup') },
              ]}
            />
            <span className="flabel">{tl('table.range')}</span>
            <SegmentedControl
              zone="bo"
              label={tl('table.rangeLabel')}
              value={range}
              onChange={setRange}
              options={[
                { value: 'hoy', label: tt('today') },
                { value: '7d', label: tl('table.last7') },
                { value: 'custom', label: tl('table.custom') },
              ]}
            />
            {range === 'custom' ? (
              <>
                <label className="flabel" htmlFor="orders-from">
                  {tl('table.from')}
                </label>
                <input
                  id="orders-from"
                  type="date"
                  className="inp"
                  style={{ width: 150 }}
                  value={fromDay}
                  max={today ?? undefined}
                  onChange={(e) => setFromDay(e.target.value)}
                />
                <label className="flabel" htmlFor="orders-to">
                  {tl('table.to')}
                </label>
                <input
                  id="orders-to"
                  type="date"
                  className="inp"
                  style={{ width: 150 }}
                  value={toDay}
                  max={today ?? undefined}
                  onChange={(e) => setToDay(e.target.value)}
                />
              </>
            ) : null}
            <span className="flabel">{tt('branch')}</span>
            <div className="chips" role="group" aria-label={tt('branchLabel')}>
              <button
                type="button"
                className={cn('chip', !shell.branchId && 'on')}
                aria-pressed={!shell.branchId}
                disabled={shell.branchLocked && !!shell.branchId}
                onClick={() => shell.setBranchId(undefined)}
              >
                {tt('allShort')}
              </button>
              {shell.branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={cn('chip', shell.branchId === b.id && 'on')}
                  aria-pressed={shell.branchId === b.id}
                  disabled={shell.branchLocked && shell.branchId !== b.id}
                  onClick={() => shell.setBranchId(b.id)}
                >
                  {b.name}
                </button>
              ))}
            </div>
            <button type="button" className="link-btn" onClick={clearFilters}>
              {tt('clear')}
            </button>
            <span className="spacer" />
            {shell.can('reports.read') ? (
              <Link className="btn sm" href="/backoffice/reportes">
                <IconHistory />
                {tt('history')}
              </Link>
            ) : null}
          </div>
          {rangeInvalid ? (
            <Banner zone="bo" tone="warning" role="alert">
              {tl('table.rangeInvalid', { days: MAX_RANGE_DAYS })}
            </Banner>
          ) : null}
          {query === '' && draft.trim().length === 1 ? (
            <div className="xs muted" role="status" style={{ fontWeight: 600 }}>
              {tl('table.searchMin', { min: SEARCH_MIN })}
            </div>
          ) : null}
          <div className="card">
            <div className="card-h">
              <h2>{tab === 'todos' ? tt('titleAll') : tl(`board.groups.${tab}`)}</h2>
              <span className="count-chip">
                {list.items.length}
                {list.nextCursor ? '+' : ''}
              </span>
            </div>
            {list.isLoading || (tableActive && !list.data && !list.errorKind) ? (
              <div className="col gap8" aria-busy="true" style={{ padding: 12 }}>
                <Skeleton zone="bo" style={{ height: 48, borderRadius: 10 }} />
                <Skeleton zone="bo" style={{ height: 48, borderRadius: 10 }} />
                <Skeleton zone="bo" style={{ height: 48, borderRadius: 10 }} />
              </div>
            ) : (
              <div
                className={cn(list.failing && 'is-stale')}
                onPointerDownCapture={feed.dismissFresh}
                onKeyDownCapture={feed.dismissFresh}
              >
                <OrdersTable orders={list.items} today={today} fresh={feed.fresh} />
              </div>
            )}
            {list.nextCursor ? (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={list.loadingMore}
                  aria-busy={list.loadingMore}
                  onClick={() => void list.loadMore()}
                >
                  {list.loadingMore ? tl('table.loading') : tl('table.loadMore')}
                </button>
              </div>
            ) : null}
            {list.moreError ? (
              <Banner zone="bo" tone="danger" role="alert">
                {t('error')}{' '}
                <button type="button" className="link-btn" onClick={() => void list.loadMore()}>
                  {tu('retry')}
                </button>
              </Banner>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
