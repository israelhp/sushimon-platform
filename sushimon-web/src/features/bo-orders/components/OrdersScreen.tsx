'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { IconHistory } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { useNow } from '@/features/backoffice-shell/use-now';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { cn } from '@/lib/cn';
import { BACKOFFICE_COLUMNS, fromBackofficeColumn } from '@/lib/order-status';
import { isForbidden } from '../error-message';
import {
  countByColumn,
  filterOrders,
  isActive,
  sortForTable,
  type OrderStatusFilter,
  type OrderTypeFilter,
} from '../order-view';
import { useScopedOrders } from '../use-scoped-orders';
import { KanbanBoard } from './KanbanBoard';
import { OrdersTable } from './OrdersTable';

type View = 'kanban' | 'tabla';

/** Pantalla Pedidos: tablero kanban o tabla con filtros y búsqueda. */
export function OrdersScreen() {
  const t = useTranslations('backoffice.orders');
  const tt = useTranslations('backoffice.orders.table');
  const tu = useTranslations('ui');
  const shell = useShell();
  const now = useNow();
  const orders = useScopedOrders();
  const [view, setView] = useState<View>('kanban');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<OrderStatusFilter>('todos');
  const [type, setType] = useState<OrderTypeFilter>('todos');

  const all = useMemo(() => orders.data ?? [], [orders.data]);
  const activeCount = all.filter(isActive).length;
  const newCount = all.filter((o) => o.status === 'received').length;

  // Filtros de búsqueda/tipo (la sucursal ya viene filtrada por el shell).
  const filtered = useMemo(
    () => filterOrders(all, { query, type, branchId: undefined }),
    [all, query, type],
  );
  const counts = countByColumn(filtered);
  const tableRows = useMemo(
    () =>
      sortForTable(
        status === 'todos'
          ? filtered
          : filtered.filter((o) => fromBackofficeColumn(status).includes(o.status)),
      ),
    [filtered, status],
  );

  if (isForbidden(orders.error)) return <ForbiddenScreen reason="server" />;

  const tabs: TabItem<OrderStatusFilter>[] = [
    { value: 'todos', label: tt('all'), count: filtered.length },
    ...BACKOFFICE_COLUMNS.map((c) => ({ value: c, label: t(`columns.${c}`), count: counts[c] })),
    { value: 'cancelado', label: t('columns.cancelado'), count: counts.cancelado },
  ];

  const clearFilters = () => {
    setQuery('');
    setStatus('todos');
    setType('todos');
  };

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
          {t('summary', { active: activeCount, fresh: newCount })}
        </span>
        <span className="spacer" />
        <SearchInput
          zone="bo"
          inline
          value={query}
          onValueChange={setQuery}
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
        />
      </div>

      {orders.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void orders.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {orders.isPending ? (
        <div className="board" aria-busy="true">
          {BACKOFFICE_COLUMNS.map((c) => (
            <Skeleton key={c} zone="bo" style={{ height: 220, borderRadius: 16 }} />
          ))}
        </div>
      ) : view === 'kanban' ? (
        <KanbanBoard orders={filtered} now={now} />
      ) : (
        <>
          <Tabs
            zone="bo"
            label={tt('tabsLabel')}
            items={tabs}
            value={status}
            onChange={setStatus}
          />
          <div className="toolbar">
            <span className="zone-tag">{tt('today')}</span>
            <span className="flabel">{tt('type')}</span>
            <SegmentedControl
              zone="bo"
              label={tt('typeLabel')}
              value={type}
              onChange={setType}
              options={[
                { value: 'todos', label: tt('typeAll') },
                { value: 'delivery', label: t('type.delivery') },
                { value: 'pickup', label: t('type.pickup') },
              ]}
            />
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
          <div className="card">
            <div className="card-h">
              <h2>
                {status === 'todos'
                  ? tt('titleAll')
                  : t(`status.${status === 'cancelado' ? 'cancelado' : status}`)}
              </h2>
              <span className="count-chip">{tableRows.length}</span>
            </div>
            <OrdersTable orders={tableRows} />
          </div>
        </>
      )}
    </div>
  );
}
