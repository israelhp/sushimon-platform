'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useReportSummary } from '@/features/backoffice/hooks';
import { ForbiddenScreen } from '@/features/backoffice-shell/ForbiddenScreen';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useNow } from '@/features/backoffice-shell/use-now';
import { isForbidden } from '@/features/bo-orders/error-message';
import { cn } from '@/lib/cn';
import { localDate } from '@/lib/time';
import { dayLong, dayWithMonth, daysInRange } from '../format';
import { presetRange, type DateRange, type RangeKey } from '../reports-view';
import { ReportHistoryTab } from './ReportHistoryTab';
import { ReportSummaryTab } from './ReportSummaryTab';

type TabKey = 'resumen' | 'historial';
const TABS: readonly TabKey[] = ['resumen', 'historial'];

/** Reportes (admin y encargado): resumen con gráficos e historial de pedidos. El alcance de sucursal lo aplica el servidor. */
export function ReportsScreen() {
  const t = useTranslations('backoffice.reports');
  const shell = useShell();
  const now = useNow();
  const today = now ? localDate(now) : null;
  const [tab, setTab] = useState<TabKey>('resumen');
  const [picked, setPicked] = useState<DateRange | null>(null);
  const range = picked ?? (today ? presetRange('7d', today) : null);
  const summary = useReportSummary(
    range ? { from: range.from, to: range.to, branchId: shell.branchId } : {},
  );
  const ids = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (isForbidden(summary.error)) return <ForbiddenScreen reason="server" />;

  const branch = shell.branchId ? shell.branchById(shell.branchId) : undefined;
  const scopeLabel = !shell.branchId
    ? 'Todas las sucursales'
    : branch
      ? `${branch.name} · ${branch.zoneLabel}`
      : '';

  // El servidor recorta el rango a los días con datos: lo que se muestra es lo que se consultó de verdad.
  const data = summary.data;
  const from = data?.from ?? range?.from ?? '';
  const to = data?.to ?? range?.to ?? '';
  const rangeLabel = !from
    ? ''
    : from === to
      ? t('rangeLabelHour', { today: from === today ? t('todayPrefix') : '', day: dayLong(from) })
      : t('rangeLabelDays', {
          from: dayWithMonth(from),
          to: dayWithMonth(to),
          days: daysInRange(from, to),
        });

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      e.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const key = TABS[next];
    if (key) setTab(key);
    tabRefs.current[next]?.focus();
  };

  const setRange = (next: DateRange) => setPicked(next);
  const presets: { value: Exclude<RangeKey, 'custom'>; label: string }[] = [
    { value: 'hoy', label: t('rangeToday') },
    { value: 'ayer', label: t('rangeYesterday') },
    { value: '7d', label: t('range7') },
    { value: '30d', label: t('range30') },
    { value: 'mes', label: t('rangeMonth') },
  ];

  return (
    <div className="page" style={{ animation: 'none' }}>
      <div className="page-h">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">{scopeLabel}</div>
        </div>
      </div>

      <div className="ltabs" role="tablist" aria-label={t('tabsLabel')}>
        {TABS.map((key, i) => (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`${ids}-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`${ids}-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            className={cn('ltab', tab === key && 'on')}
            onClick={() => setTab(key)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t(key === 'resumen' ? 'tabSummary' : 'tabHistory')}
          </button>
        ))}
      </div>

      {tab === 'resumen' ? (
        <div
          id={`${ids}-panel-resumen`}
          role="tabpanel"
          aria-labelledby={`${ids}-tab-resumen`}
          style={{ display: 'contents' }}
        >
          <div className="toolbar">
            <SegmentedControl
              zone="bo"
              label={t('rangeGroup')}
              value={range?.key ?? '7d'}
              options={presets}
              onChange={(k) => today && k !== 'custom' && setRange(presetRange(k, today))}
            />
            <div className="row gap8 wrap">
              <label className="row gap6 sm" style={{ fontWeight: 800 }}>
                {t('from')}
                <input
                  className="inp"
                  type="date"
                  style={{ height: 40, width: 160 }}
                  min={data?.minDate}
                  max={today ?? undefined}
                  value={range?.from ?? ''}
                  onChange={(e) =>
                    e.target.value &&
                    range &&
                    setRange({ key: 'custom', from: e.target.value, to: range.to })
                  }
                />
              </label>
              <label className="row gap6 sm" style={{ fontWeight: 800 }}>
                {t('to')}
                <input
                  className="inp"
                  type="date"
                  style={{ height: 40, width: 160 }}
                  min={data?.minDate}
                  max={today ?? undefined}
                  value={range?.to ?? ''}
                  onChange={(e) =>
                    e.target.value &&
                    range &&
                    setRange({ key: 'custom', from: range.from, to: e.target.value })
                  }
                />
              </label>
            </div>
            <span className="sm" style={{ fontWeight: 700 }}>
              {rangeLabel}
            </span>
          </div>
          <ReportSummaryTab
            summary={data}
            pending={!range || summary.isPending}
            error={summary.isError}
            onRetry={() => void summary.refetch()}
            today={today ?? ''}
            rangeLabel={rangeLabel}
          />
        </div>
      ) : range && today ? (
        <div
          id={`${ids}-panel-historial`}
          role="tabpanel"
          aria-labelledby={`${ids}-tab-historial`}
          style={{ display: 'contents' }}
        >
          <ReportHistoryTab
            range={range}
            onRange={setRange}
            today={today}
            minDate={data?.minDate}
            clipped={data?.clipped ?? false}
            branchId={shell.branchId}
          />
        </div>
      ) : null}
    </div>
  );
}
