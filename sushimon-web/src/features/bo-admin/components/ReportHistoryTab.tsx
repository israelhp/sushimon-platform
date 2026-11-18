'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconEye,
  IconFork,
} from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Kpi } from '@/components/ui/Kpi';
import { StatusPill } from '@/components/ui/Pill';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useReportHistory } from '@/features/backoffice/hooks';
import { PopoverRoot, usePopover } from '@/features/backoffice-shell/use-popover';
import { branchShortName, useShell } from '@/features/backoffice-shell/shell-context';
import { COLUMN_TONE, useOrderText } from '@/features/bo-orders/use-order-text';
import { cn } from '@/lib/cn';
import type { DraftOrder } from '@/lib/data-access/models';
import { formatMoney } from '@/lib/format';
import { toBackofficeColumn } from '@/lib/order-status';
import { addDaysISO } from '@/lib/time';
import { dayLong, dayWithMonth, daysInRange } from '../format';
import {
  DEFAULT_HISTORY_FILTERS,
  HISTORY_PAGE,
  activeFilterCount,
  filterHistory,
  groupByDay,
  historyProductOptions,
  historyTotals,
  orderClock,
  presetRange,
  productsText,
  sortHistory,
  type DateRange,
  type DayGroup,
  type HistoryFilters,
} from '../reports-view';
import { HistoryOrderDrawer } from './HistoryOrderDrawer';

export interface ReportHistoryTabProps {
  range: DateRange;
  onRange: (range: DateRange) => void;
  /** Hoy según el reloj de la demo (`YYYY-MM-DD`). */
  today: string;
  /** Primer día con datos (de la API). */
  minDate: string | undefined;
  clipped: boolean;
  branchId: string | undefined;
}

type Mode = 'dia' | 'rango';

