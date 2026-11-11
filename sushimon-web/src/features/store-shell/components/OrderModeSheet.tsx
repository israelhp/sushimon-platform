'use client';

import { CalendarClock, Clock, Store, TriangleAlert, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Price } from '@/components/ui/Price';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import type { Branch, FulfillmentType, OrderSchedule, StoreConfig } from '@/lib/data-access/models';
import { formatClock } from '@/lib/format';
import { isScheduleValid, slotsFor } from '@/lib/schedule';
import {
  DEFAULT_DELIVERY_DRAFT,
  checkZone,
  hasErrors,
  municipalitiesOf,
  requiresZone,
  validateDraft,
  type DeliveryDraft,
  type DraftErrors,
} from '@/features/order-mode/draft';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { dateOptions, firstSlot, type WhenLabels } from '@/features/order-mode/when';
import { useBranches, useDeliveryQuote, useStoreConfig } from '@/features/store/hooks';
import { STORE_ROUTES } from '../nav';
import { useOrderSheet, type OrderSheetVariant } from '../store-shell-context';
import { ErrorNotice } from './ErrorNotice';

/**
 * Hoja de modo de pedido. "Pedir ahora" (solo recoger/domicilio) o "Programar" (día y hora según el
 * horario de la sucursal). A domicilio pide departamento, municipio, zona y dirección, asigna la
 * sucursal por cobertura y muestra la estimación de envío (simulada). Al confirmar guarda el modo
 * (preferencia del dispositivo) y lleva al menú; el servidor vuelve a validar todo al crear el pedido.
 */
export function OrderModeSheet() {
  const { variant, close } = useOrderSheet();
  if (!variant) return null;
  return <OrderModeSheetDialog key={variant} initialView={variant} onClose={close} />;
}

const choiceClass = (active: boolean) =>
  cn(
    'flex min-h-[64px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition',
    active
      ? 'border-transparent bg-deep text-ondeep shadow-card ring-2 ring-primary'
      : 'border-line bg-surface hover:bg-subtle',
  );

function ChoiceButton({
  active,
  onClick,
  disabled,
  Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  Icon: typeof Store;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(choiceClass(active), disabled && 'opacity-50')}
    >
      <Icon className="h-6 w-6 flex-none" aria-hidden="true" />
      <span className="font-extrabold leading-tight">{children}</span>
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="err">
      {message}
    </p>
  ) : null;
}

function initialDelivery(
  address: ReturnType<typeof useOrderMode>['mode']['address'],
): DeliveryDraft {
  return address
    ? {
        department: address.department,
        municipality: address.municipality,
        zone: address.zone,
        line: address.line,
      }
    : DEFAULT_DELIVERY_DRAFT;
}

