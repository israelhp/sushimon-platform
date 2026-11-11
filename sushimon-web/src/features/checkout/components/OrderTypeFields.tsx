'use client';

import { Clock, Store, Truck, Zap, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { FulfillmentType, OrderSchedule } from '@/lib/data-access/models';
import { formatClock } from '@/lib/format';
import { slotsFor } from '@/lib/schedule';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { dateOptions, firstSlot, type WhenLabels } from '@/features/order-mode/when';
import type { CheckoutData } from '../use-checkout-data';

const choiceClass = (active: boolean) =>
  cn(
    'flex min-h-[64px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition',
    active
      ? 'border-transparent bg-deep text-ondeep shadow-card ring-2 ring-primary'
      : 'border-line bg-surface hover:bg-subtle',
  );

function Choice({
  active,
  onClick,
  disabled,
  Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  Icon: LucideIcon;
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

/**
 * "¿Cómo lo querés?" y "¿Cuándo?" del paso Entrega (recoger/domicilio, ahora/programar con día y hora).
 * Lee y escribe el modo de pedido compartido con el resto de la tienda; los horarios salen de la sucursal
 * asignada (o del horario de la marca mientras no hay una) y de las reglas de programación del servidor.
 */
export function OrderTypeFields({
  data,
  typeError,
  whenError,
}: {
  data: CheckoutData;
  typeError?: string;
  whenError?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { mode, update } = useOrderMode();
  const { config, now, hours } = data;

  const labels: WhenLabels = {
    asap: t('when.asap'),
    today: t('when.today'),
    tomorrow: t('when.tomorrow'),
  };
  const days = config && now ? dateOptions(config.schedule, hours, now, locale, labels) : [];
  const when = mode.when;
  const currentDate = when.kind === 'scheduled' ? when.date : days[0]?.date;
  const slots =
    config && now && currentDate ? slotsFor(config.schedule, hours, currentDate, now) : [];

  const setType = (type: FulfillmentType) => update({ type });
  const setWhen = (next: OrderSchedule) => update({ when: next });
  const pickDay = (date: string) => {
    if (!config || !now) return;
    const time = firstSlot(config.schedule, hours, date, now);
    if (time) setWhen({ kind: 'scheduled', date, time });
  };

  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="lbl">{t('mode.how')}</legend>
        <div className="grid grid-cols-2 gap-2.5">
          <Choice active={mode.type === 'pickup'} onClick={() => setType('pickup')} Icon={Store}>
            {t('mode.pickup')}
          </Choice>
          <Choice
            active={mode.type === 'delivery'}
            onClick={() => setType('delivery')}
            Icon={Truck}
          >
            {t('mode.delivery')}
          </Choice>
        </div>
        {typeError ? (
          <p id="checkout-type-error" className="err" tabIndex={-1} data-focus-error>
            {typeError}
          </p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="lbl">{t('mode.when')}</legend>
        <div className="grid grid-cols-2 gap-2.5">
          <Choice active={when.kind === 'now'} onClick={() => setWhen({ kind: 'now' })} Icon={Zap}>
            {t('when.asap')}
          </Choice>
          <Choice
            active={when.kind === 'scheduled'}
            disabled={days.length === 0}
            onClick={() => {
              if (when.kind !== 'scheduled' && days[0]) pickDay(days[0].date);
            }}
            Icon={Clock}
          >
            {t('mode.schedule')}
          </Choice>
        </div>
      </fieldset>

      {when.kind === 'scheduled' ? (
        <>
          <fieldset>
            <legend className="lbl">{t('mode.day')}</legend>
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {days.map((d) => {
                const on = when.date === d.date;
                return (
                  <button
                    key={d.date}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pickDay(d.date)}
                    className={cn(
                      'flex min-h-[60px] min-w-[72px] flex-none flex-col items-center justify-center rounded-2xl border px-3',
                      on
                        ? 'border-transparent bg-deep text-ondeep'
                        : 'border-line bg-surface hover:bg-subtle',
                    )}
                  >
                    <span className="text-sm font-extrabold">{d.label}</span>
                    <span className={cn('text-xs', on ? 'text-ondeep/75' : 'text-muted')}>
                      {d.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="lbl">{t('mode.time')}</legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((slot) => {
                const on = when.time === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      currentDate && setWhen({ kind: 'scheduled', date: currentDate, time: slot })
                    }
                    className={cn(
                      'min-h-[44px] rounded-full border text-sm font-bold',
                      on
                        ? 'border-transparent bg-primary text-onprimary'
                        : 'border-line bg-surface hover:bg-subtle',
                    )}
                  >
                    {formatClock(slot, locale)}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] text-muted">{t('mode.hoursNote')}</p>
          </fieldset>
        </>
      ) : null}
      {whenError ? (
        <p id="checkout-when-error" className="err" role="alert" tabIndex={-1} data-focus-error>
          {whenError}
        </p>
      ) : null}
    </div>
  );
}