/** Pestaña "Historial de pedidos": periodo (un día o rango), filtros, KPIs y tabla agrupada por día. */
export function ReportHistoryTab({
  range,
  onRange,
  today,
  minDate,
  clipped,
  branchId,
}: ReportHistoryTabProps) {
  const t = useTranslations('backoffice.reports.history');
  const tu = useTranslations('ui');
  const tr = useTranslations('backoffice.reports');
  const toast = useToast();
  const shell = useShell();
  const history = useReportHistory({ from: range.from, to: range.to, branchId });
  const [modeState, setModeState] = useState<Mode>('dia');
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const [selected, setSelected] = useState<DraftOrder | null>(null);
  const productPopover = usePopover();

  const single = range.from === range.to;
  const mode: Mode = single
    ? modeState === 'rango' && range.key === 'custom'
      ? 'rango'
      : 'dia'
    : 'rango';

  const setFilter = <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setLimit(HISTORY_PAGE);
  };
  const changeRange = (next: DateRange) => {
    setLimit(HISTORY_PAGE);
    onRange(next);
  };
  const dayRange = (iso: string): DateRange => ({
    key: iso === today ? 'hoy' : iso === addDaysISO(today, -1) ? 'ayer' : 'custom',
    from: iso,
    to: iso,
  });

  const orders = useMemo(() => history.data ?? [], [history.data]);
  const filtered = useMemo(() => filterHistory(orders, filters), [orders, filters]);
  const sorted = useMemo(() => sortHistory(filtered, filters.sort), [filtered, filters.sort]);
  const totals = useMemo(() => historyTotals(filtered), [filtered]);
  const products = useMemo(() => historyProductOptions(orders), [orders]);
  const shown = sorted.slice(0, limit);
  const byDay = filters.sort === 'recientes' || filters.sort === 'antiguos';
  const groups: DayGroup[] = byDay
    ? groupByDay(sorted, limit)
    : shown.length
      ? [
          {
            day: '',
            count: sorted.length,
            sales: totals.sales,
            cancelled: totals.cancelled,
            rows: shown,
          },
        ]
      : [];
  const filtersOn = activeFilterCount(filters);
  const hasToday = range.to === today;

  const periodLabel = single
    ? dayLong(range.from)
    : tr('rangeLabelDays', {
        from: dayWithMonth(range.from),
        to: dayWithMonth(range.to),
        days: daysInRange(range.from, range.to),
      });
  const productLabel =
    filters.product === 'all'
      ? t('productAll')
      : (products.find((p) => p.id === filters.product)?.name ?? t('productAll'));

  const seg = <T extends string>(
    label: string,
    value: T,
    key: keyof HistoryFilters,
    options: { value: T; label: string }[],
  ) => (
    <SegmentedControl
      zone="bo"
      label={label}
      value={value}
      options={options}
      onChange={(v) => setFilter(key, v as HistoryFilters[typeof key])}
    />
  );

  return (
    <>
      <section className="card">
        <div className="card-h">
          <div className="grow">
            <h2>{t('periodTitle')}</h2>
            <div className="muted sm" style={{ fontWeight: 600 }}>
              {periodLabel}
            </div>
          </div>
          <SegmentedControl
            zone="bo"
            label={t('modeGroup')}
            value={mode}
            options={[
              { value: 'dia', label: t('modeDay') },
              { value: 'rango', label: t('modeRange') },
            ]}
            onChange={(m) => {
              setModeState(m);
              if (m === 'dia') changeRange(dayRange(range.to));
              else changeRange(presetRange('7d', today));
            }}
          />
        </div>
        <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'dia' ? (
            <div className="toolbar">
              <button
                type="button"
                className="icon-btn bordered"
                aria-label={t('prevDay')}
                disabled={!!minDate && range.from <= minDate}
                onClick={() => changeRange(dayRange(addDaysISO(range.from, -1)))}
              >
                <IconChevronLeft size="sm" />
              </button>
              <input
                className="inp"
                type="date"
                style={{ width: 180 }}
                aria-label={t('dayLabel')}
                min={minDate}
                max={today}
                value={range.from}
                onChange={(e) => e.target.value && changeRange(dayRange(e.target.value))}
              />
              <button
                type="button"
                className="icon-btn bordered"
                aria-label={t('nextDay')}
                disabled={range.from >= today}
                onClick={() => changeRange(dayRange(addDaysISO(range.from, 1)))}
              >
                <IconChevronRight size="sm" />
              </button>
              <SegmentedControl
                zone="bo"
                label={`${t('dayToday')} / ${t('dayYesterday')}`}
                value={range.key}
                options={[
                  { value: 'hoy', label: t('dayToday') },
                  { value: 'ayer', label: t('dayYesterday') },
                ]}
                onChange={(k) => changeRange(presetRange(k === 'ayer' ? 'ayer' : 'hoy', today))}
              />
            </div>
          ) : (
            <div className="toolbar">
              <label className="row gap6 sm" style={{ fontWeight: 800 }}>
                {tr('from')}
                <input
                  className="inp"
                  type="date"
                  style={{ height: 40, width: 160 }}
                  min={minDate}
                  max={today}
                  value={range.from}
                  onChange={(e) =>
                    e.target.value &&
                    changeRange({ key: 'custom', from: e.target.value, to: range.to })
                  }
                />
              </label>
              <label className="row gap6 sm" style={{ fontWeight: 800 }}>
                {tr('to')}
                <input
                  className="inp"
                  type="date"
                  style={{ height: 40, width: 160 }}
                  min={minDate}
                  max={today}
                  value={range.to}
                  onChange={(e) =>
                    e.target.value &&
                    changeRange({ key: 'custom', from: range.from, to: e.target.value })
                  }
                />
              </label>
              <SegmentedControl
                zone="bo"
                label={tr('rangeGroup')}
                value={range.key}
                options={[
                  { value: '7d', label: t('range7') },
                  { value: '30d', label: t('range30') },
                  { value: 'mes', label: t('rangeMonth') },
                ]}
                onChange={(k) => {
                  setModeState('rango');
                  changeRange(presetRange(k === '30d' ? '30d' : k === 'mes' ? 'mes' : '7d', today));
                }}
              />
            </div>
          )}
          {clipped ? (
            <Banner zone="bo" tone="warning">
              {t('clipped', { min: minDate ? dayLong(minDate) : '' })}
            </Banner>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <h2>{t('filters')}</h2>
          {filtersOn ? (
            <>
              <span className="count-chip">{t('filtersOn', { count: filtersOn })}</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setFilters(DEFAULT_HISTORY_FILTERS);
                  setLimit(HISTORY_PAGE);
                }}
              >
                {t('clear')}
              </button>
            </>
          ) : null}
        </div>
        <div className="card-b hfilters">
          <div className="field">
            <span className="flabel">{t('search')}</span>
            <SearchInput
              zone="bo"
              clearable
              value={filters.search}
              onValueChange={(v) => setFilter('search', v)}
              label={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
            />
          </div>
          <div className="field">
            <span className="flabel" id="hist-branch-label">
              {t('branch')}
            </span>
            <div className="chips" role="group" aria-labelledby="hist-branch-label">
              {[{ id: undefined, name: t('branchAll') }, ...shell.branches].map((b) => {
                const on = shell.branchId === b.id;
                return (
                  <button
                    key={b.id ?? 'all'}
                    type="button"
                    className={cn('chip', on && 'on')}
                    aria-pressed={on}
                    disabled={shell.branchLocked && !on}
                    onClick={() => shell.setBranchId(b.id)}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field">
            <span className="flabel">{t('status')}</span>
            {seg(t('status'), filters.status, 'status', [
              { value: 'todos', label: t('statusAll') },
              { value: 'entregado', label: t('statusDelivered') },
              { value: 'cancelado', label: t('statusCancelled') },
              ...(hasToday ? [{ value: 'curso' as const, label: t('statusActive') }] : []),
            ])}
          </div>
          <div className="field">
            <span className="flabel">{t('type')}</span>
            {seg(t('type'), filters.type, 'type', [
              { value: 'todos', label: t('typeAll') },
              { value: 'delivery', label: t('typeDelivery') },
              { value: 'pickup', label: t('typePickup') },
            ])}
          </div>
          <div className="field">
            <span className="flabel">{t('slot')}</span>
            {seg(t('slot'), filters.slot, 'slot', [
              { value: 'todas', label: t('slotAll') },
              { value: 'almuerzo', label: t('slotLunch') },
              { value: 'tarde', label: t('slotAfternoon') },
              { value: 'noche', label: t('slotNight') },
            ])}
          </div>
          <div className="field">
            <span className="flabel">{t('product')}</span>
            <PopoverRoot
              className="brsel"
              open={productPopover.open}
              onDismiss={productPopover.close}
            >
              <button
                type="button"
                className="brsel-btn"
                style={{ width: '100%', maxWidth: 'none' }}
                aria-haspopup="true"
                aria-expanded={productPopover.open}
                aria-label={`${t('productLabel')}: ${productLabel}`}
                onClick={productPopover.toggle}
              >
                <IconFork size="sm" />
                <span className="trunc grow" style={{ textAlign: 'left' }}>
                  {productLabel}
                </span>
                <IconChevronDown size="sm" />
              </button>
              {productPopover.open ? (
                <div
                  className="menu-pop"
                  style={{ maxHeight: 300, overflowY: 'auto', width: '100%' }}
                >
                  {[{ id: 'all', name: t('productAll') }, ...products].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={cn('menu-item', filters.product === p.id && 'on')}
                      onClick={() => {
                        setFilter('product', p.id);
                        productPopover.close();
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </PopoverRoot>
          </div>
          <div className="field">
            <span className="flabel">{t('amount')}</span>
            <div className="row gap8">
              <span className="inp-prefix grow">
                <span>Q</span>
                <input
                  className="inp"
                  type="number"
                  min={0}
                  placeholder={t('amountMinPlaceholder')}
                  aria-label={t('amountMin')}
                  value={filters.min}
                  onChange={(e) => setFilter('min', e.target.value)}
                />
              </span>
              <span className="strong" aria-hidden="true">
                –
              </span>
              <span className="inp-prefix grow">
                <span>Q</span>
                <input
                  className="inp"
                  type="number"
                  min={0}
                  placeholder={t('amountMaxPlaceholder')}
                  aria-label={t('amountMax')}
                  value={filters.max}
                  onChange={(e) => setFilter('max', e.target.value)}
                />
              </span>
            </div>
          </div>
          <div className="field">
            <span className="flabel">{t('sort')}</span>
            {seg(t('sort'), filters.sort, 'sort', [
              { value: 'recientes', label: t('sortRecent') },
              { value: 'antiguos', label: t('sortOld') },
              { value: 'mayor', label: t('sortHigh') },
              { value: 'menor', label: t('sortLow') },
            ])}
          </div>
        </div>
      </section>

      {history.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {t('error')}{' '}
          <button type="button" className="link-btn" onClick={() => void history.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : null}

      {history.isPending ? (
        <div aria-busy="true" aria-label={t('loading')} style={{ display: 'grid', gap: 16 }}>
          <Skeleton zone="bo" style={{ height: 110, borderRadius: 16 }} />
          <Skeleton zone="bo" style={{ height: 320, borderRadius: 16 }} />
        </div>
      ) : history.isError ? null : (
        <>
          <div className="kpis">
            <Kpi
              label={t('kpiOrders')}
              value={totals.count.toLocaleString('en-US')}
              foot={filtersOn ? t('kpiOrdersFiltered') : t('kpiOrdersPeriod')}
              tone="neutral"
            />
            <Kpi
              label={t('kpiSales')}
              value={formatMoney(totals.sales)}
              foot={t('kpiSalesFoot')}
              tone="coral"
            />
            <Kpi
              label={t('kpiTicket')}
              value={formatMoney(totals.ticket)}
              foot={t('kpiTicketFoot')}
              tone="amber"
            />
            <Kpi
              label={t('kpiCancelled')}
              value={String(totals.cancelled)}
              foot={t('kpiCancelledFoot', { pct: totals.cancelledPct })}
              tone="red"
            />
            <Kpi
              label={t('kpiDelivery')}
              value={String(totals.delivery)}
              foot={t('kpiDeliveryFoot', { pct: totals.deliveryPct })}
              tone="blue"
            />
          </div>

          <section className="card">
            <div className="card-h">
              <div className="grow">
                <h2>{t('tableTitle')}</h2>
                <div className="muted sm" style={{ fontWeight: 600 }}>
                  {t('tableSub', { shown: shown.length, total: sorted.length })}
                </div>
              </div>
              <button
                type="button"
                className="btn sm"
                onClick={() => toast.notify(t('exportToast', { count: sorted.length }))}
              >
                <IconDownload size="sm" />
                {t('export')}
              </button>
            </div>
            <div className="tscroll">
              <div className="min-hist" role="table" aria-label={t('tableLabel')}>
                <div className="thead cols-hist" role="row">
                  <span role="columnheader">{t('colOrder')}</span>
                  <span role="columnheader">{t('colTime')}</span>
                  <span role="columnheader">{t('colClient')}</span>
                  <span role="columnheader">{t('colBranch')}</span>
                  <span role="columnheader">{t('colType')}</span>
                  <span role="columnheader">{t('colProducts')}</span>
                  <span role="columnheader">{t('colTotal')}</span>
                  <span role="columnheader">{t('colStatus')}</span>
                  <span role="columnheader">
                    <span className="sr-only">{t('detailLabel', { code: '' })}</span>
                  </span>
                </div>
                {groups.map((g) => (
                  <GroupRows
                    key={g.day || 'all'}
                    group={g}
                    today={today}
                    sort={filters.sort}
                    multiDay={!single}
                    onFocusDay={(iso) => {
                      setModeState('dia');
                      changeRange(dayRange(iso));
                    }}
                    onOpen={setSelected}
                  />
                ))}
                {sorted.length === 0 ? (
                  <EmptyState zone="bo" title={t('emptyTitle')} description={t('emptyText')} />
                ) : null}
              </div>
            </div>
            {sorted.length > shown.length ? (
              <div className="card-foot">
                <span className="sm" style={{ fontWeight: 700 }}>
                  {t('footShown', { shown: shown.length, total: sorted.length })}
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setLimit((l) => l + HISTORY_PAGE)}
                >
                  {t('more', { count: Math.min(HISTORY_PAGE, sorted.length - shown.length) })}
                </button>
              </div>
            ) : null}
          </section>
        </>
      )}

      {selected ? <HistoryOrderDrawer order={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

interface GroupRowsProps {
  group: DayGroup;
  today: string;
  sort: HistoryFilters['sort'];
  multiDay: boolean;
  onFocusDay: (iso: string) => void;
  onOpen: (order: DraftOrder) => void;
}

function GroupRows({ group, today, sort, multiDay, onFocusDay, onOpen }: GroupRowsProps) {
  const t = useTranslations('backoffice.reports.history');
  const text = useOrderText();
  const { branchById } = useShell();

  const label = group.day
    ? group.day === today
      ? t('dayTodayLong', { day: dayLong(group.day) })
      : dayLong(group.day)
    : sort === 'mayor'
      ? t('sortedHigh')
      : t('sortedLow');
  const sub = group.day
    ? group.cancelled
      ? t('daySubCancelled', {
          count: group.count,
          sales: formatMoney(group.sales),
          cancelled: group.cancelled,
        })
      : t('daySub', { count: group.count, sales: formatMoney(group.sales) })
    : t('sortedSub', { count: group.count });

  return (
    <>
      <div className="day-h" role="row">
        <span className="strong" role="cell">
          {label}
        </span>
        <span className="sm" style={{ fontWeight: 700 }} role="cell">
          {sub}
        </span>
        <span className="spacer" />
        {group.day && multiDay ? (
          <span role="cell">
            <button type="button" className="link-btn" onClick={() => onFocusDay(group.day)}>
              {t('dayFocus')}
            </button>
          </span>
        ) : null}
      </div>
      {group.rows.map((o) => {
        const branch = branchById(o.branchId);
        const code = `#${o.id}`;
        return (
          <div key={o.id} className="trow cols-hist" role="row">
            <div role="cell">
              <button type="button" className="tid" onClick={() => onOpen(o)}>
                {code}
              </button>
            </div>
            <div className="num sm" style={{ fontWeight: 700 }} role="cell">
              {orderClock(o)}
            </div>
            <div role="cell">
              <div className="cell-main trunc">{o.customer.name}</div>
              <div className="cell-sub num">{o.customer.phone}</div>
            </div>
            <div className="hide-sm" role="cell">
              <span className="btag">{branchShortName(branch, o.branchId)}</span>
            </div>
            <div className="hide-sm" role="cell">
              <span className="zone-tag">{text.typeShort(o)}</span>
            </div>
            <div
              className="sm hide-sm trunc"
              title={productsText(o)}
              style={{ fontWeight: 600 }}
              role="cell"
            >
              {productsText(o)}
            </div>
            <div className="num strong" role="cell">
              {formatMoney(o.total)}
            </div>
            <div role="cell">
              <StatusPill zone="bo" tone={COLUMN_TONE[toBackofficeColumn(o)]}>
                {text.statusLabel(o)}
              </StatusPill>
              <div className="cell-sub trunc">
                {o.status === 'rejected' || o.status === 'cancelled'
                  ? (o.rejectionReason ?? '')
                  : o.fulfillment === 'delivery'
                    ? t('shipping', { amount: formatMoney(o.deliveryFee) })
                    : t('pickupNote')}
              </div>
            </div>
            <div className="row-actions" role="cell">
              <button
                type="button"
                className="icon-btn"
                aria-label={t('detailLabel', { code })}
                onClick={() => onOpen(o)}
              >
                <IconEye size="sm" />
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
