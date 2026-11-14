'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { IconClock, IconPlus } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { useAdminBranchHours, useReplaceBranchHours } from '@/features/branch-schedule/hooks';
import { isForbidden } from '@/features/bo-orders/error-message';
import { MAX_INTERVALS_PER_DAY, isWeekEmpty } from '@/lib/branch-hours';
import type { AdminBranch, BranchHours, BranchHoursDay } from '@/lib/data-access/models';
import type { IsoWeekday } from '@/lib/time';
import {
  DEFAULT_INTERVAL,
  WEEKDAY_NAMES,
  applyNightShift,
  canAddInterval,
  changedDays,
  errorKey,
  firstErrorPath,
  isDraftDirty,
  scheduleServerError,
  validateDraft,
  weekToDraft,
  type ScheduleServerError,
} from '../branch-schedule-view';
import { ConfirmModal } from './ConfirmModal';

/**
 * Editor semanal de horario (F08). 7 días ISO, varios intervalos por día (máx. 6, `[apertura, cierre)`), detección de
 * conflictos antes de guardar con los mismos criterios del servidor, atajo «pasa de medianoche» que divide el turno en
 * dos días (D4), confirmación y guardado con `expectedVersion` (409 `HOURS_VERSION_CONFLICT` => recarga). La UI solo
 * oculta/deshabilita por permiso; la API decide.
 */
export function WeeklyHoursEditor({
  branch,
  canManage,
}: {
  branch: AdminBranch;
  canManage: boolean;
}) {
  const t = useTranslations('backoffice.branchSchedule.hours');
  const hours = useAdminBranchHours(branch.id);
  // Cambia al recargar tras un conflicto: reinicia el borrador aunque la versión coincida.
  const [resetCount, setResetCount] = useState(0);

  if (isForbidden(hours.error)) {
    return (
      <Banner zone="bo" tone="warning" role="alert">
        {t('forbidden')}
      </Banner>
    );
  }
  if (hours.isError) {
    return (
      <Banner zone="bo" tone="danger" role="alert">
        {t('loadError')}{' '}
        <button type="button" className="link-btn" onClick={() => void hours.refetch()}>
          {t('retry')}
        </button>
      </Banner>
    );
  }
  if (!hours.data) {
    return (
      <div aria-busy="true" aria-label={t('loading')} className="hrs">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} zone="bo" style={{ height: 56, borderRadius: 12 }} />
        ))}
      </div>
    );
  }
  return (
    <HoursForm
      key={`${hours.data.version}:${resetCount}`}
      branch={branch}
      data={hours.data}
      canManage={canManage}
      onReload={async () => {
        await hours.refetch();
        setResetCount((n) => n + 1);
      }}
    />
  );
}

