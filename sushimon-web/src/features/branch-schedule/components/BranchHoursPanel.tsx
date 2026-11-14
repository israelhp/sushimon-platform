'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatInterval, mergeIntervals } from '@/lib/branch-hours';
import { formatDateTime } from '@/lib/format';
import { localIsoWeekday } from '@/lib/time';
import { usePublicBranchHours, useBranchAvailability } from '../hooks';
import { useAvailabilityText } from '../use-availability-text';
import { AvailabilityBadge } from './AvailabilityBadge';

/**
 * Detalle público de una sucursal: estado actual (del servidor), próxima apertura/cierre, horario semanal REAL (días sin
 * atención identificables) y cierres próximos SIN motivo. No recalcula nada: muestra `getBranchHours` y
 * `getBranchAvailability`.
 */
export function BranchHoursPanel({ branchId, name }: { branchId: string; name: string }) {
  const t = useTranslations('branchSchedule');
  const tu = useTranslations('ui');
  const locale = useLocale();
  const text = useAvailabilityText();
  const hours = usePublicBranchHours(branchId);
  const availability = useBranchAvailability(branchId);
  const headingId = useId();

  if (hours.isError) {
    return (
      <p className="notice notice-warn" role="alert">
        {t('panel.loadError')}{' '}
        <button type="button" className="link-btn" onClick={() => void hours.refetch()}>
          {tu('retry')}
        </button>
      </p>
    );
  }
  if (!hours.data) {
    return <Skeleton aria-hidden="true" className="h-40 w-full" />;
  }

  const today = availability.data ? localIsoWeekday(new Date(availability.data.serverTime)) : null;
  const closures = hours.data.upcomingClosures;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-line bg-surface p-4 shadow-card"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="m-0 text-[15px] font-extrabold">
          {t('panel.sectionLabel', { name })}
        </h3>
        {availability.data ? <AvailabilityBadge availability={availability.data} /> : null}
      </div>
      {availability.data ? (
        <p className="m-0 mb-3 text-[13px] text-muted">{text.detail(availability.data)}</p>
      ) : null}
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
        {hours.data.days.map((day) => {
          const intervals = mergeIntervals(day.intervals);
          const isToday = today === day.weekday;
          return (
            <div key={day.weekday} className="contents">
              <dt className={isToday ? 'font-extrabold' : 'font-bold text-muted'}>
                {t(`weekdays.${day.weekday}`)}
                {isToday ? <span className="sr-only"> ({t('panel.today')})</span> : null}
              </dt>
              <dd className={isToday ? 'm-0 font-extrabold' : 'm-0'}>
                {intervals.length === 0 ? (
                  <span className="text-muted">{t('panel.noService')}</span>
                ) : (
                  intervals.map((i) => (
                    <span key={`${i.opensAt}-${i.closesAt}`} className="mr-3 inline-block">
                      {formatInterval(i, locale)}
                    </span>
                  ))
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="m-0 mt-2 text-[12px] text-muted">{t('panel.timezone')}</p>
      {closures.length > 0 ? (
        <div className="mt-3 border-t border-dashed border-line pt-3">
          <h4 className="m-0 mb-1 text-[13px] font-extrabold">{t('panel.closuresTitle')}</h4>
          <ul className="m-0 list-none p-0 text-[13px]">
            {closures.map((c) => (
              <li key={c.startsAt}>
                {t('panel.closureRange', {
                  from: formatDateTime(c.startsAt, locale),
                  to: formatDateTime(c.endsAt, locale),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Botón «Ver horario» que despliega el detalle (no se monta —ni se consulta— hasta abrirlo). */
export function BranchHoursDisclosure({ branchId, name }: { branchId: string; name: string }) {
  const t = useTranslations('branchSchedule');
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <div className="mt-2">
      <button
        type="button"
        className="link-btn !min-h-0 text-sm"
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={`${open ? t('panel.hide') : t('panel.view')}: ${name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t('panel.hide') : t('panel.view')}
      </button>
      <div id={regionId} className="mt-2" hidden={!open}>
        {open ? <BranchHoursPanel branchId={branchId} name={name} /> : null}
      </div>
    </div>
  );
}