function OrderModeSheetDialog({
  initialView,
  onClose,
}: {
  initialView: OrderSheetVariant;
  onClose: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const uid = useId();
  const { mode, setMode } = useOrderMode();
  const configQuery = useStoreConfig();
  const branchesQuery = useBranches();
  const config = configQuery.data;
  const branches = useMemo(
    () => (branchesQuery.data ?? []).filter((b) => b.status === 'active'),
    [branchesQuery.data],
  );

  const [view, setView] = useState<OrderSheetVariant>(initialView);
  const [type, setType] = useState<FulfillmentType | null>(mode.type);
  const [wantedWhen, setWantedWhen] = useState<OrderSchedule>(mode.when);
  const [pickupBranchId, setPickupBranchId] = useState<string | null>(mode.branchId);
  const [delivery, setDelivery] = useState<DeliveryDraft>(() => initialDelivery(mode.address));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [whenError, setWhenError] = useState('');

  const labels: WhenLabels = {
    asap: t('when.asap'),
    today: t('when.today'),
    tomorrow: t('when.tomorrow'),
  };
  const now = config ? new Date(config.serverTime) : null;

  // ── Cotización y sucursal por cobertura (a domicilio) ─────────────────────────────────────
  const needsZone = requiresZone(delivery.department, delivery.municipality);
  const zoneOk = !needsZone || checkZone(delivery.zone, config?.nonexistentZones ?? []) === 'ok';
  const quoteArgs =
    type === 'delivery' && delivery.department && delivery.municipality && zoneOk
      ? {
          department: delivery.department,
          municipality: delivery.municipality,
          zone: needsZone ? String(Number(delivery.zone)) : undefined,
        }
      : null;
  const quote = useDeliveryQuote(quoteArgs);
  const quoteData = quoteArgs ? quote.data : undefined;
  const assignedBranch: Branch | undefined =
    type === 'delivery' && quoteData?.covered
      ? branches.find((b) => b.id === quoteData.branchId)
      : undefined;

  // Sucursal de recogida: la elegida (si sigue activa) o la primera abierta.
  const pickupBranch =
    branches.find((b) => b.id === pickupBranchId) ??
    branches.find((b) => b.openNow) ??
    branches[0] ??
    null;
  const activeBranch =
    type === 'delivery' ? assignedBranch : type === 'pickup' ? pickupBranch : null;

  // ── Programación (horario de la sucursal activa o, mientras tanto, el de la marca) ────────
  const hours = activeBranch?.hours ?? config?.weeklyHours ?? [];
  const days = useMemo(
    () => (config && now ? dateOptions(config.schedule, hours, now, locale, labels) : []),
    // `labels` y `now` derivan de `config`/`locale`; `hours` cambia con la sucursal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, hours, locale],
  );
  const when: OrderSchedule = useMemo(() => {
    if (view !== 'schedule' || !config || !now) return { kind: 'now' };
    if (
      wantedWhen.kind === 'scheduled' &&
      isScheduleValid(config.schedule, hours, wantedWhen, now)
    ) {
      return wantedWhen;
    }
    const date = days.find((d) => d.date === (wantedWhen.date ?? ''))?.date ?? days[0]?.date;
    const time = date ? firstSlot(config.schedule, hours, date, now) : null;
    return date && time ? { kind: 'scheduled', date, time } : { kind: 'now' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, config, hours, wantedWhen, days]);
  const slots =
    config && now && when.kind === 'scheduled' && when.date
      ? slotsFor(config.schedule, hours, when.date, now)
      : [];
  const noSlots = view === 'schedule' && !!config && days.length === 0;

  const closedNow =
    view === 'now' && !!type && !!activeBranch && !activeBranch.openNow ? activeBranch : null;
  const allClosed =
    view === 'now' && !!type && branches.length > 0 && branches.every((b) => !b.openNow);

  const setDeliveryField = (patch: Partial<DeliveryDraft>) => {
    setDelivery((d) => ({ ...d, ...patch }));
    setErrors((e) => ({
      ...e,
      ...(patch.line !== undefined && { line: undefined }),
      ...(patch.zone !== undefined && { zone: undefined }),
      ...(patch.department !== undefined && { department: undefined }),
      ...(patch.municipality !== undefined && { municipality: undefined }),
    }));
  };

  const chooseType = (next: FulfillmentType) => {
    setType(next);
    setErrors({});
  };

  const submit = () => {
    if (!config) return;
    const found = validateDraft(
      { type, branchId: pickupBranch?.id ?? null, delivery },
      config.nonexistentZones,
    );
    setErrors(found);
    setWhenError('');
    if (hasErrors(found)) return;
    if (type === 'delivery' && !quoteData?.covered) {
      // Sin cotización (calculando o con error) o sin cobertura: no se continúa.
      setWhenError(quoteData ? t('delivery.notCovered') : t('validation.quote'));
      return;
    }
    if (view === 'schedule' && when.kind !== 'scheduled') {
      setWhenError(t('mode.noSlots'));
      return;
    }
    setMode({
      type,
      when,
      branchId: activeBranch?.id ?? null,
      address:
        type === 'delivery'
          ? {
              department: delivery.department,
              municipality: delivery.municipality,
              zone: needsZone ? String(Number(delivery.zone)) : '',
              line: delivery.line.trim(),
              references: mode.address?.references ?? '',
            }
          : null,
    });
    onClose();
    router.push(STORE_ROUTES.menu);
  };

  const fieldId = (name: string) => `${uid}-${name}`;
  const typeErrorId = fieldId('type-error');
  const loadFailed = configQuery.isError || branchesQuery.isError;
  const loading = !loadFailed && (configQuery.isPending || branchesQuery.isPending);
  const err = (key: DraftErrors[keyof DraftErrors]) => (key ? t(key) : undefined);

  const municipalities = config ? municipalitiesOf(config.departments, delivery.department) : [];

  return (
    <Modal
      open
      onClose={onClose}
      title={view === 'schedule' ? t('mode.scheduleOrder') : t('mode.orderNow')}
      titleClassName="text-[26px]"
      className="md:w-[520px]!"
      footer={
        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={submit}
          disabled={!config || !branchesQuery.data}
        >
          {t('mode.seeMenu')}
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        {loadFailed ? (
          <ErrorNotice
            onRetry={() => {
              if (configQuery.isError) void configQuery.refetch();
              if (branchesQuery.isError) void branchesQuery.refetch();
            }}
          />
        ) : null}

        <fieldset>
          <legend className="lbl">{t('mode.how')}</legend>
          <div className="grid grid-cols-2 gap-2.5">
            <ChoiceButton
              active={type === 'pickup'}
              onClick={() => chooseType('pickup')}
              Icon={Store}
            >
              {t('mode.pickup')}
            </ChoiceButton>
            <ChoiceButton
              active={type === 'delivery'}
              onClick={() => chooseType('delivery')}
              Icon={Truck}
            >
              {t('mode.delivery')}
            </ChoiceButton>
          </div>
          <FieldError id={typeErrorId} message={err(errors.type)} />
        </fieldset>

        {type === 'pickup' ? (
          <fieldset>
            <legend className="lbl">{t('delivery.branchPickup')}</legend>
            {loading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="grid gap-2" role="radiogroup" aria-label={t('delivery.branchPickup')}>
                {branches.map((b) => {
                  const selected = pickupBranch?.id === b.id;
                  return (
                    <label
                      key={b.id}
                      className={cn(
                        'flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2',
                        selected ? 'border-secondary bg-secondary-soft' : 'border-line bg-surface',
                      )}
                    >
                      <input
                        type="radio"
                        name={fieldId('branch')}
                        className="h-5 w-5 accent-[rgb(var(--secondary))]"
                        checked={selected}
                        onChange={() => {
                          setPickupBranchId(b.id);
                          setErrors((e) => ({ ...e, branch: undefined }));
                        }}
                      />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block font-extrabold">{b.name}</span>
                        <span className="block truncate text-[13px] text-muted">
                          {b.area[locale === 'en' ? 'en' : 'es'] ?? b.area.es}
                        </span>
                      </span>
                      {!b.openNow ? (
                        <span className="flex-none rounded-full bg-subtle px-2 py-0.5 text-[11px] font-extrabold text-muted">
                          {t('mode.closedBadge')}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            )}
            <FieldError id={fieldId('branch-error')} message={err(errors.branch)} />
          </fieldset>
        ) : null}

        {type === 'delivery' ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="lbl">{t('mode.where')}</legend>
            {loading || !config ? (
              <div className="grid gap-3" aria-busy="true">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="lbl" htmlFor={fieldId('dept')}>
                      {t('checkout.department')}
                    </label>
                    <select
                      id={fieldId('dept')}
                      className="input"
                      value={delivery.department}
                      aria-invalid={!!errors.department}
                      onChange={(e) => {
                        const department = e.target.value;
                        const first = municipalitiesOf(config.departments, department)[0];
                        setDeliveryField({
                          department,
                          municipality: first?.name ?? '',
                          zone: '',
                        });
                      }}
                    >
                      {config.departments.map((d) => (
                        <option key={d.department} value={d.department}>
                          {d.department}
                        </option>
                      ))}
                    </select>
                    <FieldError id={fieldId('dept-error')} message={err(errors.department)} />
                  </div>
                  <div>
                    <label className="lbl" htmlFor={fieldId('muni')}>
                      {t('checkout.municipality')}
                    </label>
                    <select
                      id={fieldId('muni')}
                      className="input"
                      value={delivery.municipality}
                      aria-invalid={!!errors.municipality}
                      onChange={(e) => setDeliveryField({ municipality: e.target.value, zone: '' })}
                    >
                      {municipalities.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <FieldError id={fieldId('muni-error')} message={err(errors.municipality)} />
                  </div>
                </div>
                {needsZone ? (
                  <div>
                    <label className="lbl" htmlFor={fieldId('zone')}>
                      {t('checkout.zone')}
                    </label>
                    <input
                      id={fieldId('zone')}
                      className="input"
                      autoComplete="off"
                      inputMode="numeric"
                      aria-invalid={!!errors.zone}
                      aria-describedby={errors.zone ? fieldId('zone-error') : undefined}
                      placeholder={t('mode.zonePh')}
                      value={delivery.zone}
                      onChange={(e) => setDeliveryField({ zone: e.target.value })}
                    />
                    <FieldError id={fieldId('zone-error')} message={err(errors.zone)} />
                  </div>
                ) : null}
                <div>
                  <label className="lbl" htmlFor={fieldId('addr')}>
                    {t('checkout.exactAddress')}
                  </label>
                  <input
                    id={fieldId('addr')}
                    className="input"
                    autoComplete="off"
                    aria-invalid={!!errors.line}
                    aria-describedby={errors.line ? fieldId('addr-error') : undefined}
                    placeholder={t('mode.addressPh')}
                    value={delivery.line}
                    onChange={(e) => setDeliveryField({ line: e.target.value })}
                  />
                  <FieldError id={fieldId('addr-error')} message={err(errors.line)} />
                </div>
                <CoverageSummary
                  state={
                    !quoteArgs
                      ? 'idle'
                      : quote.isError
                        ? 'error'
                        : quote.isPending
                          ? 'loading'
                          : quoteData?.covered
                            ? 'covered'
                            : 'uncovered'
                  }
                  branch={assignedBranch}
                  fee={quoteData?.fee ?? null}
                  eta={
                    quoteData?.etaMinMinutes != null && quoteData.etaMaxMinutes != null
                      ? [quoteData.etaMinMinutes, quoteData.etaMaxMinutes]
                      : null
                  }
                  simulated={quoteData?.simulated ?? true}
                  onRetry={() => void quote.refetch()}
                />
                <p className="text-[12px] text-muted">{t('mode.savedNote')}</p>
              </>
            )}
          </fieldset>
        ) : null}

        {view === 'schedule' ? (
          <ScheduleFields
            config={config}
            loading={loading}
            days={days}
            slots={slots}
            when={when}
            noSlots={noSlots}
            locale={locale}
            onPickDay={(date) => {
              const time = config && now ? firstSlot(config.schedule, hours, date, now) : null;
              if (time) setWantedWhen({ kind: 'scheduled', date, time });
            }}
            onPickTime={(time) => {
              if (when.kind === 'scheduled' && when.date) {
                setWantedWhen({ kind: 'scheduled', date: when.date, time });
              }
            }}
            uid={uid}
          />
        ) : null}

        {closedNow || allClosed ? (
          <div className="notice notice-warn" role="status">
            <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
            <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
              <span>
                {closedNow ? t('mode.closedNow', { a: closedNow.name }) : t('mode.allClosed')}
              </span>
              <button
                type="button"
                className="link-btn !min-h-0 text-sm"
                onClick={() => {
                  setView('schedule');
                  setWantedWhen({ kind: 'now' });
                }}
              >
                {t('mode.schedule')}
              </button>
            </div>
          </div>
        ) : null}

        {whenError ? (
          <p className="err" role="alert">
            {whenError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function CoverageSummary({
  state,
  branch,
  fee,
  eta,
  simulated,
  onRetry,
}: {
  state: 'idle' | 'loading' | 'covered' | 'uncovered' | 'error';
  branch?: Branch;
  fee: number | null;
  eta: [number, number] | null;
  simulated: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  if (state === 'idle') return null;
  if (state === 'error') return <ErrorNotice onRetry={onRetry} message={t('validation.quote')} />;
  return (
    <div aria-live="polite" className="rounded-2xl border border-line bg-surface p-3.5 shadow-card">
      {state === 'loading' ? (
        <p className="m-0 flex items-center gap-2 text-sm font-bold text-muted">
          <Clock className="h-4 w-4" aria-hidden="true" /> {t('delivery.calculating')}
        </p>
      ) : state === 'uncovered' ? (
        <p className="m-0 flex items-start gap-2 text-sm font-bold text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          {t('delivery.notCovered')}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {branch ? (
            <p className="m-0 text-sm">
              <span className="text-muted">{t('delivery.branchOrigin')}: </span>
              <strong>{branch.name}</strong>
              <span className="text-muted">
                {' '}
                · {branch.area[locale === 'en' ? 'en' : 'es'] ?? branch.area.es}
              </span>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold">{t('delivery.estimated')}</span>
            {fee != null ? <Price value={fee} decimals={2} className="!text-[20px]" /> : null}
          </div>
          {eta ? (
            <p className="m-0 text-[13px] text-muted">
              {t('delivery.eta', { a: eta[0], b: eta[1] })}
            </p>
          ) : null}
          {simulated ? (
            <div>
              <SimulationBadge kind="simulation" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ScheduleFields({
  config,
  loading,
  days,
  slots,
  when,
  noSlots,
  locale,
  onPickDay,
  onPickTime,
  uid,
}: {
  config: StoreConfig | undefined;
  loading: boolean;
  days: ReturnType<typeof dateOptions>;
  slots: string[];
  when: OrderSchedule;
  noSlots: boolean;
  locale: string;
  onPickDay: (date: string) => void;
  onPickTime: (time: string) => void;
  uid: string;
}) {
  const t = useTranslations();
  if (!config || loading) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-[60px] w-full" />
        <Skeleton className="h-[44px] w-full" />
      </div>
    );
  }
  if (noSlots) {
    return (
      <p className="notice notice-warn" role="status">
        <CalendarClock className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
        {t('mode.noSlots')}
      </p>
    );
  }
  return (
    <>
      <fieldset>
        <legend className="lbl">{t('mode.day')}</legend>
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((d) => {
            const active = when.kind === 'scheduled' && when.date === d.date;
            return (
              <button
                key={d.date}
                type="button"
                aria-pressed={active}
                onClick={() => onPickDay(d.date)}
                className={cn(
                  'flex min-h-[60px] min-w-[72px] flex-none flex-col items-center justify-center rounded-2xl border px-3',
                  active
                    ? 'border-transparent bg-deep text-ondeep'
                    : 'border-line bg-surface hover:bg-subtle',
                )}
              >
                <span className="text-sm font-extrabold">{d.label}</span>
                <span className={cn('text-xs', active ? 'text-ondeep/75' : 'text-muted')}>
                  {d.sub}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="lbl" id={`${uid}-time`}>
          {t('mode.time')}
        </legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {slots.map((time) => {
            const active = when.kind === 'scheduled' && when.time === time;
            return (
              <button
                key={time}
                type="button"
                aria-pressed={active}
                onClick={() => onPickTime(time)}
                className={cn(
                  'min-h-[44px] rounded-full border text-sm font-bold',
                  active
                    ? 'border-transparent bg-primary text-onprimary'
                    : 'border-line bg-surface hover:bg-subtle',
                )}
              >
                {formatClock(time, locale)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted">{t('mode.hoursNote')}</p>
      </fieldset>
    </>
  );
}