function HoursForm({
  branch,
  data,
  canManage,
  onReload,
}: {
  branch: AdminBranch;
  data: BranchHours;
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations('backoffice.branchSchedule.hours');
  const toast = useToast();
  const save = useReplaceBranchHours();
  const [draft, setDraft] = useState<BranchHoursDay[]>(() => weekToDraft(data.days));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<ScheduleServerError | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [night, setNight] = useState<{ weekday: IsoWeekday; opensAt: string; closesAt: string }>({
    weekday: 5,
    opensAt: '18:00',
    closesAt: '02:00',
  });
  const [nightError, setNightError] = useState('');
  const [nightNote, setNightNote] = useState('');
  const [reloading, setReloading] = useState(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const nightId = useId();

  const dirty = isDraftDirty(data.days, draft);
  const disabled = !canManage || save.isPending;

  const touch = () => {
    setErrors({});
    setServerError(null);
  };
  const updateDay = (index: number, fn: (day: BranchHoursDay) => BranchHoursDay) => {
    setDraft((d) => d.map((day, i) => (i === index ? fn(day) : day)));
    touch();
  };
  const patchInterval = (
    i: number,
    j: number,
    patch: Partial<{ opensAt: string; closesAt: string }>,
  ) =>
    updateDay(i, (day) => ({
      ...day,
      intervals: day.intervals.map((it, k) => (k === j ? { ...it, ...patch } : it)),
    }));

  const focusFirst = (found: Record<string, string>) => {
    const path = firstErrorPath(found);
    if (!path) return;
    const target = refs.current[path] ?? refs.current[path.replace(/\.intervals\[\d+\]$/, '')];
    target?.focus();
  };

  const requestSave = () => {
    setServerError(null);
    const found = validateDraft(draft);
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirst(found);
      return;
    }
    setConfirming(true);
  };

  const confirmSave = () => {
    save.mutate(
      { id: branch.id, input: { expectedVersion: data.version, days: draft } },
      {
        onSuccess: () => {
          toast.notify(t('toastSaved', { name: branch.name }));
          setConfirming(false);
        },
        onError: (error) => {
          const parsed = scheduleServerError(error);
          setServerError(parsed);
          setConfirming(false);
          if (parsed.kind === 'invalid') {
            setErrors(parsed.byPath);
            focusFirst(parsed.byPath);
          }
        },
      },
    );
  };

  const addNightShift = () => {
    const result = applyNightShift(draft, night.weekday, night.opensAt, night.closesAt);
    if (!result.days) {
      setNightError(result.error ?? t('nightInvalid'));
      setNightNote('');
      return;
    }
    setDraft(result.days);
    setNightError('');
    setNightNote(t('nightDone', { summary: result.summary ?? '' }));
    touch();
  };

  const changed = changedDays(data.days, draft);
  const emptyAfter = isWeekEmpty(draft);

  return (
    <div className="hrs">
      {!canManage ? (
        <Banner zone="bo" tone="info">
          {t('readOnly', { permission: 'branches.manage_hours' })}
        </Banner>
      ) : null}
      {isWeekEmpty(data.days) ? (
        <Banner zone="bo" tone="warning">
          {t('notConfigured')}
        </Banner>
      ) : null}
      {serverError ? (
        <Banner zone="bo" tone="alert" role="alert">
          {serverError.message}{' '}
          {serverError.kind === 'conflict' ? (
            <button
              type="button"
              className="link-btn"
              disabled={reloading}
              onClick={() => {
                setReloading(true);
                void onReload().finally(() => setReloading(false));
              }}
            >
              {t('reload')}
            </button>
          ) : null}
          {serverError.kind === 'busy' ? (
            <button
              type="button"
              className="link-btn"
              disabled={save.isPending}
              onClick={confirmSave}
            >
              {t('retry')}
            </button>
          ) : null}
        </Banner>
      ) : null}
      <p className="xs muted" style={{ fontWeight: 600, margin: 0 }}>
        {t('help', { tz: data.timezone, max: MAX_INTERVALS_PER_DAY })}
      </p>

      {draft.map((day, i) => {
        const name = WEEKDAY_NAMES[day.weekday];
        const active = day.intervals.length > 0;
        const dayError = errors[errorKey(i)];
        return (
          <div key={day.weekday} className={`hrs-day${active ? '' : ' off'}`}>
            <div className="hrs-head">
              <Switch
                zone="bo"
                checked={active}
                disabled={disabled}
                label={t('switchLabel', { day: name })}
                onCheckedChange={(on) =>
                  updateDay(i, (d) => ({
                    ...d,
                    intervals: on ? [{ ...DEFAULT_INTERVAL }] : [],
                  }))
                }
              />
              <span>{name}</span>
            </div>
            <div className="hrs-ints">
              {!active ? (
                <span className="sm muted" style={{ fontWeight: 700 }}>
                  {t('noService')}
                </span>
              ) : (
                day.intervals.map((interval, j) => {
                  const key = errorKey(i, j);
                  const error = errors[key];
                  const errId = `${nightId}-${i}-${j}-err`;
                  const args = { n: j + 1, day: name };
                  return (
                    <div key={j} className="hrs-int">
                      <input
                        ref={(el) => {
                          refs.current[key] = el;
                        }}
                        className="inp hrs-time"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={t('placeholder')}
                        maxLength={5}
                        aria-label={t('opensLabel', args)}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errId : undefined}
                        disabled={disabled}
                        value={interval.opensAt}
                        onChange={(e) => patchInterval(i, j, { opensAt: e.target.value })}
                      />
                      <span aria-hidden="true">–</span>
                      <input
                        className="inp hrs-time"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={t('placeholder')}
                        maxLength={5}
                        aria-label={t('closesLabel', args)}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errId : undefined}
                        disabled={disabled}
                        value={interval.closesAt}
                        onChange={(e) => patchInterval(i, j, { closesAt: e.target.value })}
                      />
                      {canManage ? (
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={t('removeLabel', args)}
                          disabled={disabled}
                          onClick={() =>
                            updateDay(i, (d) => ({
                              ...d,
                              intervals: d.intervals.filter((_, k) => k !== j),
                            }))
                          }
                        >
                          {t('remove')}
                        </button>
                      ) : null}
                      {error ? (
                        <span id={errId} className="hrs-err" role="alert">
                          {error}
                        </span>
                      ) : null}
                    </div>
                  );
                })
              )}
              {dayError ? (
                <span className="hrs-err" role="alert">
                  {dayError}
                </span>
              ) : null}
              {active && canManage ? (
                <div>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={t('addLabel', { day: name })}
                    disabled={disabled || !canAddInterval(day)}
                    onClick={() =>
                      updateDay(i, (d) => ({
                        ...d,
                        intervals: [...d.intervals, { opensAt: '', closesAt: '' }],
                      }))
                    }
                  >
                    <IconPlus size="sm" />
                    {t('add')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}

      {canManage ? (
        <fieldset className="hrs-night" disabled={disabled}>
          <legend className="sm strong">{t('nightTitle')}</legend>
          <p className="xs muted" style={{ fontWeight: 600, margin: '0 0 8px' }}>
            {t('nightHelp')}
          </p>
          <div className="row gap8" style={{ flexWrap: 'wrap' }}>
            <label className="row gap8">
              <span className="sm">{t('nightDay')}</span>
              <select
                className="inp"
                style={{ width: 'auto' }}
                value={night.weekday}
                onChange={(e) =>
                  setNight((n) => ({ ...n, weekday: Number(e.target.value) as IsoWeekday }))
                }
              >
                {([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]).map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_NAMES[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="row gap8">
              <span className="sm">{t('nightOpens')}</span>
              <input
                className="inp hrs-time"
                type="text"
                inputMode="numeric"
                placeholder={t('placeholder')}
                maxLength={5}
                value={night.opensAt}
                onChange={(e) => setNight((n) => ({ ...n, opensAt: e.target.value }))}
              />
            </label>
            <label className="row gap8">
              <span className="sm">{t('nightCloses')}</span>
              <input
                className="inp hrs-time"
                type="text"
                inputMode="numeric"
                placeholder={t('placeholder')}
                maxLength={5}
                value={night.closesAt}
                onChange={(e) => setNight((n) => ({ ...n, closesAt: e.target.value }))}
              />
            </label>
            <button type="button" className="btn sm" onClick={addNightShift}>
              <IconClock size="sm" />
              {t('nightApply')}
            </button>
          </div>
          {nightError ? (
            <p className="xs" role="alert" style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}>
              {nightError}
            </p>
          ) : null}
          {nightNote ? (
            <p className="xs" role="status" style={{ fontWeight: 700 }}>
              {nightNote}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {canManage ? (
        <div className="row gap8" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft(weekToDraft(data.days));
              touch();
              setNightError('');
              setNightNote('');
            }}
          >
            {t('discard')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || save.isPending}
            onClick={requestSave}
          >
            {t('save')}
          </button>
        </div>
      ) : null}

      {confirming ? (
        <ConfirmModal
          title={t('confirmTitle')}
          description={branch.name}
          icon={<IconClock />}
          confirmLabel={t('confirmAction')}
          cancelLabel={t('confirmBack')}
          pendingLabel={t('saving')}
          pending={save.isPending}
          onConfirm={confirmSave}
          onClose={() => setConfirming(false)}
        >
          <p style={{ margin: 0 }}>
            {t('confirmText', { name: branch.name })}
            {changed.length ? ` ${t('confirmChanged', { days: changed.join(', ') })}` : ''}
          </p>
          {emptyAfter ? (
            <p style={{ margin: '8px 0 0', color: 'var(--bo-red-text)', fontWeight: 700 }}>
              {t('confirmEmpty')}
            </p>
          ) : null}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
